import { addDays } from "../src/core/dates.js";
import { PeriodService } from "../src/core/period-service.js";
import { SQLitePeriodRepository } from "../src/core/sqlite-repository.js";
import type { PeriodRecord } from "../src/core/types.js";

/** Closed periods whose consecutive starts are `cycleLengths` apart, oldest first. */
export function periodsFromCycles(firstStart: string, cycleLengths: number[], durationDays = 5): PeriodRecord[] {
  const starts = [firstStart];
  for (const length of cycleLengths) starts.push(addDays(starts.at(-1)!, length));
  return starts.map((startDate, i) => ({ id: i + 1, startDate, endDate: addDays(startDate, durationDays - 1) }));
}

export function memoryService(today: string) {
  const repository = new SQLitePeriodRepository(":memory:");
  const clock = { today };
  const service = new PeriodService(repository, { today: () => clock.today });
  return { repository, service, clock };
}
