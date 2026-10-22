import { dayLabel, taskDay, type DateOnly, type TaskStatus, type TaskWithContext } from '@bishop/core';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useUpdateTask } from '../lib/queries';
import { space, type, useTheme, type Theme } from '../lib/theme';
import { useReschedule } from './Reschedule';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: 'Inbox',
  todo: 'To do',
  queued: 'Queued',
  in_progress: 'Working',
  needs_review: 'Ready for review',
  blocked: 'Question for you',
  done: 'Done',
  failed: 'Run failed',
};

export function statusColor(s: TaskStatus, t: Theme): string {
  switch (s) {
    case 'blocked':
    case 'needs_review':
    case 'failed':
      return t.needsYou;
    case 'in_progress':
    case 'queued':
      return t.working;
    case 'done':
      return t.textFaint;
    default:
      return t.idle;
  }
}

type Variant = 'todo' | 'needsYou' | 'inFlight';

/**
 * One task. Tap to open, tap the circle to finish, long-press to move to another day.
 * Agent work shows its state instead of a checkbox.
 */
export function TaskRow({
  task,
  today,
  overdue = false,
  variant = 'todo',
  showProject = true,
  showDay = true,
}: {
  task: TaskWithContext;
  today: DateOnly;
  overdue?: boolean;
  variant?: Variant;
  showProject?: boolean;
  /** Off where the section already names the day, as in Plan. Overdue dates always show. */
  showDay?: boolean;
}) {
  const t = useTheme();
  const router = useRouter();
  const update = useUpdateTask();
  const reschedule = useReschedule();
  const done = task.status === 'done';
  const day = taskDay(task);

  const toggle = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    update.mutate({ id: task.id, patch: { status: done ? 'todo' : 'done' } });
  };

  const meta: string[] = [];
  if (variant !== 'todo') meta.push(STATUS_LABEL[task.status]);
  if (task.agent && variant === 'inFlight') meta.push(task.agent.name);
  if (showProject && task.project) meta.push(task.project.name);
  if (day && (overdue || (showDay && (variant !== 'todo' || day !== today)))) meta.push(overdue ? `Overdue · ${dayLabel(day, today)}` : dayLabel(day, today));

  const tinted = variant === 'needsYou';
  const accent = variant === 'todo' ? null : statusColor(task.status, t);

  return (
    <Pressable
      onPress={() => router.push(`/task/${task.id}`)}
      onLongPress={() => reschedule(task)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}${meta.length ? `, ${meta.join(', ')}` : ''}`}
      accessibilityHint="Opens the task. Long-press to move it to another day."
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? t.surfaceRaised : tinted ? t.needsYouTint : t.surface,
          borderColor: tinted ? `${t.needsYou}55` : t.border,
        },
      ]}
    >
      {variant === 'todo' ? (
        <Pressable
          onPress={toggle}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={done ? 'Mark not done' : 'Mark done'}
          style={styles.check}
        >
          <Ionicons
            name={done ? 'checkmark-circle' : 'ellipse-outline'}
            size={24}
            color={done ? t.idle : task.priority === 3 ? t.needsYou : t.textFaint}
          />
        </Pressable>
      ) : (
        <View style={styles.check}>
          <View style={[styles.liveDot, { backgroundColor: accent ?? t.idle }]} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text
          style={[type.body, { color: done ? t.textFaint : t.text, textDecorationLine: done ? 'line-through' : 'none' }]}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        {meta.length ? (
          <View style={styles.metaRow}>
            {showProject && task.bucket ? <View style={[styles.bucketDot, { backgroundColor: task.bucket.color }]} /> : null}
            <Text style={[type.small, { color: overdue ? t.needsYou : accent ?? t.textMuted }]} numberOfLines={1}>
              {meta.join(' · ')}
            </Text>
          </View>
        ) : null}
      </View>
      {task.priority > 0 && !done ? (
        <Text style={[type.small, { color: task.priority === 3 ? t.needsYou : t.textFaint, fontWeight: '700' }]}>
          {'!'.repeat(task.priority)}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    paddingRight: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginBottom: space.sm,
    minHeight: 56,
  },
  check: { width: 48, alignItems: 'center', justifyContent: 'center' },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  bucketDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
});
