import { buildHome } from '@bishop/core';
import { TaskRow } from '../../components/TaskRow';
import { EmptyLine, ErrorLine, Loading, Screen } from '../../components/ui';
import { useTasks } from '../../lib/queries';
import { useToday } from '../../lib/today';

/** Quick captures with no project and no day. Open one to file it, or long-press to give it a day. */
export default function Inbox() {
  const today = useToday();
  const tasks = useTasks();
  if (tasks.isPending) return <Loading />;
  const { inbox } = buildHome(tasks.data ?? [], today);

  return (
    <Screen
      title="Inbox"
      subtitle={inbox.length ? 'Give each a project or a day to file it.' : undefined}
      onRefresh={() => void tasks.refetch()}
      refreshing={tasks.isRefetching}
    >
      <ErrorLine error={tasks.error} />
      {inbox.length ? (
        inbox.map((task) => <TaskRow key={task.id} task={task} today={today} />)
      ) : (
        <EmptyLine>Inbox zero. Tap + to capture something.</EmptyLine>
      )}
    </Screen>
  );
}
