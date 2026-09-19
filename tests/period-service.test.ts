import { describe, expect, it } from "vitest";
import { memoryService } from "./helpers.js";

describe("recording a start", () => {
  it("records an open period", async () => {
    const { service } = memoryService("2026-09-19");
    const result = await service.recordEvent({ event: "start", date: "2026-09-19" });
    expect(result).toEqual({
      ok: true,
      event: "start",
      period: { id: 1, startDate: "2026-09-19", endDate: null, durationDays: null },
    });
  });

  it("refuses a second start while a period is active", async () => {
    const { service } = memoryService("2026-09-21");
    await service.recordEvent({ event: "start", date: "2026-09-19" });
    const result = await service.recordEvent({ event: "start", date: "2026-09-21" });
    expect(result).toMatchObject({ ok: false, code: "OPEN_PERIOD_EXISTS" });
    expect(!result.ok && result.message).toContain("2026-09-19");
  });

  it("refuses a duplicate start date", async () => {
    const { service } = memoryService("2026-09-25");
    await service.recordEvent({ event: "start", date: "2026-09-19" });
    await service.recordEvent({ event: "end", date: "2026-09-23" });
    const result = await service.recordEvent({ event: "start", date: "2026-09-19" });
    expect(result).toMatchObject({ ok: false, code: "DUPLICATE_PERIOD_START" });
  });

  it("refuses a start inside an already recorded period", async () => {
    const { service } = memoryService("2026-09-25");
    await service.recordEvent({ event: "start", date: "2026-09-19", endDate: "2026-09-23" });
    const result = await service.recordEvent({ event: "start", date: "2026-09-21", endDate: "2026-09-22" });
    expect(result).toMatchObject({ ok: false, code: "OVERLAPS_EXISTING_PERIOD" });
  });

  it("refuses future dates and malformed dates", async () => {
    const { service } = memoryService("2026-09-19");
    expect(await service.recordEvent({ event: "start", date: "2026-09-20" })).toMatchObject({
      ok: false,
      code: "FUTURE_DATE",
    });
    expect(await service.recordEvent({ event: "start", date: "2026-02-30" })).toMatchObject({
      ok: false,
      code: "INVALID_DATE",
    });
    expect(await service.recordEvent({ event: "start", date: "19/09/2026" })).toMatchObject({
      ok: false,
      code: "INVALID_DATE",
    });
  });

  it("backfills a complete past period before an active one", async () => {
    const { service } = memoryService("2026-09-20");
    await service.recordEvent({ event: "start", date: "2026-09-19" });
    const result = await service.recordEvent({ event: "start", date: "2026-08-22", endDate: "2026-08-26" });
    expect(result).toMatchObject({
      ok: true,
      period: { startDate: "2026-08-22", endDate: "2026-08-26", durationDays: 5 },
    });
  });
});

