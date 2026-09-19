import { addDays } from "../../core/dates.js";
import type { PeriodService, RecordEventOutput } from "../../core/period-service.js";
import type { IsoDate } from "../../core/types.js";

/** Days after a period starts to ask whether it has ended. */
export const END_CHECK_AFTER_DAYS = 5;
/** Days before the predicted start to send a heads-up. */
export const UPCOMING_REMINDER_DAYS_BEFORE = 3;

export interface PeriodEndCheckContext {
  periodStart: IsoDate;
}

export interface UpcomingPeriodContext {
  predictedStart: IsoDate;
  windowStart: IsoDate | null;
  windowEnd: IsoDate | null;
}

/**
 * Scheduling boundary. OpenClaw automation APIs vary by version, so the plugin
 * depends on this interface rather than on a specific scheduler.
 */
export interface ReminderService {
  /** Schedule a check-in on `date` asking whether the active period has ended. */
  schedulePeriodEndCheck(date: IsoDate, context: PeriodEndCheckContext): Promise<void>;
  /** Schedule a heads-up on `date` about the upcoming predicted period. */
  scheduleUpcomingPeriodReminder(date: IsoDate, context: UpcomingPeriodContext): Promise<void>;
}

export interface ReminderSuggestion {
  kind: "period_end_check" | "upcoming_period";
  /** Local calendar date the reminder should fire. */
  remindOn: IsoDate;
  /** Message to deliver to the user at that time. */
  message: string;
}

/**
 * Tool plugins cannot create OpenClaw automations directly, so this implementation
 * collects reminders and returns them in the tool result. The agent then schedules
 * them with OpenClaw's built-in `cron` tool.
 */
export class SuggestedReminderService implements ReminderService {
  private readonly suggestions: ReminderSuggestion[] = [];

  async schedulePeriodEndCheck(date: IsoDate, context: PeriodEndCheckContext): Promise<void> {
    this.suggestions.push({
      kind: "period_end_check",
      remindOn: date,
      message: `Your period started on ${context.periodStart}. Has it ended? If so, tell me the date it finished.`,
    });
  }

  async scheduleUpcomingPeriodReminder(date: IsoDate, context: UpcomingPeriodContext): Promise<void> {
    const window =
      context.windowStart && context.windowEnd
        ? ` (likely between ${context.windowStart} and ${context.windowEnd})`
        : "";
    this.suggestions.push({
      kind: "upcoming_period",
      remindOn: date,
      message: `Your next period is estimated around ${context.predictedStart}${window}. You may want to prepare from today.`,
    });
  }

  drain(): ReminderSuggestion[] {
    return this.suggestions.splice(0);
  }
}

export class NoopReminderService implements ReminderService {
  async schedulePeriodEndCheck(): Promise<void> {}
  async scheduleUpcomingPeriodReminder(): Promise<void> {}
}

/**
 * Decide which follow-ups a newly recorded period start warrants.
 * Only future reminders are scheduled; backfilled or already-ended periods get none.
 */
export async function scheduleFollowUps(
  recorded: RecordEventOutput,
  service: PeriodService,
  reminders: ReminderService,
  today: IsoDate,
): Promise<void> {
  if (recorded.event !== "start" || recorded.period.endDate !== null) return;

  const endCheck = addDays(recorded.period.startDate, END_CHECK_AFTER_DAYS);
  if (endCheck > today) {
    await reminders.schedulePeriodEndCheck(endCheck, { periodStart: recorded.period.startDate });
  }

  const prediction = await service.predictNext();
  if (prediction.ok && prediction.predictedStart) {
    const headsUp = addDays(prediction.predictedStart, -UPCOMING_REMINDER_DAYS_BEFORE);
    if (headsUp > today) {
      await reminders.scheduleUpcomingPeriodReminder(headsUp, {
        predictedStart: prediction.predictedStart,
        windowStart: prediction.windowStart,
        windowEnd: prediction.windowEnd,
      });
    }
  }
}
