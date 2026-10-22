import { buildPlan, fromDateOnly } from '@bishop/core';
import { Fragment } from 'react';
import { Text } from 'react-native';
import { TaskRow } from '../../components/TaskRow';
import { EmptyLine, ErrorLine, Loading, Screen, SectionHeader } from '../../components/ui';
import { useTasks } from '../../lib/queries';
import { type, useTheme } from '../../lib/theme';
import { useToday } from '../../lib/today';

const variantFor = (status: string) =>
  status === 'blocked' || status === 'needs_review' || status === 'failed'
    ? ('needsYou' as const)
    : status === 'queued' || status === 'in_progress'
      ? ('inFlight' as const)
      : ('todo' as const);

/** Day-by-day agenda for the week, then Later. Long-press a task to move it. */
export default function Plan() {
  const t = useTheme();
  const today = useToday();
  const tasks = useTasks();
  if (tasks.isPending) return <Loading />;
  const plan = buildPlan(tasks.data ?? [], today);

  return (
    <Screen
      title="Plan"
      subtitle="Long-press a task to move it to another day."
      onRefresh={() => void tasks.refetch()}
      refreshing={tasks.isRefetching}
    >
      <ErrorLine error={tasks.error} />
      {plan.days.map((d, i) => (
        <Fragment key={d.day}>
          <SectionHeader
            title={d.label}
            count={d.entries.length || undefined}
            color={i === 0 ? t.idle : undefined}
            action={
              i < 2 ? (
                <Text style={[type.small, { color: t.textFaint }]}>
                  {fromDateOnly(d.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </Text>
              ) : null
            }
          />
          {d.entries.length ? (
            d.entries.map((e) => (
              <TaskRow key={e.task.id} task={e.task} today={today} overdue={e.overdue} variant={variantFor(e.task.status)} showDay={false} />
            ))
          ) : (
            <EmptyLine>Nothing planned.</EmptyLine>
          )}
        </Fragment>
      ))}
      <SectionHeader title="Later" count={plan.later.length || undefined} />
      {plan.later.length ? (
        plan.later.map((task) => <TaskRow key={task.id} task={task} today={today} variant={variantFor(task.status)} />)
      ) : (
        <EmptyLine>Nothing parked for later.</EmptyLine>
      )}
    </Screen>
  );
}
