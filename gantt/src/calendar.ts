/**
 * Dates are handled as whole UTC day numbers (days since 1970-01-01), which
 * keeps arithmetic free of time zones and DST.
 *
 * Scheduling works in *working-day index* space: every working day gets a
 * consecutive integer. A task that starts at index s and lasts d working days
 * ends (exclusively) at s + d. Weekends simply have no index of their own —
 * a weekend day maps to the index of the next working day.
 */

const MS_PER_DAY = 86_400_000;
/** 1970-01-05 was a Monday. */
const MONDAY_ANCHOR = 4;

export function parseDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / MS_PER_DAY);
}

export function formatDate(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function isValidISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && formatDate(parseDate(s)) === s;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function dateParts(day: number): { year: number; month: number; date: number } {
  const d = new Date(day * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate() };
}

export function firstOfMonth(year: number, month: number): number {
  return Math.floor(Date.UTC(year, month, 1) / MS_PER_DAY);
}

export interface Calendar {
  workWeekends: boolean;
  isWorkday(day: number): boolean;
  /** Working-day index of `day`; non-working days snap forward. */
  toIndex(day: number): number;
  /** Calendar day of a working-day index. */
  toDay(index: number): number;
}

export function makeCalendar(workWeekends: boolean): Calendar {
  if (workWeekends) {
    return {
      workWeekends,
      isWorkday: () => true,
      toIndex: (day) => day,
      toDay: (index) => index,
    };
  }
  return {
    workWeekends,
    isWorkday: (day) => {
      const w = weekday(day);
      return w !== 0 && w !== 6;
    },
    toIndex: (day) => {
      const rel = day - MONDAY_ANCHOR;
      const weeks = Math.floor(rel / 7);
      const rem = rel - weeks * 7; // 0 = Monday … 6 = Sunday
      return weeks * 5 + Math.min(rem, 5);
    },
    toDay: (index) => {
      const weeks = Math.floor(index / 5);
      const rem = index - weeks * 5;
      return MONDAY_ANCHOR + weeks * 7 + rem;
    },
  };
}

export const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
