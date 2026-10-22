import { dayLabel, dueDay, type TaskEvent, type TaskLink } from '@bishop/core';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DayPicker, FieldLabel, PriorityPicker, ProjectPicker } from '../../components/Pickers';
import { STATUS_LABEL, statusColor } from '../../components/TaskRow';
import { Button, Card, ErrorLine, Loading } from '../../components/ui';
import {
  useAddComment,
  useAddLink,
  useBuckets,
  useDeleteLink,
  useDeleteTask,
  useProjects,
  useTask,
  useTaskEvents,
  useTaskLinks,
  useUpdateTask,
} from '../../lib/queries';
import { radius, space, type, useTheme } from '../../lib/theme';
import { useToday } from '../../lib/today';

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const router = useRouter();
  const today = useToday();
  const task = useTask(id);
  const events = useTaskEvents(id);
  const links = useTaskLinks(id);
  const projects = useProjects();
  const buckets = useBuckets();
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const comment = useAddComment(id);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [reply, setReply] = useState('');
  useEffect(() => {
    if (task.data) {
      setTitle(task.data.title);
      setNotes(task.data.notes);
    }
  }, [task.data?.id, task.data?.title, task.data?.notes]);

  if (task.isPending) return <Loading />;
  if (!task.data) return <ErrorLine error={task.error ?? 'Task not found.'} />;
  const x = task.data;
  const patch = (p: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ id: x.id, patch: p });
  const linkedProject = (projects.data ?? []).find((p) => p.id === x.project_id);
  const isAgentWork = !!x.assignee_agent_id || ['queued', 'in_progress', 'needs_review', 'blocked', 'failed'].includes(x.status);

  const sendReply = (kind: 'comment' | 'answer', then?: () => void) => {
    const body = reply.trim();
    if (!body) return;
    comment.mutate({ workspace_id: x.workspace_id, body, kind }, { onSuccess: () => { setReply(''); then?.(); } });
  };

  const confirmDelete = () =>
    Alert.alert('Delete task?', x.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => remove.mutate(x.id, { onSuccess: () => router.back() }),
      },
    ]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg }} keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{
          title: x.project?.name ?? 'Inbox',
          headerRight: () => (
            <Pressable onPress={confirmDelete} hitSlop={10} accessibilityRole="button" accessibilityLabel="Delete task">
              <Ionicons name="trash-outline" size={22} color={t.textMuted} />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.status, { backgroundColor: `${statusColor(x.status, t)}22` }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor(x.status, t) }]} />
          <Text style={[type.small, { color: t.text, fontWeight: '600' }]}>{STATUS_LABEL[x.status]}</Text>
          {x.agent ? <Text style={[type.small, { color: t.textMuted }]}> · {x.agent.name}</Text> : null}
        </View>

        <TextInput
          value={title}
          onChangeText={setTitle}
          onEndEditing={() => title.trim() && title !== x.title && patch({ title: title.trim() })}
          style={[type.title, { color: t.text, fontSize: 24, marginTop: space.md }]}
          multiline
          submitBehavior="blurAndSubmit"
          accessibilityLabel="Title"
        />

        <ReviewActions
          status={x.status}
          reply={reply}
          onApprove={() => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); patch({ status: 'done' }); }}
          onSendBack={() => sendReply('comment', () => patch({ status: 'queued' }))}
          onAnswer={() => sendReply('answer', () => patch({ status: 'queued' }))}
          onRequeue={() => patch({ status: 'queued' })}
        />

        {!isAgentWork ? (
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
            <View style={{ flex: 1 }}>
              <Button
                label={x.status === 'done' ? 'Reopen' : 'Mark done'}
                icon={x.status === 'done' ? 'refresh' : 'checkmark'}
                kind={x.status === 'done' ? 'secondary' : 'primary'}
                onPress={() => patch({ status: x.status === 'done' ? 'todo' : 'done' })}
              />
            </View>
            {linkedProject?.linkedAgent && x.status !== 'done' ? (
              <View style={{ flex: 1 }}>
                <Button label="Queue for agent" icon="flash-outline" kind="secondary" onPress={() => patch({ status: 'queued' })} />
              </View>
            ) : null}
          </View>
        ) : null}

        <FieldLabel>Notes</FieldLabel>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          onEndEditing={() => notes !== x.notes && patch({ notes })}
          placeholder="Add notes"
          placeholderTextColor={t.textFaint}
          multiline
          style={[type.body, styles.box, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]}
          accessibilityLabel="Notes"
        />

        <FieldLabel>When</FieldLabel>
        <DayPicker today={today} value={x.scheduled_for} onChange={(d) => patch({ scheduled_for: d })} />
        {x.due_at ? (
          <Text style={[type.small, { color: t.textMuted }]}>Due {dayLabel(dueDay(x.due_at)!, today)}</Text>
        ) : null}

        <FieldLabel>Project</FieldLabel>
        <ProjectPicker projects={projects.data ?? []} buckets={buckets.data ?? []} value={x.project_id} onChange={(p) => patch({ project_id: p })} />

        <FieldLabel>Priority</FieldLabel>
        <PriorityPicker value={x.priority} onChange={(p) => patch({ priority: p })} />

        <FieldLabel>Tickets</FieldLabel>
        <Links taskId={x.id} workspaceId={x.workspace_id} links={links.data ?? []} />

        <FieldLabel>Thread</FieldLabel>
        <Thread events={events.data ?? []} />
        <View style={[styles.replyRow, { borderColor: t.border, backgroundColor: t.surface }]}>
          <TextInput
            value={reply}
            onChangeText={setReply}
            placeholder={x.status === 'blocked' ? 'Answer the question' : 'Add a comment'}
            placeholderTextColor={t.textFaint}
            multiline
            style={[type.body, { flex: 1, color: t.text, paddingVertical: space.sm }]}
            accessibilityLabel="Comment"
          />
          {x.status !== 'blocked' && x.status !== 'needs_review' ? (
            <Pressable onPress={() => sendReply('comment')} disabled={!reply.trim()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Send comment">
              <Ionicons name="arrow-up-circle" size={30} color={reply.trim() ? t.idle : t.textFaint} />
            </Pressable>
          ) : null}
        </View>
        <ErrorLine error={update.error ?? comment.error ?? remove.error} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** The decisions only you can make on agent work. */
function ReviewActions({
  status,
  reply,
  onApprove,
  onSendBack,
  onAnswer,
  onRequeue,
}: {
  status: string;
  reply: string;
  onApprove: () => void;
  onSendBack: () => void;
  onAnswer: () => void;
  onRequeue: () => void;
}) {
  const t = useTheme();
  if (status === 'needs_review') {
    return (
      <Card style={{ padding: space.lg, marginTop: space.lg, borderColor: `${t.needsYou}55` }}>
        <Text style={[type.small, { color: t.textMuted, marginBottom: space.md }]}>
          The agent finished. Approve it, or write what to change below and send it back.
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}><Button label="Approve" icon="checkmark" onPress={onApprove} /></View>
          <View style={{ flex: 1 }}><Button label="Send back" icon="return-up-back" kind="secondary" disabled={!reply.trim()} onPress={onSendBack} /></View>
        </View>
      </Card>
    );
  }
  if (status === 'blocked') {
    return (
      <Card style={{ padding: space.lg, marginTop: space.lg, borderColor: `${t.needsYou}55` }}>
        <Text style={[type.small, { color: t.textMuted, marginBottom: space.md }]}>
          The agent has a question in the thread. Answer it below and it picks the task back up.
        </Text>
        <Button label="Send answer" icon="send" disabled={!reply.trim()} onPress={onAnswer} />
      </Card>
    );
  }
  if (status === 'failed') {
    return (
      <Card style={{ padding: space.lg, marginTop: space.lg, borderColor: `${t.needsYou}55` }}>
        <Text style={[type.small, { color: t.textMuted, marginBottom: space.md }]}>The run stopped unexpectedly. The thread has its log.</Text>
        <Button label="Run again" icon="refresh" onPress={onRequeue} />
      </Card>
    );
  }
  return null;
}

