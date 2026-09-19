import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PeriodService } from "../src/core/period-service.js";
import { SQLitePeriodRepository } from "../src/core/sqlite-repository.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "period-tracker-"));
  dirs.push(dir);
  return join(dir, "nested", "period.db");
}

describe("SQLitePeriodRepository", () => {
  it("persists records across a restart", async () => {
    const path = tempDbPath();
    const first = new SQLitePeriodRepository(path);
    const service = new PeriodService(first, { today: () => "2026-09-25" });
    await service.recordEvent({ event: "start", date: "2026-08-22", endDate: "2026-08-26" });
    await service.recordEvent({ event: "start", date: "2026-09-19" });
    first.close();

    const reopened = new SQLitePeriodRepository(path);
    expect(await reopened.getHistory()).toEqual([
      { id: 2, startDate: "2026-09-19", endDate: null },
      { id: 1, startDate: "2026-08-22", endDate: "2026-08-26" },
    ]);
    expect(await reopened.getCurrentPeriod()).toEqual({ id: 2, startDate: "2026-09-19", endDate: null });
    reopened.close();
  });

  it("updates only the patched fields", async () => {
    const repo = new SQLitePeriodRepository(":memory:");
    const record = await repo.recordStart("2026-09-19");
    await repo.updatePeriod(record.id, { endDate: "2026-09-23" });
    expect(await repo.updatePeriod(record.id, { startDate: "2026-09-18" })).toEqual({
      id: record.id,
      startDate: "2026-09-18",
      endDate: "2026-09-23",
    });
  });

  it("closes the open period via recordEnd", async () => {
    const repo = new SQLitePeriodRepository(":memory:");
    await repo.recordStart("2026-09-19");
    expect(await repo.recordEnd("2026-09-23")).toMatchObject({ endDate: "2026-09-23" });
    expect(await repo.getCurrentPeriod()).toBeNull();
    await expect(repo.recordEnd("2026-09-24")).rejects.toMatchObject({ code: "NO_ACTIVE_PERIOD" });
  });

  it("reports missing ids as NO_PERIOD_FOUND", async () => {
    const repo = new SQLitePeriodRepository(":memory:");
    await expect(repo.updatePeriod(99, { endDate: "2026-09-23" })).rejects.toMatchObject({
      code: "NO_PERIOD_FOUND",
    });
  });

  it("wraps driver failures as DATABASE_ERROR", async () => {
    const repo = new SQLitePeriodRepository(":memory:");
    repo.close();
    await expect(repo.getHistory()).rejects.toMatchObject({ code: "DATABASE_ERROR" });
  });

  it("limits history newest first", async () => {
    const repo = new SQLitePeriodRepository(":memory:");
    for (const date of ["2026-06-03", "2026-07-01", "2026-07-30"]) {
      const r = await repo.recordStart(date);
      await repo.updatePeriod(r.id, { endDate: date });
    }
    expect((await repo.getHistory(2)).map((p) => p.startDate)).toEqual(["2026-07-30", "2026-07-01"]);
  });
});
