/** ISO local calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

export interface PeriodRecord {
  id: number;
  startDate: IsoDate;
  endDate: IsoDate | null;
}

export interface CycleStats {
  /** Recent valid cycle lengths used for prediction, oldest first. */
  cycleLengths: number[];
  /** Intervals between recorded starts that fell outside the plausible range and were ignored. */
  excludedCycleLengths: number[];
  cyclesUsed: number;
  medianCycleLength: number | null;
  standardDeviation: number | null;
}

export type PredictionConfidence = "insufficient_data" | "low" | "medium" | "high";

export interface PeriodPrediction {
  lastPeriodStart: IsoDate;
  predictedStart: IsoDate | null;
  windowStart: IsoDate | null;
  windowEnd: IsoDate | null;
  cyclesUsed: number;
  medianCycleLength: number | null;
  variabilityDays: number | null;
  confidence: PredictionConfidence;
}

export type PeriodErrorCode =
  | "OPEN_PERIOD_EXISTS"
  | "NO_ACTIVE_PERIOD"
  | "NO_PERIOD_FOUND"
  | "INVALID_DATE"
  | "INVALID_INPUT"
  | "FUTURE_DATE"
  | "END_BEFORE_START"
  | "DUPLICATE_PERIOD_START"
  | "OVERLAPS_EXISTING_PERIOD"
  | "INSUFFICIENT_HISTORY"
  | "DATABASE_ERROR";

export interface PeriodError {
  ok: false;
  code: PeriodErrorCode;
  message: string;
}

export type Result<T extends object> = ({ ok: true } & T) | PeriodError;

/** Raised by repositories and the service; converted to a `PeriodError` at the service boundary. */
export class PeriodTrackerError extends Error {
  constructor(
    readonly code: PeriodErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PeriodTrackerError";
  }
}