function Links({ taskId, workspaceId, links }: { taskId: string; workspaceId: string; links: TaskLink[] }) {
  const t = useTheme();
  const add = useAddLink(taskId);
  const del = useDeleteLink(taskId);
  const [url, setUrl] = useState('');
  const submit = () => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) return;
    add.mutate({ workspace_id: workspaceId, url: u }, { onSuccess: () => setUrl('') });
  };
  return (
    <View>
      {links.map((l) => (
        <Pressable
          key={l.id}
          onPress={() => void Linking.openURL(l.url)}
          onLongPress={() => Alert.alert('Remove link?', l.key, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => del.mutate(l.id) }])}
          accessibilityRole="link"
          style={[styles.link, { backgroundColor: t.surface, borderColor: t.border }]}
        >
          <Text style={[type.tiny, styles.system, { color: t.textMuted, borderColor: t.border }]}>{l.system.toUpperCase()}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { color: t.text }]} numberOfLines={1}>{l.snapshot.title ?? l.key}</Text>
            <Text style={[type.small, { color: t.textFaint }]} numberOfLines={1}>
              {[l.snapshot.title ? l.key : null, l.snapshot.status, l.snapshot.assignee].filter(Boolean).join(' · ') || 'Not synced yet'}
            </Text>
          </View>
          <Ionicons name="open-outline" size={18} color={t.textFaint} />
        </Pressable>
      ))}
      <View style={[styles.replyRow, { borderColor: t.border, backgroundColor: t.surface, marginTop: 0 }]}>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="Paste a Jira, GitHub or Linear link"
          placeholderTextColor={t.textFaint}
          autoCapitalize="none"
          keyboardType="url"
          style={[type.body, { flex: 1, color: t.text, paddingVertical: space.md }]}
          onSubmitEditing={submit}
          accessibilityLabel="Ticket link"
        />
        <Pressable onPress={submit} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add link">
          <Ionicons name="add-circle" size={28} color={/^https?:\/\//i.test(url.trim()) ? t.idle : t.textFaint} />
        </Pressable>
      </View>
      <ErrorLine error={add.error} />
    </View>
  );
}