describe("recording an end", () => {
  it("closes the active period", async () => {
    const { service } = memoryService("2026-09-23");
    await service.recordEvent({ event: "start", date: "2026-09-19" });
    const result = await service.recordEvent({ event: "end", date: "2026-09-23" });
    expect(result).toMatchObject({
      ok: true,
      period: { startDate: "2026-09-19", endDate: "2026-09-23", durationDays: 5 },
    });
  });

  it("rejects an end before the start", async () => {
    const { service } = memoryService("2026-09-23");
    await service.recordEvent({ event: "start", date: "2026-09-19" });
    const result = await service.recordEvent({ event: "end", date: "2026-09-18" });
    expect(result).toMatchObject({ ok: false, code: "END_BEFORE_START" });
  });

  it("reports when there is no active period", async () => {
    const { service } = memoryService("2026-09-23");
    expect(await service.recordEvent({ event: "end", date: "2026-09-23" })).toMatchObject({
      ok: false,
      code: "NO_ACTIVE_PERIOD",
    });
  });

  it("rejects endDate on events other than start", async () => {
    const { service } = memoryService("2026-09-23");
    await service.recordEvent({ event: "start", date: "2026-09-19" });
    const result = await service.recordEvent({ event: "end", date: "2026-09-22", endDate: "2026-09-23" });
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("corrections", () => {
  it("corrects the latest start date and returns the previous value", async () => {
    const { service } = memoryService("2026-09-19");
    await service.recordEvent({ event: "start", date: "2026-09-19" });
    const result = await service.recordEvent({ event: "correct_start", date: "2026-09-18" });
    expect(result).toMatchObject({
      ok: true,
      event: "correct_start",
      period: { id: 1, startDate: "2026-09-18", endDate: null },
      previous: { id: 1, startDate: "2026-09-19" },
    });
  });

  it("corrects an older period by id", async () => {
    const { service } = memoryService("2026-09-25");
    await service.recordEvent({ event: "start", date: "2026-08-22", endDate: "2026-08-26" });
    await service.recordEvent({ event: "start", date: "2026-09-19" });
    const result = await service.recordEvent({ event: "correct_end", date: "2026-08-27", periodId: 1 });
    expect(result).toMatchObject({ ok: true, period: { id: 1, endDate: "2026-08-27", durationDays: 6 } });
  });

  it("does not let a correction put the start after the end", async () => {
    const { service } = memoryService("2026-09-25");
    await service.recordEvent({ event: "start", date: "2026-09-19", endDate: "2026-09-23" });
    const result = await service.recordEvent({ event: "correct_start", date: "2026-09-24" });
    expect(result).toMatchObject({ ok: false, code: "END_BEFORE_START" });
  });

  it("does not let a correction overlap a neighbouring period", async () => {
    const { service } = memoryService("2026-09-25");
    await service.recordEvent({ event: "start", date: "2026-08-22", endDate: "2026-08-26" });
    await service.recordEvent({ event: "start", date: "2026-09-19" });
    const result = await service.recordEvent({ event: "correct_start", date: "2026-08-25" });
    expect(result).toMatchObject({ ok: false, code: "OVERLAPS_EXISTING_PERIOD" });
  });

  it("reports unknown period ids and empty history", async () => {
    const { service } = memoryService("2026-09-25");
    expect(await service.recordEvent({ event: "correct_start", date: "2026-09-20" })).toMatchObject({
      ok: false,
      code: "NO_PERIOD_FOUND",
    });
    await service.recordEvent({ event: "start", date: "2026-09-19" });
    expect(await service.recordEvent({ event: "correct_start", date: "2026-09-20", periodId: 42 })).toMatchObject({
      ok: false,
      code: "NO_PERIOD_FOUND",
    });
  });
});

describe("status", () => {
  it("reports an active period and which day it is on", async () => {
    const { service, clock } = memoryService("2026-09-19");
    await service.recordEvent({ event: "start", date: "2026-09-19" });
    clock.today = "2026-09-22";
    expect(await service.getStatus()).toEqual({
      ok: true,
      today: "2026-09-22",
      currentlyActive: true,
      periodId: 1,
      startDate: "2026-09-19",
      durationDays: 4,
      possiblyMissingEnd: false,
    });
  });

  it("flags an unusually long active period", async () => {
    const { service, clock } = memoryService("2026-09-01");
    await service.recordEvent({ event: "start", date: "2026-09-01" });
    clock.today = "2026-09-19";
    expect(await service.getStatus()).toMatchObject({ currentlyActive: true, possiblyMissingEnd: true });
  });

  it("reports the last period when none is active", async () => {
    const { service } = memoryService("2026-09-30");
    await service.recordEvent({ event: "start", date: "2026-09-19", endDate: "2026-09-23" });
    expect(await service.getStatus()).toMatchObject({
      ok: true,
      currentlyActive: false,
      lastPeriod: { startDate: "2026-09-19", endDate: "2026-09-23", durationDays: 5 },
      daysSinceLastStart: 11,
    });
  });

  it("handles an empty database", async () => {
    const { service } = memoryService("2026-09-30");
    expect(await service.getStatus()).toMatchObject({ ok: true, currentlyActive: false, lastPeriod: null });
  });
});

describe("history and prediction", () => {
  async function seeded() {
    const ctx = memoryService("2026-09-25");
    for (const [start, end] of [
      ["2026-06-03", "2026-06-07"],
      ["2026-07-01", "2026-07-05"],
      ["2026-07-30", "2026-08-03"],
      ["2026-08-27", "2026-08-31"],
    ]) {
      await ctx.service.recordEvent({ event: "start", date: start, endDate: end });
    }
    await ctx.service.recordEvent({ event: "start", date: "2026-09-24" });
    return ctx;
  }

  it("lists newest first with cycle lengths and stats", async () => {
    const { service } = await seeded();
    const result = await service.getHistory(3);
    if (!result.ok) throw new Error(result.message);
    expect(result.totalRecorded).toBe(5);
    expect(result.periods.map((p) => [p.startDate, p.cycleLengthDays])).toEqual([
      ["2026-09-24", null],
      ["2026-08-27", 28],
      ["2026-07-30", 28],
    ]);
    expect(result.stats).toMatchObject({ cycleLengths: [28, 29, 28, 28], cyclesUsed: 4, medianCycleLength: 28 });
  });

  it("rejects a non-positive limit", async () => {
    const { service } = memoryService("2026-09-25");
    expect(await service.getHistory(0)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("predicts from stored history", async () => {
    const { service } = await seeded();
    expect(await service.predictNext()).toMatchObject({
      ok: true,
      lastPeriodStart: "2026-09-24",
      predictedStart: "2026-10-22",
      cyclesUsed: 4,
      medianCycleLength: 28,
      confidence: "high",
      today: "2026-09-25",
      daysUntilPredictedStart: 27,
    });
  });

  it("returns INSUFFICIENT_HISTORY with nothing recorded", async () => {
    const { service } = memoryService("2026-09-25");
    expect(await service.predictNext()).toMatchObject({ ok: false, code: "INSUFFICIENT_HISTORY" });
  });

  it("explains single-period predictions instead of guessing", async () => {
    const { service } = memoryService("2026-09-25");
    await service.recordEvent({ event: "start", date: "2026-09-19" });
    const result = await service.predictNext();
    expect(result).toMatchObject({ ok: true, predictedStart: null, confidence: "insufficient_data" });
    expect(result.ok && result.note).toMatch(/two recorded period starts/);
  });
});
