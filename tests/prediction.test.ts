import { describe, expect, it } from "vitest";
import {
  computeCycleStats,
  confidenceFor,
  cycleLengthsFromPeriods,
  median,
  periodDurationDays,
  predictNextPeriod,
  standardDeviation,
} from "../src/core/prediction.js";
import { todayIn } from "../src/core/dates.js";
import { periodsFromCycles } from "./helpers.js";

describe("median and standard deviation", () => {
  it("computes the median of 28, 28, 29, 28 as 28", () => {
    expect(median([28, 28, 29, 28])).toBe(28);
  });

  it("averages the two middle values for an even count", () => {
    expect(median([27, 28, 29, 30])).toBe(28.5);
  });

  it("returns null for empty input and single values", () => {
    expect(median([])).toBeNull();
    expect(standardDeviation([28])).toBeNull();
  });

  it("uses the sample standard deviation", () => {
    expect(standardDeviation([25, 31, 27, 32, 26, 30])).toBeCloseTo(2.881, 3);
  });
});

describe("cycle lengths", () => {
  it("measures start to next start, never using end dates", () => {
    const periods = [
      { id: 1, startDate: "2026-06-03", endDate: "2026-06-10" },
      { id: 2, startDate: "2026-07-01", endDate: "2026-07-02" },
      { id: 3, startDate: "2026-07-30", endDate: null },
    ];
    expect(cycleLengthsFromPeriods(periods)).toEqual([28, 29]);
  });

  it("sorts by start date regardless of input order", () => {
    const periods = periodsFromCycles("2026-01-01", [28, 30]).reverse();
    expect(cycleLengthsFromPeriods(periods)).toEqual([28, 30]);
  });

  it("counts period duration inclusively", () => {
    expect(periodDurationDays("2026-09-19", "2026-09-23")).toBe(5);
    expect(periodDurationDays("2026-09-19", "2026-09-19")).toBe(1);
  });

  it("handles month and year boundaries", () => {
    expect(cycleLengthsFromPeriods(periodsFromCycles("2026-12-20", [28]))).toEqual([28]);
    expect(periodsFromCycles("2026-12-20", [28])[1].startDate).toBe("2027-01-17");
  });
});

describe("cycle stats", () => {
  it("uses only the 6 most recent valid cycles", () => {
    const stats = computeCycleStats([35, 35, 35, 27, 28, 29, 28, 30, 28]);
    expect(stats.cycleLengths).toEqual([27, 28, 29, 28, 30, 28]);
    expect(stats.cyclesUsed).toBe(6);
    expect(stats.medianCycleLength).toBe(28);
  });

  it("excludes implausible gaps such as a missed record", () => {
    const stats = computeCycleStats([28, 29, 120, 28]);
    expect(stats.cycleLengths).toEqual([28, 29, 28]);
    expect(stats.excludedCycleLengths).toEqual([120]);
  });
});

describe("confidence", () => {
  it("follows the blueprint thresholds", () => {
    expect(confidenceFor(2, 1)).toBe("insufficient_data");
    expect(confidenceFor(3, 2)).toBe("high");
    expect(confidenceFor(3, 4)).toBe("medium");
    expect(confidenceFor(3, 4.1)).toBe("low");
  });
});

describe("predictNextPeriod", () => {
  it("returns null without any periods", () => {
    expect(predictNextPeriod([])).toBeNull();
  });

  it("does not predict a date from a single period", () => {
    const prediction = predictNextPeriod([{ id: 1, startDate: "2026-09-19", endDate: null }]);
    expect(prediction).toMatchObject({
      lastPeriodStart: "2026-09-19",
      predictedStart: null,
      cyclesUsed: 0,
      confidence: "insufficient_data",
    });
  });

  it("predicts regular cycles with a narrow window and high confidence", () => {
    const periods = periodsFromCycles("2026-04-02", [27, 28, 29, 28, 30, 28]);
    const prediction = predictNextPeriod(periods)!;
    expect(prediction.lastPeriodStart).toBe("2026-09-19");
    expect(prediction).toMatchObject({
      predictedStart: "2026-10-17",
      windowStart: "2026-10-15",
      windowEnd: "2026-10-19",
      cyclesUsed: 6,
      medianCycleLength: 28,
      variabilityDays: 2,
      confidence: "high",
    });
  });

  it("stays near 28 days despite a 40-day outlier", () => {
    const periods = periodsFromCycles("2026-03-01", [28, 28, 29, 40, 27, 28]);
    const prediction = predictNextPeriod(periods)!;
    expect(prediction.medianCycleLength).toBe(28);
    expect(prediction.predictedStart).toBe("2026-09-25"); // 2026-08-28 + 28
  });

  it("gives irregular cycles a wider window and lower confidence than regular ones", () => {
    const regular = predictNextPeriod(periodsFromCycles("2026-03-01", [28, 28, 29, 28, 28, 28]))!;
    const irregular = predictNextPeriod(periodsFromCycles("2026-03-01", [25, 31, 27, 32, 26, 30]))!;
    expect(regular.confidence).toBe("high");
    expect(irregular.confidence).toBe("medium");
    expect(irregular.variabilityDays!).toBeGreaterThan(regular.variabilityDays!);
  });

  it("marks fewer than 3 cycles as insufficient_data but still estimates", () => {
    const prediction = predictNextPeriod(periodsFromCycles("2026-08-01", [28, 30]))!;
    expect(prediction.confidence).toBe("insufficient_data");
    expect(prediction.predictedStart).toBe("2026-10-27"); // 2026-09-28 + median 29
  });

  it("caps the window at 7 days for very irregular cycles", () => {
    const prediction = predictNextPeriod(periodsFromCycles("2026-01-01", [20, 45, 22, 50, 21, 44]))!;
    expect(prediction.variabilityDays).toBe(7);
    expect(prediction.confidence).toBe("low");
  });

  it("is deterministic", () => {
    const periods = periodsFromCycles("2026-03-01", [25, 31, 27, 32, 26, 30]);
    expect(predictNextPeriod(periods)).toEqual(predictNextPeriod([...periods].reverse()));
  });
});

describe("todayIn", () => {
  it("resolves the calendar date in a time zone", () => {
    const now = new Date("2026-09-19T23:30:00Z");
    expect(todayIn("UTC", now)).toBe("2026-09-19");
    expect(todayIn("Asia/Tokyo", now)).toBe("2026-09-20");
    expect(todayIn("America/Los_Angeles", now)).toBe("2026-09-19");
  });

  it("rejects an unknown time zone with a clear code", () => {
    expect(() => todayIn("Mars/Olympus")).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});