const EVENT_ICON: Record<TaskEvent['kind'], keyof typeof Ionicons.glyphMap> = {
  comment: 'chatbubble-outline',
  answer: 'arrow-redo-outline',
  question: 'help-circle-outline',
  status: 'swap-horizontal-outline',
  ticket_action: 'ticket-outline',
  run_log: 'terminal-outline',
};

function Thread({ events }: { events: TaskEvent[] }) {
  const t = useTheme();
  if (!events.length) return <Text style={[type.small, { color: t.textFaint }]}>No activity yet.</Text>;
  return (
    <View>
      {events.map((e) => {
        const quiet = e.kind === 'status' || e.kind === 'run_log';
        const who = e.actor_agent_id ? 'Agent' : 'You';
        const when = new Date(e.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        return (
          <View key={e.id} style={styles.event}>
            <Ionicons name={EVENT_ICON[e.kind]} size={16} color={e.kind === 'question' ? t.needsYou : t.textFaint} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, marginLeft: space.sm }}>
              <Text style={[quiet ? type.small : type.body, { color: quiet ? t.textMuted : t.text }]}>
                {e.kind === 'status' ? `${who} moved it: ${e.body.replace(/_/g, ' ')}` : e.body}
              </Text>
              <Text style={[type.small, { color: t.textFaint, marginTop: 2 }]}>
                {quiet ? when : `${who} · ${when}`}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  box: { borderWidth: 1, borderRadius: radius.md, padding: space.md, minHeight: 88, textAlignVertical: 'top' },
  replyRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, marginTop: space.md },
  link: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  system: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, marginRight: space.md, overflow: 'hidden' },
  event: { flexDirection: 'row', paddingVertical: space.sm },
});
