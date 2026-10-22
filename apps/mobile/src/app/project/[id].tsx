import { buildHome, isOpen } from '@bishop/core';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { TaskRow } from '../../components/TaskRow';
import { AddButton, EmptyLine, ErrorLine, Loading, SectionHeader } from '../../components/ui';
import { useProject, useProjects, useProjectTasks, useUpdateProject } from '../../lib/queries';
import { space, type, useTheme } from '../../lib/theme';
import { useToday } from '../../lib/today';

/** One project: what's running, what's open, what's done. */
export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const router = useRouter();
  const today = useToday();
  const project = useProject(id);
  const projects = useProjects();
  const tasks = useProjectTasks(id);
  const update = useUpdateProject();
  const [showDone, setShowDone] = useState(false);

  if (project.isPending || tasks.isPending) return <Loading />;
  if (!project.data) return <ErrorLine error={project.error ?? 'Project not found.'} />;
  const p = project.data;
  const link = (projects.data ?? []).find((x) => x.id === id)?.linkedAgent;
  const all = tasks.data ?? [];
  const v = buildHome(all, today);
  const open = [...v.today.map((e) => e.task), ...v.next.tomorrow, ...v.next.thisWeek, ...v.next.later, ...v.inbox];
  const done = all.filter((x) => !isOpen(x));

  const menu = () =>
    Alert.alert(p.name, undefined, [
      {
        text: p.status === 'paused' ? 'Resume project' : 'Pause project',
        onPress: () => update.mutate({ id: p.id, patch: { status: p.status === 'paused' ? 'active' : 'paused' } }),
      },
      {
        text: 'Archive project',
        style: 'destructive',
        onPress: () => update.mutate({ id: p.id, patch: { status: 'archived' } }, { onSuccess: () => router.back() }),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen
        options={{
          title: p.name,
          headerRight: () => (
            <Pressable onPress={menu} hitSlop={10} accessibilityRole="button" accessibilityLabel="Project options">
              <Ionicons name="ellipsis-horizontal-circle-outline" size={24} color={t.idle} />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}>
        <Text style={[type.small, { color: t.textMuted }]}>
          {link ? `Linked to ${link.name}. Queue a task and it picks it up.` : 'Not linked to an agent. Run bishop link in this project’s folder on a Mac.'}
          {p.status === 'paused' ? '  Paused.' : ''}
        </Text>
        <ErrorLine error={tasks.error ?? update.error} />

        {v.needsYou.length ? (
          <>
            <SectionHeader title="Needs you" count={v.needsYou.length} color={t.needsYou} />
            {v.needsYou.map((x) => <TaskRow key={x.id} task={x} today={today} variant="needsYou" showProject={false} />)}
          </>
        ) : null}
        {v.inFlight.length ? (
          <>
            <SectionHeader title="In flight" count={v.inFlight.length} color={t.working} />
            {v.inFlight.map((x) => <TaskRow key={x.id} task={x} today={today} variant="inFlight" showProject={false} />)}
          </>
        ) : null}

        <SectionHeader title="Open" count={open.length} color={t.idle} />
        {open.length ? (
          open.map((x) => <TaskRow key={x.id} task={x} today={today} showProject={false} overdue={v.today.find((e) => e.task.id === x.id)?.overdue} />)
        ) : (
          <EmptyLine>Nothing open. Tap + to add a task.</EmptyLine>
        )}

        {done.length ? (
          <Pressable onPress={() => setShowDone((s) => !s)} style={{ paddingVertical: space.lg }} accessibilityRole="button">
            <Text style={[type.small, { color: t.textMuted }]}>{showDone ? 'Hide' : 'Show'} {done.length} done</Text>
          </Pressable>
        ) : null}
        {showDone ? done.map((x) => <TaskRow key={x.id} task={x} today={today} showProject={false} />) : null}
      </ScrollView>
      <AddButton params={{ project_id: p.id }} />
    </View>
  );
}
