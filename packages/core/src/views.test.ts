import { describe, expect, it } from 'vitest';
import { addDays, dayLabel } from './dates';
import { buildHome, buildPlan, homeSummary, isInboxTask } from './views';
import { initialStatus, parseTicketUrl } from './data';
import type { Task } from './types';

const TODAY = '2026-10-22';
let n = 0;
function task(p: Partial<Task>): Task {
  n += 1;
  return {
    id: `t${n}`,
    workspace_id: 'w',
    project_id: 'p',
    parent_task_id: null,
    title: p.title ?? `task ${n}`,
    notes: '',
    status: 'todo',
    assignee_agent_id: null,
    scheduled_for: null,
    due_at: null,
    priority: 0,
    sort_order: 0,
    completed_at: null,
    created_by: null,
    created_at: `2026-10-01T00:00:${String(n).padStart(2, '0')}Z`,
    updated_at: `2026-10-01T00:00:${String(n).padStart(2, '0')}Z`,
    ...p,
  };
}

describe('buildHome', () => {
  it('puts each task in exactly one section', () => {
    const tasks = [
      task({ title: 'review', status: 'needs_review' }),
      task({ title: 'question', status: 'blocked' }),
      task({ title: 'crashed', status: 'failed' }),
      task({ title: 'running', status: 'in_progress', assignee_agent_id: 'a' }),
      task({ title: 'queued', status: 'queued', assignee_agent_id: 'a' }),
      task({ title: 'today', scheduled_for: TODAY }),
      task({ title: 'overdue', scheduled_for: addDays(TODAY, -3) }),
      task({ title: 'tomorrow', scheduled_for: addDays(TODAY, 1) }),
      task({ title: 'friday', scheduled_for: addDays(TODAY, 2) }),
      task({ title: 'in a week', scheduled_for: addDays(TODAY, 6) }),
      task({ title: 'next month', scheduled_for: addDays(TODAY, 30) }),
      task({ title: 'someday', scheduled_for: null }),
      task({ title: 'captured', status: 'inbox', project_id: null }),
      task({ title: 'finished', status: 'done', completed_at: new Date().toISOString() }),
    ];
    const v = buildHome(tasks, TODAY);
    const titles = (xs: Task[]) => xs.map((t) => t.title);

    expect(titles(v.needsYou)).toEqual(['question', 'review', 'crashed']);
    expect(titles(v.inFlight)).toEqual(['running', 'queued']);
    expect(v.today.map((e) => [e.task.title, e.overdue])).toEqual([
      ['overdue', true],
      ['today', false],
    ]);
    expect(titles(v.next.tomorrow)).toEqual(['tomorrow']);
    expect(titles(v.next.thisWeek)).toEqual(['friday', 'in a week']);
    expect(titles(v.next.later)).toEqual(['next month', 'someday']);
    expect(titles(v.inbox)).toEqual(['captured']);
    expect(titles(v.doneToday)).toEqual(['finished']);

    const placed =
      v.needsYou.length + v.inFlight.length + v.today.length + v.doneToday.length +
      v.next.tomorrow.length + v.next.thisWeek.length + v.next.later.length + v.inbox.length;
    expect(placed).toBe(tasks.length);
    expect(homeSummary(v)).toBe('2 in flight · 3 need you · 2 today');
  });

  it('uses the due date when nothing is scheduled', () => {
    const due = new Date(2026, 9, 22, 17, 0).toISOString(); // 5pm local today
    const v = buildHome([task({ title: 'due', due_at: due })], TODAY);
    expect(v.today[0]?.task.title).toBe('due');
  });

  it('orders today by overdue, then priority', () => {
    const v = buildHome(
      [
        task({ title: 'low', scheduled_for: TODAY, priority: 1 }),
        task({ title: 'high', scheduled_for: TODAY, priority: 3 }),
        task({ title: 'late', scheduled_for: addDays(TODAY, -1) }),
      ],
      TODAY,
    );
    expect(v.today.map((e) => e.task.title)).toEqual(['late', 'high', 'low']);
  });

  it('keeps old completed tasks out of done today', () => {
    const v = buildHome([task({ status: 'done', completed_at: '2026-01-01T12:00:00Z' })], TODAY);
    expect(v.doneToday).toHaveLength(0);
  });
});

describe('buildPlan', () => {
  it('lays out seven days, rolls overdue into today, and keeps later separate', () => {
    const p = buildPlan(
      [
        task({ title: 'late', scheduled_for: addDays(TODAY, -2) }),
        task({ title: 'today', scheduled_for: TODAY }),
        task({ title: 'agent work', status: 'queued', scheduled_for: addDays(TODAY, 1) }),
        task({ title: 'day 6', scheduled_for: addDays(TODAY, 6) }),
        task({ title: 'day 7', scheduled_for: addDays(TODAY, 7) }),
        task({ title: 'someday' }),
        task({ title: 'inbox', status: 'inbox', project_id: null }),
        task({ title: 'done', status: 'done', scheduled_for: TODAY }),
      ],
      TODAY,
    );
    expect(p.days).toHaveLength(7);
    expect(p.days[0]!.label).toBe('Today');
    expect(p.days[1]!.label).toBe('Tomorrow');
    expect(p.days[0]!.entries.map((e) => [e.task.title, e.overdue])).toEqual([
      ['late', true],
      ['today', false],
    ]);
    expect(p.days[1]!.entries.map((e) => e.task.title)).toEqual(['agent work']);
    expect(p.days[6]!.entries.map((e) => e.task.title)).toEqual(['day 6']);
    expect(p.later.map((t) => t.title)).toEqual(['day 7', 'someday']);
  });
});

describe('helpers', () => {
  it('labels days', () => {
    expect(dayLabel('2026-10-24', TODAY)).toBe('Sat Oct 24');
  });

  it('sends undated, unfiled tasks to the inbox', () => {
    expect(initialStatus({ project_id: null })).toBe('inbox');
    expect(initialStatus({ project_id: 'p' })).toBe('todo');
    expect(initialStatus({ project_id: null, scheduled_for: TODAY })).toBe('todo');
    expect(isInboxTask(task({ status: 'todo', project_id: null }))).toBe(true);
    expect(isInboxTask(task({ status: 'todo', project_id: null, scheduled_for: TODAY }))).toBe(false);
  });

  it('recognises ticket links', () => {
    expect(parseTicketUrl('https://acme.atlassian.net/browse/proj-1423')).toEqual({ system: 'jira', key: 'PROJ-1423' });
    expect(parseTicketUrl('https://github.com/mikem3d/bishop/issues/12')).toEqual({ system: 'github', key: 'mikem3d/bishop#12' });
    expect(parseTicketUrl('https://linear.app/acme/issue/ENG-9/fix')).toEqual({ system: 'linear', key: 'ENG-9' });
    expect(parseTicketUrl('https://tickets.example.com/view/55').system).toBe('tickets');
  });
});
