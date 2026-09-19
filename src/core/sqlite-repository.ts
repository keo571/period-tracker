import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PeriodRepository } from "./repository.js";
import { PeriodTrackerError, type IsoDate, type PeriodRecord } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS periods_start_date ON periods(start_date);
`;

interface PeriodRow {
  id: number;
  start_date: string;
  end_date: string | null;
}

function toRecord(row: PeriodRow): PeriodRecord {
  return { id: Number(row.id), startDate: row.start_date, endDate: row.end_date };
}

/** Wrap driver failures so callers only ever see `PeriodTrackerError`. */
function guard<T>(operation: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof PeriodTrackerError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new PeriodTrackerError("DATABASE_ERROR", `Database ${operation} failed: ${detail}`);
  }
}

/**
 * `PeriodRepository` backed by Node's built-in `node:sqlite`.
 * Opening an existing file never drops or rewrites data; the schema is created only if missing.
 */
export class SQLitePeriodRepository implements PeriodRepository {
  private readonly db: DatabaseSync;

  /** @param path Database file path, or `":memory:"` for tests. */
  constructor(path: string) {
    this.db = guard("open", () => {
      if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
      const db = new DatabaseSync(path);
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec(SCHEMA);
      return db;
    });
  }

  close(): void {
    this.db.close();
  }

  async recordStart(date: IsoDate): Promise<PeriodRecord> {
    return guard("insert", () => {
      const row = this.db
        .prepare("INSERT INTO periods (start_date) VALUES (?) RETURNING id, start_date, end_date")
        .get(date) as unknown as PeriodRow;
      return toRecord(row);
    });
  }

  async recordEnd(date: IsoDate): Promise<PeriodRecord> {
    const current = await this.getCurrentPeriod();
    if (!current) {
      throw new PeriodTrackerError("NO_ACTIVE_PERIOD", "There is no active period to end.");
    }
    return this.updatePeriod(current.id, { endDate: date });
  }

  async getCurrentPeriod(): Promise<PeriodRecord | null> {
    return guard("query", () => {
      const row = this.db
        .prepare(
          "SELECT id, start_date, end_date FROM periods WHERE end_date IS NULL ORDER BY start_date DESC, id DESC LIMIT 1",
        )
        .get() as PeriodRow | undefined;
      return row ? toRecord(row) : null;
    });
  }

  async getById(id: number): Promise<PeriodRecord | null> {
    return guard("query", () => {
      const row = this.db
        .prepare("SELECT id, start_date, end_date FROM periods WHERE id = ?")
        .get(id) as PeriodRow | undefined;
      return row ? toRecord(row) : null;
    });
  }

  async getHistory(limit?: number): Promise<PeriodRecord[]> {
    return guard("query", () => {
      const sql = "SELECT id, start_date, end_date FROM periods ORDER BY start_date DESC, id DESC";
      const rows = (
        limit === undefined
          ? this.db.prepare(sql).all()
          : this.db.prepare(`${sql} LIMIT ?`).all(limit)
      ) as unknown as PeriodRow[];
      return rows.map(toRecord);
    });
  }

  async updatePeriod(
    id: number,
    patch: Partial<Pick<PeriodRecord, "startDate" | "endDate">>,
  ): Promise<PeriodRecord> {
    return guard("update", () => {
      const existing = this.db
        .prepare("SELECT id, start_date, end_date FROM periods WHERE id = ?")
        .get(id) as PeriodRow | undefined;
      if (!existing) {
        throw new PeriodTrackerError("NO_PERIOD_FOUND", `No period with id ${id}.`);
      }
      const startDate = patch.startDate !== undefined ? patch.startDate : existing.start_date;
      const endDate = patch.endDate !== undefined ? patch.endDate : existing.end_date;
      const row = this.db
        .prepare(
          `UPDATE periods SET start_date = ?, end_date = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? RETURNING id, start_date, end_date`,
        )
        .get(startDate, endDate, id) as unknown as PeriodRow;
      return toRecord(row);
    });
  }
}
