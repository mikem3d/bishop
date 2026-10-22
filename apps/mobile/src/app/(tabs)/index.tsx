import { buildHome, homeSummary, longDayLabel, type TaskWithContext } from '@bishop/core';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar, avatarStateFor } from '../../components/Avatar';
import { TaskRow } from '../../components/TaskRow';
import { EmptyLine, ErrorLine, Loading, Screen, SectionHeader } from '../../components/ui';
import { useTasks } from '../../lib/queries';
import { radius, space, type, useTheme } from '../../lib/theme';
import { useToday } from '../../lib/today';

/** Home answers: what needs me, what's running, what's today, what's next. */
export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const today = useToday();
  const tasks = useTasks();
  const [showDone, setShowDone] = useState(false);

  if (tasks.isPending) return <Loading />;
  const v = buildHome(tasks.data ?? [], today);

  return (
    <Screen
      title={`Today, ${longDayLabel(today)}`}
      subtitle={homeSummary(v)}
      right={<Avatar state={avatarStateFor(v.counts)} size={64} />}
      onRefresh={() => void tasks.refetch()}
      refreshing={tasks.isRefetching}
    >
      <ErrorLine error={tasks.error} />

      {v.needsYou.length > 0 ? (
        <>
          <SectionHeader title="Needs you" count={v.needsYou.length} color={t.needsYou} />
          {v.needsYou.map((task) => (
            <TaskRow key={task.id} task={task} today={today} variant="needsYou" />
          ))}
        </>
      ) : null}

      <SectionHeader title="In flight" count={v.inFlight.length} color={t.working} />
      {v.inFlight.length ? (
        v.inFlight.map((task) => <TaskRow key={task.id} task={task} today={today} variant="inFlight" />)
      ) : (
        <EmptyLine>No agent work running. Queue a task in a linked project to start one.</EmptyLine>
      )}

      <SectionHeader
        title="Today"
        count={v.today.length}
        color={t.idle}
        action={
          v.doneToday.length ? (
            <Pressable onPress={() => setShowDone((s) => !s)} hitSlop={8} accessibilityRole="button">
              <Text style={[type.small, { color: t.textMuted }]}>
                {showDone ? 'Hide' : 'Show'} {v.doneToday.length} done
              </Text>
            </Pressable>
          ) : null
        }
      />
      {v.today.length ? (
        v.today.map((e) => <TaskRow key={e.task.id} task={e.task} today={today} overdue={e.overdue} />)
      ) : (
        <EmptyLine>{v.doneToday.length ? 'All done for today.' : 'Nothing scheduled for today.'}</EmptyLine>
      )}
      {showDone ? v.doneToday.map((task) => <TaskRow key={task.id} task={task} today={today} />) : null}

      <SectionHeader title="Next" color={t.thinking} />
      <View style={[styles.nextCard, { backgroundColor: t.surface, borderColor: t.border }]}>
        <NextRow label="Tomorrow" tasks={v.next.tomorrow} onPress={() => router.navigate('/plan')} />
        <NextRow label="This week" tasks={v.next.thisWeek} onPress={() => router.navigate('/plan')} />
        <NextRow label="Later" tasks={v.next.later} onPress={() => router.navigate('/plan')} last />
      </View>

      {v.inbox.length ? (
        <Pressable onPress={() => router.navigate('/inbox')} style={styles.inboxHint} accessibilityRole="button">
          <Ionicons name="file-tray-outline" size={16} color={t.textMuted} />
          <Text style={[type.small, { color: t.textMuted, marginLeft: 6 }]}>
            {v.inbox.length} in the Inbox to sort
          </Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function NextRow({ label, tasks, onPress, last }: { label: string; tasks: TaskWithContext[]; onPress: () => void; last?: boolean }) {
  const t = useTheme();
  const preview = tasks.slice(0, 2).map((x) => x.title).join(', ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${tasks.length} tasks`}
      style={({ pressed }) => [
        styles.nextRow,
        { borderBottomColor: t.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, backgroundColor: pressed ? t.surfaceRaised : 'transparent' },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: t.text }]}>{label}</Text>
        {preview ? (
          <Text style={[type.small, { color: t.textFaint, marginTop: 2 }]} numberOfLines={1}>
            {preview}
            {tasks.length > 2 ? ` +${tasks.length - 2}` : ''}
          </Text>
        ) : null}
      </View>
      <Text style={[type.body, { color: tasks.length ? t.text : t.textFaint, fontWeight: '600', marginRight: space.sm }]}>
        {tasks.length}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={t.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  nextCard: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  nextRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, paddingHorizontal: space.lg, minHeight: 56 },
  inboxHint: { flexDirection: 'row', alignItems: 'center', marginTop: space.xl, alignSelf: 'center', padding: space.sm },
});
