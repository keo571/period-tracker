import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import entry from "../src/index.js";
import { createHandlers, resolveDbPath } from "../src/adapters/openclaw/tools.js";
import { memoryService } from "./helpers.js";

const TOOL_NAMES = ["period_record", "period_status", "period_history", "period_predict"];

describe("plugin metadata", () => {
  const metadata = getToolPluginMetadata(entry)!;

  it("exposes exactly the four user-level tools", () => {
    expect(metadata.id).toBe("period-tracker");
    expect(metadata.tools.map((t) => t.name)).toEqual(TOOL_NAMES);
  });

  it("gives every tool a specific, searchable description", () => {
    for (const tool of metadata.tools) {
      expect(tool.description.length).toBeGreaterThan(80);
      expect(tool.description).toMatch(/menstrual/);
    }
    const record = metadata.tools.find((t) => t.name === "period_record")!;
    expect(record.description).toMatch(/period start/);
    expect(record.description).toMatch(/period end/);
    expect(record.description).toMatch(/cycle tracking/);
  });

  it("generates parameter schemas", () => {
    const byName = Object.fromEntries(metadata.tools.map((t) => [t.name, t.parameters]));
    expect(byName.period_record).toMatchObject({
      type: "object",
      required: ["event", "date"],
      properties: {
        event: { anyOf: [{ const: "start" }, { const: "end" }, { const: "correct_start" }, { const: "correct_end" }] },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      },
    });
    expect(byName.period_history).toMatchObject({ properties: { limit: { type: "integer", minimum: 1 } } });
    expect(byName.period_status).toMatchObject({ type: "object", properties: {} });
    expect(byName.period_predict).toMatchObject({ type: "object", properties: {} });
  });

  it("declares a config schema with dbPath, timeZone and reminders", () => {
    expect(Object.keys(metadata.configSchema.properties as object)).toEqual(["dbPath", "timeZone", "reminders"]);
  });

  it("keeps the committed manifest in sync with the entry", () => {
    const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
    expect(manifest.id).toBe(metadata.id);
    expect(manifest.contracts.tools).toEqual(TOOL_NAMES);
  });
});

describe("tool handlers", () => {
  function handlers(today: string, reminders = true) {
    const ctx = memoryService(today);
    return { ...ctx, tools: createHandlers({ service: ctx.service, today: () => ctx.clock.today, reminders }) };
  }

  it("suggests an end check and an upcoming-period reminder after a start", async () => {
    const { tools } = handlers("2026-09-19");
    await tools.record({ event: "start", date: "2026-06-24", endDate: "2026-06-28" });
    await tools.record({ event: "start", date: "2026-07-22", endDate: "2026-07-26" });
    await tools.record({ event: "start", date: "2026-08-19", endDate: "2026-08-23" });
    const result = await tools.record({ event: "start", date: "2026-09-16" });
    expect(result).toMatchObject({
      ok: true,
      reminders: [
        { kind: "period_end_check", remindOn: "2026-09-21" },
        { kind: "upcoming_period", remindOn: "2026-10-11" },
      ],
    });
  });

  it("skips reminders that would already be in the past", async () => {
    const { tools } = handlers("2026-09-30");
    const result = await tools.record({ event: "start", date: "2026-09-19" });
    expect(result).not.toHaveProperty("reminders");
  });

  it("does not suggest reminders for backfilled periods, errors, or when disabled", async () => {
    const { tools } = handlers("2026-09-19");
    expect(await tools.record({ event: "start", date: "2026-09-01", endDate: "2026-09-05" })).not.toHaveProperty(
      "reminders",
    );
    expect(await tools.record({ event: "end", date: "2026-09-19" })).toMatchObject({ ok: false });

    const disabled = handlers("2026-09-19", false);
    expect(await disabled.tools.record({ event: "start", date: "2026-09-19" })).not.toHaveProperty("reminders");
  });

  it("passes status, history and predict through to the service", async () => {
    const { tools } = handlers("2026-09-19");
    await tools.record({ event: "start", date: "2026-09-19" });
    expect(await tools.status()).toMatchObject({ ok: true, currentlyActive: true });
    expect(await tools.history({ limit: 1 })).toMatchObject({ ok: true, totalRecorded: 1 });
    expect(await tools.predict()).toMatchObject({ ok: true, confidence: "insufficient_data" });
  });

  it("never uses reserved result keys that OpenClaw grades as failures", async () => {
    const { tools } = handlers("2026-09-19");
    const results = [
      await tools.record({ event: "start", date: "2026-09-19" }),
      await tools.status(),
      await tools.history({}),
      await tools.predict(),
    ];
    for (const result of results) {
      for (const key of ["status", "success", "error", "timedOut", "exitCode"]) {
        expect(result).not.toHaveProperty(key);
      }
    }
  });
});

describe("database location", () => {
  it("defaults to the OpenClaw state dir so reinstalls keep data", () => {
    expect(resolveDbPath({}, { OPENCLAW_STATE_DIR: "/srv/oc" })).toBe("/srv/oc/period-tracker/period.db");
  });

  it("honours an explicit dbPath", () => {
    expect(resolveDbPath({ dbPath: "/data/p.db" }, {})).toBe("/data/p.db");
  });
});
