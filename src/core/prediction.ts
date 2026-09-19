import { addDays, daysBetween } from "./dates.js";
import type {
  CycleStats,
  IsoDate,
  PeriodPrediction,
  PeriodRecord,
  PredictionConfidence,
} from "./types.js";

/** How many of the most recent valid cycles feed the prediction. */
export const MAX_CYCLES_USED = 6;
/** Fewer valid cycles than this is flagged `insufficient_data`. */
export const MIN_CYCLES_FOR_CONFIDENCE = 3;
/**
 * Intervals outside this range are treated as data gaps (a missed record, or two
 * entries for one period) and excluded rather than skewing the estimate.
 */
export const MIN_VALID_CYCLE_DAYS = 10;
export const MAX_VALID_CYCLE_DAYS = 90;
export const MIN_WINDOW_DAYS = 2;
export const MAX_WINDOW_DAYS = 7;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sample standard deviation; `null` with fewer than two values. */
export function standardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Cycle length = next period start − previous period start.
 * Returns lengths oldest first. End dates are never used.
 */
export function cycleLengthsFromPeriods(periods: readonly PeriodRecord[]): number[] {
  const starts = periods.map((p) => p.startDate).sort();
  const lengths: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    lengths.push(daysBetween(starts[i - 1], starts[i]));
  }
  return lengths;
}

/** Period duration in days, counting both the first and last day. */
export function periodDurationDays(startDate: IsoDate, endDate: IsoDate): number {
  return daysBetween(startDate, endDate) + 1;
}

export function isValidCycleLength(days: number): boolean {
  return days >= MIN_VALID_CYCLE_DAYS && days <= MAX_VALID_CYCLE_DAYS;
}

export function computeCycleStats(allCycleLengths: readonly number[]): CycleStats {
  const valid = allCycleLengths.filter(isValidCycleLength);
  const recent = valid.slice(-MAX_CYCLES_USED);
  const sd = standardDeviation(recent);
  return {
    cycleLengths: recent,
    excludedCycleLengths: allCycleLengths.filter((d) => !isValidCycleLength(d)),
    cyclesUsed: recent.length,
    medianCycleLength: median(recent),
    standardDeviation: sd === null ? null : round1(sd),
  };
}

export function confidenceFor(cyclesUsed: number, sd: number | null): PredictionConfidence {
  if (cyclesUsed < MIN_CYCLES_FOR_CONFIDENCE || sd === null) return "insufficient_data";
  if (sd <= 2) return "high";
  if (sd <= 4) return "medium";
  return "low";
}

export function variabilityDaysFor(sd: number | null): number {
  // With a single cycle there is no spread to measure, so use the widest window.
  if (sd === null) return MAX_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.round(sd)));
}

/**
 * Predict the next period start from recorded periods. Pure and deterministic.
 * Returns `null` when there are no periods at all.
 */
export function predictNextPeriod(periods: readonly PeriodRecord[]): PeriodPrediction | null {
  if (periods.length === 0) return null;
  const lastPeriodStart = periods.map((p) => p.startDate).sort().at(-1)!;
  const stats = computeCycleStats(cycleLengthsFromPeriods(periods));

  if (stats.medianCycleLength === null) {
    return {
      lastPeriodStart,
      predictedStart: null,
      windowStart: null,
      windowEnd: null,
      cyclesUsed: 0,
      medianCycleLength: null,
      variabilityDays: null,
      confidence: "insufficient_data",
    };
  }

  const predictedStart = addDays(lastPeriodStart, Math.round(stats.medianCycleLength));
  const variabilityDays = variabilityDaysFor(stats.standardDeviation);
  return {
    lastPeriodStart,
    predictedStart,
    windowStart: addDays(predictedStart, -variabilityDays),
    windowEnd: addDays(predictedStart, variabilityDays),
    cyclesUsed: stats.cyclesUsed,
    medianCycleLength: stats.medianCycleLength,
    variabilityDays,
    confidence: confidenceFor(stats.cyclesUsed, stats.standardDeviation),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
