# Period Tracker

A small personal menstrual-cycle tracker for OpenClaw. It records period start and end dates in a local SQLite database and predicts the next period from recent cycles, using deterministic math rather than an LLM.

This is a personal tracking and planning tool. It is not a medical diagnostic system.

## Tools

| Tool             | What it does                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `period_record`  | Record `start` or `end`, or fix a date with `correct_start` / `correct_end`. Takes resolved `YYYY-MM-DD` dates. |
| `period_status`  | Whether a period is active, and which day it is on; otherwise the last period and days since it started. |
| `period_history` | Recorded periods, newest first, with durations, cycle lengths and cycle statistics.                     |
| `period_predict` | Next predicted start, likely window, cycles used, median cycle length and confidence.                  |

`period_record` also accepts:

- `endDate` together with `event: "start"`, to log a complete past period in one call (backfilling).
- `periodId`, to correct an older period. Without it, a correction applies to the most recent period.

Errors come back as `{ "ok": false, "code": "...", "message": "..." }`. The codes are `OPEN_PERIOD_EXISTS`, `NO_ACTIVE_PERIOD`, `NO_PERIOD_FOUND`, `INVALID_DATE`, `INVALID_INPUT`, `FUTURE_DATE`, `END_BEFORE_START`, `DUPLICATE_PERIOD_START`, `OVERLAPS_EXISTING_PERIOD`, `INSUFFICIENT_HISTORY` and `DATABASE_ERROR`. The tracker never silently corrects questionable data.

## Prediction

- Cycle length is the number of days from one period's start to the next period's start. End dates are never used.
- The prediction uses the most recent 6 valid cycles. Intervals shorter than 10 days or longer than 90 days are treated as data gaps and excluded. They are reported as `excludedCycleLengths`.
- Predicted start = last start + median cycle length.
- Window = ± `clamp(round(sample std dev), 2, 7)` days. With only one cycle, the window is ±7 days.
- Confidence:

  | Condition                   | Confidence          |
  | --------------------------- | ------------------- |
  | Fewer than 3 cycles         | `insufficient_data` |
  | Std dev of 2 days or less   | `high`              |
  | Std dev of 4 days or less   | `medium`            |
  | Otherwise                   | `low`               |

  A single recorded period gives no predicted date.

## Reminders

Tool plugins cannot create OpenClaw automations themselves. Instead, after a period start is recorded, `period_record` returns a `reminders` array, which the agent is told to schedule with OpenClaw's built-in `cron` tool. The array can contain:

- a check-in 5 days after the start: "Has your period ended?"
- a heads-up 3 days before the predicted next start

Reminders whose date has already passed are not suggested. To turn reminders off, set the `reminders` config option to `false`. The scheduling boundary is the `ReminderService` interface in `src/adapters/reminders/reminder-service.ts`, so a direct scheduler can replace it later.

## Configuration

Set these under the plugin's entry in the OpenClaw Gateway config. All are optional.

| Key         | Default                                                  | Purpose                                   |
| ----------- | -------------------------------------------------------- | ----------------------------------------- |
| `dbPath`    | `$OPENCLAW_STATE_DIR/period-tracker/period.db`, or `~/.openclaw/period-tracker/period.db` | SQLite file location (`~/` is expanded). |
| `timeZone`  | Host time zone                                           | IANA zone used to decide what "today" is. |
| `reminders` | `true`                                                   | Suggest follow-up reminders.              |

The default database lives outside the plugin folder so that reinstalling or updating the plugin never touches it. The schema is created only if missing, and existing data is never dropped.

## Layout

```text
src/core/             Business logic. Must not import OpenClaw.
  types.ts            Records, prediction and error types
  dates.ts            YYYY-MM-DD calendar math (UTC-based, so daylight saving changes cannot shift a day)
  repository.ts       PeriodRepository interface
  sqlite-repository.ts  node:sqlite implementation
  prediction.ts       Pure, deterministic cycle math
  period-service.ts   Validation and business rules
src/adapters/openclaw/tools.ts          Thin OpenClaw tool definitions
src/adapters/reminders/reminder-service.ts  ReminderService interface and implementations
src/index.ts          defineToolPlugin entry
tests/                Vitest suites
```

A future MCP adapter (`src/adapters/mcp/server.ts`) can import `src/core/index.ts` and reuse `PeriodService` unchanged.

## Development

Requires Node 24.16 or later. That is OpenClaw's minimum, and `node:sqlite` is built in.

```bash
npm install
npm test
npm run typecheck        # also type-checks tests
npm run plugin:build     # tsc + regenerate openclaw.plugin.json
npm run plugin:validate
```

Commit `openclaw.plugin.json` whenever `plugin:build` changes it. It lists the tools OpenClaw can discover without loading the plugin's code.

## Deploying to the OpenClaw machine

```bash
cd ~/Developer/Plugins/period-tracker
git pull
npm install
npm run plugin:build
npm run plugin:validate
npm test

# first time: link the checkout so later `git pull` + build updates the plugin in place.
# A local path is outside ClawHub review, so OpenClaw asks for --force and --accept-capabilities.
openclaw plugins install --link --force --accept-capabilities .
openclaw plugins inspect period-tracker --runtime

# after later updates: restart the Gateway so it picks up the rebuilt plugin
openclaw gateway restart
# on OpenClaw 2026.9.5 or newer this works too, without a full restart:
openclaw plugins reload period-tracker
```

### Moving the database

To keep the data somewhere other than the default, set `dbPath` and restart the Gateway:

```bash
mkdir -p ~/Library/Application\ Support/PeriodTracker
[ -f ~/.openclaw/period-tracker/period.db ] && mv ~/.openclaw/period-tracker/period.db* ~/Library/Application\ Support/PeriodTracker/
openclaw config set plugins.entries.period-tracker.config.dbPath "~/Library/Application Support/PeriodTracker/period.db"
openclaw gateway restart
```

## Privacy

The database holds private health data. `.gitignore` excludes `data/`, `*.db`, the SQLite WAL and SHM files, and `.env`. Only source code, tests, schemas and documentation belong in Git.
