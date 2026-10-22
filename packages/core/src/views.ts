import { addDays, dueDay, dayLabel, toDateOnly } from './dates';
import type { DateOnly, Task, TaskStatus } from './types';

// The grouping logic behind Home, Plan and Inbox. Pure functions, so every
// app (phone, Mac, runner) shows the same answer to "what's next".

export interface Entry<T extends Task = Task> {
  task: T;
  /** Its day has passed and it is still open. */
  overdue: boolean;
}

export interface HomeView<T extends Task = Task> {
  needsYou: T[];
  inFlight: T[];
  today: Entry<T>[];
  doneToday: T[];
  next: {
    tomorrow: T[];
    thisWeek: T[];
    later: T[];
  };
  inbox: T[];
  counts: { needsYou: number; inFlight: number; today: number };
}

const NEEDS_YOU: TaskStatus[] = ['blocked', 'needs_review', 'failed'];
const IN_FLIGHT: TaskStatus[] = ['in_progress', 'queued'];

/** The day a task belongs to: its scheduled day, else its due day. */
export function taskDay(t: Task): DateOnly | null {
  return t.scheduled_for ?? dueDay(t.due_at);
}

export function isOpen(t: Task): boolean {
  return t.status !== 'done';
}

/** Inbox: open, still untriaged — no project, or explicitly in the inbox, and no day. */
export function isInboxTask(t: Task): boolean {
  if (!isOpen(t) || taskDay(t)) return false;
  if (NEEDS_YOU.includes(t.status) || IN_FLIGHT.includes(t.status)) return false;
  return t.status === 'inbox' || t.project_id === null;
}

const byRank = (order: TaskStatus[]) => (a: Task, b: Task) =>
  order.indexOf(a.status) - order.indexOf(b.status) ||
  b.updated_at.localeCompare(a.updated_at);

/** Overdue first, then high priority, then manual order, then oldest. */
export function compareForDay(a: Entry, b: Entry): number {
  return (
    Number(b.overdue) - Number(a.overdue) ||
    b.task.priority - a.task.priority ||
    a.task.sort_order - b.task.sort_order ||
    a.task.created_at.localeCompare(b.task.created_at)
  );
}

export function buildHome<T extends Task>(tasks: T[], today: DateOnly): HomeView<T> {
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 6);

  const needsYou: T[] = [];
  const inFlight: T[] = [];
  const todayList: Entry<T>[] = [];
  const doneToday: T[] = [];
  const tomorrowList: T[] = [];
  const thisWeek: T[] = [];
  const later: T[] = [];
  const inbox: T[] = [];

  for (const t of tasks) {
    if (t.status === 'done') {
      if (t.completed_at && toDateOnly(new Date(t.completed_at)) >= today) doneToday.push(t);
      continue;
    }
    if (NEEDS_YOU.includes(t.status)) {
      needsYou.push(t);
      continue;
    }
    if (IN_FLIGHT.includes(t.status)) {
      inFlight.push(t);
      continue;
    }
    if (isInboxTask(t)) {
      inbox.push(t);
      continue;
    }
    const day = taskDay(t);
    if (day === null) later.push(t);
    else if (day <= today) todayList.push({ task: t, overdue: day < today });
    else if (day === tomorrow) tomorrowList.push(t);
    else if (day <= weekEnd) thisWeek.push(t);
    else later.push(t);
  }

  needsYou.sort(byRank(NEEDS_YOU));
  inFlight.sort(byRank(IN_FLIGHT));
  todayList.sort(compareForDay);
  inbox.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const byDay = (a: T, b: T) =>
    (taskDay(a) ?? '9999').localeCompare(taskDay(b) ?? '9999') || b.priority - a.priority;
  thisWeek.sort(byDay);
  later.sort(byDay);

  return {
    needsYou,
    inFlight,
    today: todayList,
    doneToday,
    next: { tomorrow: tomorrowList, thisWeek, later },
    inbox,
    counts: { needsYou: needsYou.length, inFlight: inFlight.length, today: todayList.length },
  };
}

export interface PlanDay<T extends Task = Task> {
  day: DateOnly;
  label: string;
  entries: Entry<T>[];
}

export interface PlanView<T extends Task = Task> {
  days: PlanDay<T>[];
  later: T[];
}

/**
 * Day-by-day agenda: today plus the next `span - 1` days, then Later.
 * Every open task with a day appears, including agent work; overdue rolls into today.
 */
export function buildPlan<T extends Task>(tasks: T[], today: DateOnly, span = 7): PlanView<T> {
  const days: PlanDay<T>[] = Array.from({ length: span }, (_, i) => {
    const day = addDays(today, i);
    return { day, label: dayLabel(day, today), entries: [] };
  });
  const last = days[days.length - 1]!.day;
  const later: T[] = [];

  for (const t of tasks) {
    if (!isOpen(t)) continue;
    const day = taskDay(t);
    if (day === null) {
      if (!isInboxTask(t) && t.project_id !== null) later.push(t);
      continue;
    }
    if (day < today) days[0]!.entries.push({ task: t, overdue: true });
    else if (day > last) later.push(t);
    else days.find((d) => d.day === day)!.entries.push({ task: t, overdue: false });
  }
  for (const d of days) d.entries.sort(compareForDay);
  later.sort((a, b) => (taskDay(a) ?? '9999').localeCompare(taskDay(b) ?? '9999'));
  return { days, later };
}

/** One-line summary for the Home header: "2 in flight · 1 needs you · 5 today". */
export function homeSummary(view: HomeView): string {
  const { inFlight, needsYou, today } = view.counts;
  return `${inFlight} in flight · ${needsYou} ${needsYou === 1 ? 'needs' : 'need'} you · ${today} today`;
}
