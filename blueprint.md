# Period Tracker — OpenClaw Plugin Implementation Blueprint

## 1. Goal

Build a small personal menstrual-cycle tracker for OpenClaw.

The plugin should:

1. Record period start and end dates.
2. Store historical cycle data locally.
3. Predict the next period using recent cycle history.
4. Return an estimated date plus a reasonable prediction window.
5. Support a follow-up reminder approximately 5 days after a period starts.
6. Keep the core business logic independent from OpenClaw so it can later be exposed through MCP or another agent runtime.

This is a personal tracking / planning tool, not a medical diagnostic system.

---

## 2. Architecture

Keep OpenClaw-specific code thin.

```text
period-tracker/
│
├── src/
│   ├── core/
│   │   ├── period-service.ts
│   │   ├── prediction.ts
│   │   ├── repository.ts
│   │   ├── sqlite-repository.ts
│   │   └── types.ts
│   │
│   ├── adapters/
│   │   ├── openclaw/
│   │   │   └── tools.ts
│   │   │
│   │   └── reminders/
│   │       └── reminder-service.ts
│   │
│   └── index.ts
│
├── data/
│   └── period.db
│
├── tests/
│
├── openclaw.plugin.json
├── package.json
├── tsconfig.json
└── .gitignore
```

Dependency direction:

```text
OpenClaw Tools
      ↓
PeriodService
      ↓
Repository interface
      ↓
SQLiteRepository

PeriodService
      ↓
Prediction functions
```

Important rule:

> `core/` must not import OpenClaw.

This allows a future MCP adapter to reuse the same logic:

```text
OpenClaw adapter ─┐
                  ├── PeriodService ── SQLite
MCP adapter ──────┘
```

---

## 3. Data Model

Use SQLite.

### `periods`

```sql
CREATE TABLE periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Dates should use ISO local-date format:

```text
YYYY-MM-DD
```

Example:

```text
2026-09-19
```

Do not store timestamps when only a calendar date is needed.

### Optional future table: `symptoms`

Do not implement in v1 unless trivial.

```sql
CREATE TABLE symptoms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id INTEGER,
    date TEXT NOT NULL,
    symptom TEXT NOT NULL,
    severity INTEGER,
    note TEXT,
    FOREIGN KEY(period_id) REFERENCES periods(id)
);
```

---

## 4. Core Types

```ts
export interface PeriodRecord {
  id: number;
  startDate: string;
  endDate: string | null;
}

export interface CycleStats {
  cycleLengths: number[];
  cyclesUsed: number;
  medianCycleLength: number | null;
  standardDeviation: number | null;
}

export interface PeriodPrediction {
  lastPeriodStart: string;
  predictedStart: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  cyclesUsed: number;
  medianCycleLength: number | null;
  variabilityDays: number | null;
  confidence: "insufficient_data" | "low" | "medium" | "high";
}
```

---

## 5. Repository Interface

Create an abstraction instead of accessing SQLite directly from tools.

```ts
export interface PeriodRepository {
  recordStart(date: string): Promise<PeriodRecord>;
  recordEnd(date: string): Promise<PeriodRecord>;
  getCurrentPeriod(): Promise<PeriodRecord | null>;
  getHistory(limit?: number): Promise<PeriodRecord[]>;
  updatePeriod(
    id: number,
    patch: Partial<Pick<PeriodRecord, "startDate" | "endDate">>
  ): Promise<PeriodRecord>;
}
```

SQLite implementation:

```text
SQLitePeriodRepository
```

Business logic should depend only on `PeriodRepository`.

---

## 6. Period Service

Implement:

```ts
class PeriodService {
  recordEvent(...)
  getStatus(...)
  getHistory(...)
  predictNext(...)
}
```

Responsibilities:

### Record start

If user says:

```text
My period started today.
```

Record:

```text
start_date = today
end_date = null
```

Prevent accidental duplicate open periods.

If an unfinished period already exists, return a structured warning instead of silently creating another one.

### Record end

Find the latest unfinished period and set:

```text
end_date = supplied date
```

Validate:

```text
end_date >= start_date
```

### Corrections

Allow dates to be corrected later.

Example:

```text
Actually it started yesterday.
```

The service should support updating the latest relevant record.

---

## 7. Cycle Calculation

Cycle length is:

```text
next period start date
-
previous period start date
```

Example:

```text
Jun 3 → Jul 1 = 28 days
Jul 1 → Jul 30 = 29 days
```

Do NOT calculate cycle length from period end dates.

Period duration is separate:

```text
end_date - start_date + 1
```

---

## 8. Prediction Algorithm — v1

Do not use an LLM for prediction.

Use deterministic code.

### Input

Use up to the most recent 6 valid completed cycle intervals.

Example:

```text
27, 28, 29, 28, 30, 28
```

### Central estimate

Use:

```ts
median(recentCycleLengths)
```

rather than mean.

Reason:

Median is less affected by an unusual cycle.

Example:

```text
28, 28, 29, 28, 40, 27
```

A single 40-day cycle should not heavily distort the prediction.

### Prediction

```ts
predictedStart =
  lastPeriodStart + medianCycleLength
