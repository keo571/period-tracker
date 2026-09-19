import { assertIsoDate, daysBetween, todayIn } from "./dates.js";
import {
  computeCycleStats,
  cycleLengthsFromPeriods,
  periodDurationDays,
  predictNextPeriod,
} from "./prediction.js";
import type { PeriodRepository } from "./repository.js";
import {
  PeriodTrackerError,
  type CycleStats,
  type IsoDate,
  type PeriodPrediction,
  type PeriodRecord,
  type Result,
} from "./types.js";

export type PeriodEvent = "start" | "end" | "correct_start" | "correct_end";

export interface RecordEventInput {
  event: PeriodEvent;
  /** Resolved ISO date for the event. */
  date: IsoDate;
  /** For `start` only: record a complete past period in one call. */
  endDate?: IsoDate;
  /** For corrections: which period to correct. Defaults to the most recent period. */
  periodId?: number;
}

export interface PeriodView extends PeriodRecord {
  /** Inclusive day count; `null` while the period is still active. */
  durationDays: number | null;
}

export interface RecordEventOutput {
  event: PeriodEvent;
  period: PeriodView;
  /** The record before a correction was applied. */
  previous?: PeriodView;
}

export type StatusOutput =
  | {
      today: IsoDate;
      currentlyActive: true;
      periodId: number;
      startDate: IsoDate;
      /** Day number of the active period, counting the start day as day 1. */
      durationDays: number;
      /** Active for longer than a typical period; the end may not have been recorded. */
      possiblyMissingEnd: boolean;
    }
  | {
      today: IsoDate;
      currentlyActive: false;
      lastPeriod: PeriodView | null;
      daysSinceLastStart: number | null;
    };

export interface HistoryEntry extends PeriodView {
  /** Days from this period's start to the next recorded start; `null` for the latest period. */
  cycleLengthDays: number | null;
}

export interface HistoryOutput {
  totalRecorded: number;
  /** Newest first. */
  periods: HistoryEntry[];
  stats: CycleStats;
}

export interface PredictionOutput extends PeriodPrediction {
  today: IsoDate;
  /** Negative when the predicted date has already passed. */
  daysUntilPredictedStart: number | null;
  note: string;
}

export interface PeriodServiceOptions {
  /** Returns today's local calendar date. Defaults to the host's local date. */
  today?: () => IsoDate;
}

/** Active periods longer than this are flagged as possibly missing an end date. */
const LONG_PERIOD_DAYS = 10;
const OPEN_END = "9999-12-31";

function view(record: PeriodRecord): PeriodView {
  return {
    ...record,
    durationDays: record.endDate ? periodDurationDays(record.startDate, record.endDate) : null,
  };
}

function toResult<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  return fn().then(
    (value) => ({ ok: true as const, ...value }),
    (error: unknown) => {
      if (error instanceof PeriodTrackerError) {
        return { ok: false as const, code: error.code, message: error.message };
      }
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false as const, code: "DATABASE_ERROR" as const, message: detail };
    },
  );
}

function fail(code: PeriodTrackerError["code"], message: string): never {
  throw new PeriodTrackerError(code, message);
}

/** Business rules for recording and reading menstrual periods. Runtime-agnostic. */
export class PeriodService {
  private readonly today: () => IsoDate;

  constructor(
    private readonly repository: PeriodRepository,
    options: PeriodServiceOptions = {},
  ) {
    this.today = options.today ?? (() => todayIn());
  }

  recordEvent(input: RecordEventInput): Promise<Result<RecordEventOutput>> {
    return toResult(async () => {
      assertIsoDate(input.date);
      if (input.endDate !== undefined && input.event !== "start") {
        fail("INVALID_INPUT", "endDate can only be supplied with the start event.");
      }
      switch (input.event) {
        case "start":
          return this.recordStart(input.date, input.endDate);
        case "end":
          return this.recordEnd(input.date);
        case "correct_start":
          return this.correct(input.periodId, { startDate: input.date });
        case "correct_end":
          return this.correct(input.periodId, { endDate: input.date });
        default:
          return fail("INVALID_INPUT", `Unknown event "${String(input.event)}".`);
      }
    });
  }

  getStatus(): Promise<Result<StatusOutput>> {
    return toResult(async (): Promise<StatusOutput> => {
      const today = this.today();
      const current = await this.repository.getCurrentPeriod();
      if (current) {
        const durationDays = daysBetween(current.startDate, today) + 1;
        return {
          today,
          currentlyActive: true,
          periodId: current.id,
          startDate: current.startDate,
          durationDays,
          possiblyMissingEnd: durationDays > LONG_PERIOD_DAYS,
        };
      }
      const [last] = await this.repository.getHistory(1);
      return {
        today,
        currentlyActive: false,
        lastPeriod: last ? view(last) : null,
        daysSinceLastStart: last ? daysBetween(last.startDate, today) : null,
      };
    });
  }

