import { homedir } from "node:os";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import type { DefineToolPluginOptions } from "openclaw/plugin-sdk/tool-plugin";
import { todayIn } from "../../core/dates.js";
import { PeriodService } from "../../core/period-service.js";
import { SQLitePeriodRepository } from "../../core/sqlite-repository.js";
import {
  END_CHECK_AFTER_DAYS,
  SuggestedReminderService,
  UPCOMING_REMINDER_DAYS_BEFORE,
  scheduleFollowUps,
} from "../reminders/reminder-service.js";

const ISO_DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

export const configSchema = Type.Object({
  dbPath: Type.Optional(
    Type.String({
      description:
        "SQLite database file. Defaults to <OpenClaw state dir>/period-tracker/period.db so data survives plugin reinstalls.",
    }),
  ),
  timeZone: Type.Optional(
    Type.String({ description: "IANA time zone used to decide what 'today' is, e.g. Europe/London. Defaults to the host zone." }),
  ),
  reminders: Type.Optional(
    Type.Boolean({ description: "Suggest follow-up reminders after a period start is recorded. Defaults to true." }),
  ),
});

export type PeriodTrackerConfig = Static<typeof configSchema>;

export const recordParameters = Type.Object({
  event: Type.Union(
    [Type.Literal("start"), Type.Literal("end"), Type.Literal("correct_start"), Type.Literal("correct_end")],
    {
      description:
        "start = period started; end = the active period ended; correct_start / correct_end = fix the start or end date of an already recorded period.",
    },
  ),
  date: Type.String({
    pattern: ISO_DATE_PATTERN,
    description: "Calendar date of the event in YYYY-MM-DD. Resolve relative dates like 'yesterday' before calling.",
  }),
  endDate: Type.Optional(
    Type.String({
      pattern: ISO_DATE_PATTERN,
      description: "Only with event=start: end date of a past period, to log a complete past period in one call.",
    }),
  ),
  periodId: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Only for corrections: id of the period to correct (from period_history). Defaults to the most recent period.",
    }),
  ),
});

export const historyParameters = Type.Object({
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 120, description: "Maximum number of periods to list, newest first." }),
  ),
});

export const emptyParameters = Type.Object({});

export const TOOL_DESCRIPTIONS = {
  period_record: [
    "Record a menstrual period event for cycle tracking: a period start, a period end, or a correction to a previously recorded start or end date.",
    "Use when the user says their period started, ended, or that an earlier date was wrong.",
    "Returns the saved period, or a structured error (ok=false with a code such as OPEN_PERIOD_EXISTS or END_BEFORE_START) that should be explained to the user rather than worked around.",
    `After a period start, the result may include 'reminders' (an end check ${END_CHECK_AFTER_DAYS} days later and a heads-up ${UPCOMING_REMINDER_DAYS_BEFORE} days before the next predicted period); schedule each with the cron tool unless the user has declined reminders.`,
  ].join(" "),
  period_status: [
    "Get the current menstrual period status for cycle tracking: whether a period is active now, when it started and which day it is on,",
    "or, if none is active, the last recorded period and days since it started.",
  ].join(" "),
  period_history: [
    "Retrieve recorded menstrual period history with start dates, end dates, period durations, cycle lengths between period starts,",
    "and basic cycle statistics (median cycle length, variability).",
  ].join(" "),
  period_predict: [
    "Predict the user's next menstrual period start date from recent recorded menstrual cycles.",
    "Returns an estimated start date, likely date window, cycle statistics, and confidence. The estimate is deterministic and not medical advice.",
  ].join(" "),
} as const;

interface Runtime {
  service: PeriodService;
  today: () => string;
  reminders: boolean;
}

const runtimes = new Map<string, Runtime>();

export function resolveDbPath(config: PeriodTrackerConfig, env: NodeJS.ProcessEnv = process.env): string {
  if (config.dbPath) {
    return config.dbPath.startsWith("~/") ? join(homedir(), config.dbPath.slice(2)) : config.dbPath;
  }
  const stateDir = env.OPENCLAW_STATE_DIR || join(homedir(), ".openclaw");
  return join(stateDir, "period-tracker", "period.db");
}

/** One service per database path, opened lazily on first tool call. */
function runtimeFor(config: PeriodTrackerConfig): Runtime {
  const dbPath = resolveDbPath(config);
  const key = `${dbPath}\u0000${config.timeZone ?? ""}\u0000${config.reminders ?? true}`;
  let runtime = runtimes.get(key);
  if (!runtime) {
    const today = () => todayIn(config.timeZone);
    runtime = {
      service: new PeriodService(new SQLitePeriodRepository(dbPath), { today }),
      today,
      reminders: config.reminders ?? true,
    };
    runtimes.set(key, runtime);
  }
  return runtime;
}

/** Tool handlers, independent of OpenClaw so they can be tested with an in-memory service. */
export function createHandlers(runtime: Runtime) {
  return {
    async record(params: Static<typeof recordParameters>) {
      const result = await runtime.service.recordEvent(params);
      if (!result.ok || !runtime.reminders) return result;
      const reminders = new SuggestedReminderService();
      await scheduleFollowUps(result, runtime.service, reminders, runtime.today());
      const suggestions = reminders.drain();
      return suggestions.length > 0 ? { ...result, reminders: suggestions } : result;
    },
    status: () => runtime.service.getStatus(),
    history: (params: Static<typeof historyParameters>) => runtime.service.getHistory(params.limit),
    predict: () => runtime.service.predictNext(),
  };
}

type ToolFactory = Parameters<DefineToolPluginOptions<typeof configSchema>["tools"]>[0];

export function definePeriodTools(tool: ToolFactory) {
  const handlers = (config: PeriodTrackerConfig) => createHandlers(runtimeFor(config));
  return [
    tool({
      name: "period_record",
      label: "Record Period",
      description: TOOL_DESCRIPTIONS.period_record,
      parameters: recordParameters,
      execute: (params, config) => handlers(config).record(params),
    }),
    tool({
      name: "period_status",
      label: "Period Status",
      description: TOOL_DESCRIPTIONS.period_status,
      parameters: emptyParameters,
      execute: (_params, config) => handlers(config).status(),
    }),
    tool({
      name: "period_history",
      label: "Period History",
      description: TOOL_DESCRIPTIONS.period_history,
      parameters: historyParameters,
      execute: (params, config) => handlers(config).history(params),
    }),
    tool({
      name: "period_predict",
      label: "Predict Next Period",
      description: TOOL_DESCRIPTIONS.period_predict,
      parameters: emptyParameters,
      execute: (_params, config) => handlers(config).predict(),
    }),
  ];
}