```

### Prediction window

Calculate standard deviation of recent cycle lengths.

Suggested v1:

```ts
variabilityDays = Math.max(
  2,
  Math.round(standardDeviation)
);
```

Then:

```ts
windowStart = predictedStart - variabilityDays
windowEnd   = predictedStart + variabilityDays
```

Consider capping the display window if appropriate:

```ts
variabilityDays = Math.min(7, variabilityDays);
```

Do not imply medical certainty.

---

## 9. Confidence

Simple heuristic:

```ts
if cyclesUsed < 3:
    insufficient_data

else if stdDev <= 2:
    high

else if stdDev <= 4:
    medium

else:
    low
```

Example output:

```json
{
  "lastPeriodStart": "2026-09-19",
  "predictedStart": "2026-10-17",
  "windowStart": "2026-10-15",
  "windowEnd": "2026-10-19",
  "cyclesUsed": 6,
  "medianCycleLength": 28,
  "variabilityDays": 2,
  "confidence": "high"
}
```

With fewer than 3 cycle intervals, return a prediction only if useful, but explicitly mark:

```text
confidence = insufficient_data
```

Do not pretend the estimate is reliable.

---

## 10. OpenClaw Plugin

Implement this as a tool-only OpenClaw plugin using the current OpenClaw Plugin SDK.

Prefer:

```ts
defineToolPlugin(...)
```

rather than a larger general-purpose plugin unless another capability requires it.

The OpenClaw adapter should contain almost no business logic.

---

## 11. Exposed Tools

Keep the public tool surface small.

### Tool 1 — `period_record`

Purpose:

Record a menstrual event.

Schema concept:

```ts
{
  event: "start" | "end",
  date: string
}
```

Description should clearly include terms such as:

```text
menstrual period
period start
period end
cycle tracking
```

Example:

```json
{
  "event": "start",
  "date": "2026-09-19"
}
```

---

### Tool 2 — `period_status`

Purpose:

Return current period state.

Possible output:

```json
{
  "currentlyActive": true,
  "startDate": "2026-09-19",
  "durationDays": 4
}
```

---

### Tool 3 — `period_history`

Purpose:

Retrieve recorded menstrual-period history and basic cycle statistics.

Input:

```ts
{
  limit?: number
}
```

Output should include records and calculated cycle lengths.

---

### Tool 4 — `period_predict`

Purpose:

Predict the next menstrual-period start using recent cycle history.

Input can initially be empty:

```ts
{}
```

Output:

```json
{
  "predictedStart": "2026-10-17",
  "windowStart": "2026-10-15",
  "windowEnd": "2026-10-19",
  "medianCycleLength": 28,
  "cyclesUsed": 6,
  "confidence": "high"
}
```

---

## 12. Why Only Four Tools?

Avoid exposing database-level operations directly.

Do NOT create tools such as:

```text
period_insert_row
period_update_row
period_calculate_median
period_get_last_row
period_compute_stddev
```

Those are implementation details.

A tool should correspond to a meaningful user-level action, not one SQL operation.

Desired public surface:

```text
period_record
period_status
period_history
period_predict
```

This makes Tool Search and function calling more reliable.

---

## 13. Tool Descriptions

Descriptions matter because OpenClaw Tool Search can use tool metadata for discovery.

Use explicit descriptions.

Example:

```text
period_predict

Predict the user's next menstrual period start date from
recent recorded menstrual cycles. Returns an estimated start
date, likely date window, cycle statistics, and confidence.
```

Avoid vague descriptions such as:

```text
Get period data.
```

---

## 14. Reminder Workflow

The plugin should not implement its own background scheduler unless necessary.

Preferred architecture:

```text
User:
"My period started today."

        ↓

period_record

        ↓

success

        ↓

OpenClaw scheduling / automation capability

        ↓

5 days later:
"Has your period ended?"
```

A second optional reminder:

```text
predicted period date - 3 days
```

Example:

```text
Your next period is estimated around Oct 17.
You may want to prepare starting around Oct 14.
```

Because OpenClaw automation APIs may vary by installed version, keep reminder integration behind an interface:

```ts
export interface ReminderService {
  schedulePeriodEndCheck(date: string): Promise<void>;
  scheduleUpcomingPeriodReminder(date: string): Promise<void>;
}
```

Implement the actual OpenClaw scheduler adapter against the API available in the installed OpenClaw version.

Do not put scheduling logic into `prediction.ts`.

---

## 15. Conversation Behavior

The LLM should handle natural-language interpretation.

Examples:

```text
"I got my period today."
→ period_record(event="start", date=today)