  getHistory(limit?: number): Promise<Result<HistoryOutput>> {
    return toResult(async () => {
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        fail("INVALID_INPUT", "limit must be a positive whole number.");
      }
      // Stats always use the full history; `limit` only trims the listed records.
      const all = await this.repository.getHistory();
      const newestFirst = all.map((record, i): HistoryEntry => {
        const next = all[i - 1];
        return {
          ...view(record),
          cycleLengthDays: next ? daysBetween(record.startDate, next.startDate) : null,
        };
      });
      return {
        totalRecorded: all.length,
        periods: limit === undefined ? newestFirst : newestFirst.slice(0, limit),
        stats: computeCycleStats(cycleLengthsFromPeriods(all)),
      };
    });
  }

  predictNext(): Promise<Result<PredictionOutput>> {
    return toResult(async () => {
      const today = this.today();
      const prediction = predictNextPeriod(await this.repository.getHistory());
      if (!prediction) {
        fail("INSUFFICIENT_HISTORY", "No periods have been recorded yet, so nothing can be predicted.");
      }
      return {
        ...prediction,
        today,
        daysUntilPredictedStart: prediction.predictedStart
          ? daysBetween(today, prediction.predictedStart)
          : null,
        note: noteFor(prediction),
      };
    });
  }

  private async recordStart(date: IsoDate, endDate?: IsoDate): Promise<RecordEventOutput> {
    this.assertNotFuture(date);
    if (endDate !== undefined) {
      assertIsoDate(endDate);
      this.assertNotFuture(endDate);
      if (endDate < date) {
        fail("END_BEFORE_START", `End date ${endDate} is before start date ${date}.`);
      }
    }
    const all = await this.repository.getHistory();
    const duplicate = all.find((p) => p.startDate === date);
    if (duplicate) {
      fail("DUPLICATE_PERIOD_START", `A period starting on ${date} is already recorded (id ${duplicate.id}).`);
    }
    if (endDate === undefined) {
      const open = all.find((p) => p.endDate === null);
      if (open) {
        fail(
          "OPEN_PERIOD_EXISTS",
          `A period starting on ${open.startDate} is already active. Record its end first, or correct its start date.`,
        );
      }
    }
    this.assertNoOverlap(all, { startDate: date, endDate: endDate ?? null });

    let record = await this.repository.recordStart(date);
    if (endDate !== undefined) {
      record = await this.repository.updatePeriod(record.id, { endDate });
    }
    return { event: "start", period: view(record) };
  }

  private async recordEnd(date: IsoDate): Promise<RecordEventOutput> {
    const current = await this.repository.getCurrentPeriod();
    if (!current) {
      fail("NO_ACTIVE_PERIOD", "There is no active period to end. Record a start first, or use correct_end.");
    }
    this.assertNotFuture(date);
    if (date < current.startDate) {
      fail("END_BEFORE_START", `End date ${date} is before the active period's start date ${current.startDate}.`);
    }
    const all = await this.repository.getHistory();
    this.assertNoOverlap(all, { startDate: current.startDate, endDate: date }, current.id);
    return { event: "end", period: view(await this.repository.recordEnd(date)) };
  }

  private async correct(
    periodId: number | undefined,
    patch: Partial<Pick<PeriodRecord, "startDate" | "endDate">>,
  ): Promise<RecordEventOutput> {
    const all = await this.repository.getHistory();
    const target = periodId === undefined ? all[0] : all.find((p) => p.id === periodId);
    if (!target) {
      fail(
        "NO_PERIOD_FOUND",
        periodId === undefined ? "No periods have been recorded yet." : `No period with id ${periodId}.`,
      );
    }
    const next = { startDate: patch.startDate ?? target.startDate, endDate: patch.endDate ?? target.endDate };
    this.assertNotFuture(next.startDate);
    if (next.endDate !== null) {
      this.assertNotFuture(next.endDate);
      if (next.endDate < next.startDate) {
        fail("END_BEFORE_START", `End date ${next.endDate} is before start date ${next.startDate}.`);
      }
    }
    const duplicate = all.find((p) => p.id !== target.id && p.startDate === next.startDate);
    if (duplicate) {
      fail(
        "DUPLICATE_PERIOD_START",
        `A different period starting on ${next.startDate} is already recorded (id ${duplicate.id}).`,
      );
    }
    this.assertNoOverlap(all, next, target.id);
    const updated = await this.repository.updatePeriod(target.id, patch);
    return {
      event: patch.startDate !== undefined ? "correct_start" : "correct_end",
      period: view(updated),
      previous: view(target),
    };
  }

  private assertNotFuture(date: IsoDate): void {
    const today = this.today();
    if (date > today) {
      fail("FUTURE_DATE", `${date} is in the future (today is ${today}).`);
    }
  }

  /** Periods cannot overlap. An active period is treated as extending indefinitely. */
  private assertNoOverlap(
    all: readonly PeriodRecord[],
    candidate: Pick<PeriodRecord, "startDate" | "endDate">,
    ignoreId?: number,
  ): void {
    const candidateEnd = candidate.endDate ?? OPEN_END;
    for (const other of all) {
      if (other.id === ignoreId) continue;
      const otherEnd = other.endDate ?? OPEN_END;
      if (candidate.startDate <= otherEnd && other.startDate <= candidateEnd) {
        const range = other.endDate ? `${other.startDate} to ${other.endDate}` : `${other.startDate} (still active)`;
        fail("OVERLAPS_EXISTING_PERIOD", `These dates overlap the period recorded for ${range} (id ${other.id}).`);
      }
    }
  }
}

function noteFor(prediction: PeriodPrediction): string {
  const disclaimer = "This is an estimate from past cycles, not medical advice.";
  if (prediction.predictedStart === null) {
    return `At least two recorded period starts are needed to estimate a cycle length. ${disclaimer}`;
  }
  if (prediction.confidence === "insufficient_data") {
    return `Based on only ${prediction.cyclesUsed} cycle(s); treat this as a rough guess until at least 3 cycles are recorded. ${disclaimer}`;
  }
  return disclaimer;
}
