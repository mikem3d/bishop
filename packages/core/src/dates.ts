import type { DateOnly } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day for a Date, as `YYYY-MM-DD`. */
export function toDateOnly(d: Date): DateOnly {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse `YYYY-MM-DD` as local midnight. */
export function fromDateOnly(s: DateOnly): Date {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function addDays(day: DateOnly, n: number): DateOnly {
  const d = fromDateOnly(day);
  d.setDate(d.getDate() + n);
  return toDateOnly(d);
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: DateOnly, b: DateOnly): number {
  const ms = fromDateOnly(b).getTime() - fromDateOnly(a).getTime();
  return Math.round(ms / 86_400_000);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today", "Tomorrow", or "Thu Oct 23". */
export function dayLabel(day: DateOnly, today: DateOnly): string {
  const diff = daysBetween(today, day);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const d = fromDateOnly(day);
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Thu Oct 22" for a header. */
export function longDayLabel(day: DateOnly): string {
  const d = fromDateOnly(day);
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** The local day a task's due timestamp falls on, if any. */
export function dueDay(dueAt: string | null): DateOnly | null {
  return dueAt ? toDateOnly(new Date(dueAt)) : null;
}
