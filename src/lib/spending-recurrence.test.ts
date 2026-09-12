import { describe, expect, it } from "vitest";
import { dueOccurrences, lastDayOfMonth, occurrenceDate } from "@/lib/spending-tracker";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("monthly recurrence dates", () => {
  it("repeats on the same calendar day", () => {
    const src = new Date(2026, 0, 15);
    expect([1, 2, 3].map((n) => iso(occurrenceDate(src, n)))).toEqual([
      "2026-02-15",
      "2026-03-15",
      "2026-04-15",
    ]);
  });

  it("uses the last day of short months instead of skipping", () => {
    const src = new Date(2026, 0, 31);
    expect(iso(occurrenceDate(src, 1))).toBe("2026-02-28");
    expect(iso(occurrenceDate(src, 2))).toBe("2026-03-31");
    expect(iso(occurrenceDate(src, 3))).toBe("2026-04-30");
  });

  it("handles February in a leap year", () => {
    expect(lastDayOfMonth(2028, 1)).toBe(29);
    expect(iso(occurrenceDate(new Date(2028, 0, 30), 1))).toBe("2028-02-29");
  });

  it("never repeats the original entry's own month", () => {
    const src = new Date(2026, 2, 10);
    expect(dueOccurrences(src, new Date(2026, 2, 28))).toEqual([]);
  });

  it("lists one occurrence per later month up to today", () => {
    const src = new Date(2026, 0, 10);
    expect(dueOccurrences(src, new Date(2026, 3, 5)).map(iso)).toEqual([
      "2026-02-10",
      "2026-03-10",
      "2026-04-10",
    ]);
  });

  it("is stable when the same period is generated twice (idempotent set)", () => {
    const src = new Date(2026, 0, 10);
    const a = dueOccurrences(src, new Date(2026, 3, 5)).map(iso);
    const b = dueOccurrences(src, new Date(2026, 3, 5)).map(iso);
    expect(new Set([...a, ...b]).size).toBe(a.length);
  });
});