"It finished yesterday."
→ period_record(event="end", date=yesterday)

"When should I expect it next month?"
→ period_predict()

"What were my last three periods?"
→ period_history(limit=3)
```

Core code should receive resolved ISO dates.

Do not put natural-language parsing into the SQLite layer.

---

## 16. Privacy

The database contains private health-related personal data.

Do not commit it to Git.

`.gitignore`:

```gitignore
data/
*.db
*.sqlite
*.sqlite3
.env
```

GitHub should contain:

```text
source code
tests
schemas
documentation
```

It should NOT contain:

```text
actual menstrual history
local database
secrets
```

---

## 17. Git / Two-Computer Workflow

Development machine:

```bash
git pull
# edit code
npm test
git add .
git commit -m "Implement period prediction"
git push
```

OpenClaw machine:

```bash
ssh <openclaw-machine>

cd ~/projects/period-tracker
git pull
npm install
npm run plugin:build
npm run plugin:validate
npm test
```

During development, use the current OpenClaw plugin CLI's linked/local installation workflow where appropriate.

The persistent SQLite database should remain on the OpenClaw machine and survive code updates.

Do not overwrite or recreate the database during normal plugin deployment.

---

## 18. Testing

### Prediction unit tests

Test:

```text
28, 28, 29, 28
```

Expected median:

```text
28
```

Test an outlier:

```text
28, 28, 29, 40, 27, 28
```

Prediction should remain close to 28 days.

Test irregular cycles:

```text
25, 31, 27, 32, 26, 30
```

Expected:

```text
wider prediction window
lower confidence
```

### Data validation tests

Test:

* period start
* period end
* end before start
* duplicate period start
* missing open period
* correcting start date
* SQLite persistence after restart

### Tool tests

Verify tool manifest contains:

```text
period_record
period_status
period_history
period_predict
```

Verify all schemas and descriptions are generated correctly.

---

## 19. Error Handling

Return structured errors.

Examples:

```json
{
  "ok": false,
  "code": "OPEN_PERIOD_EXISTS",
  "message": "A period starting on 2026-09-19 is already active."
}
```

Other possible codes:

```text
NO_ACTIVE_PERIOD
INVALID_DATE
END_BEFORE_START
INSUFFICIENT_HISTORY
DATABASE_ERROR
```

Do not silently correct questionable data.

---

## 20. Future MCP Migration

Do not implement MCP in v1.

But design so this can later be added:

```text
src/adapters/mcp/server.ts
```

MCP tools should call exactly the same:

```ts
PeriodService
```

as OpenClaw.

Desired future architecture:

```text
                 OpenClaw
                    │
              OpenClaw adapter
                    │
                    ▼
              PeriodService
                    │
                 SQLite
                    ▲
                    │
                MCP adapter
                    │
          Claude / Codex / others
```

No prediction or database logic should need rewriting.

---

## 21. Possible v2 Features

Do not implement these unless requested:

* symptoms
* flow intensity
* cramps
* mood
* notes
* average period duration
* historical charts
* export JSON/CSV
* encrypted database
* pregnancy/postpartum exclusions
* ovulation/fertility estimation
* cycle anomaly detection

Keep v1 intentionally small.

---

## 22. Definition of Done

The first version is complete when:

1. OpenClaw successfully loads the plugin.
2. `period_record` can record start/end dates.
3. Data persists in SQLite.
4. `period_history` returns correct history.
5. `period_predict` calculates prediction deterministically.
6. Prediction uses recent cycles and median cycle length.
7. Prediction includes a window and confidence.
8. Unit tests pass.
9. Plugin validation passes.
10. Personal database files are excluded from Git.
11. Core logic has no OpenClaw imports.
12. OpenClaw-specific code is limited to the adapter/plugin layer.

---

## 23. Implementation Priority

Build in this order:

```text
1. types.ts
2. repository.ts
3. sqlite-repository.ts
4. prediction.ts
5. period-service.ts
6. unit tests
7. OpenClaw tool adapter
8. plugin build / validation
9. install on OpenClaw machine
10. reminder integration
```

Do not start with reminder automation.

First make:

```text
record → persist → retrieve → predict
```

fully reliable.

Then connect scheduling.

---

## 24. Guiding Principle

Keep these concepts separate:

```text
LLM
= understand what the user wants

OpenClaw Tool
= expose a callable interface

PeriodService
= business rules

Prediction module
= deterministic math

Repository
= data abstraction

SQLite
= persistence

Automation
= future check-ins/reminders
```

The LLM should not remember or calculate menstrual history itself.

The database is the source of truth.
