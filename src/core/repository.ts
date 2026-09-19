import type { IsoDate, PeriodRecord } from "./types.js";

/**
 * Storage abstraction for period records. Implementations persist data only;
 * validation and business rules live in `PeriodService`.
 */
export interface PeriodRepository {
  /** Insert a new open period starting on `date`. */
  recordStart(date: IsoDate): Promise<PeriodRecord>;
  /** Close the latest open period on `date`. Throws `NO_ACTIVE_PERIOD` if none is open. */
  recordEnd(date: IsoDate): Promise<PeriodRecord>;
  /** The latest period with no end date, if any. */
  getCurrentPeriod(): Promise<PeriodRecord | null>;
  getById(id: number): Promise<PeriodRecord | null>;
  /** Periods ordered newest start first, optionally limited. */
  getHistory(limit?: number): Promise<PeriodRecord[]>;
  updatePeriod(
    id: number,
    patch: Partial<Pick<PeriodRecord, "startDate" | "endDate">>,
  ): Promise<PeriodRecord>;
}
