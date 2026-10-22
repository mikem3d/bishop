import type { DateOnly, Priority, Uuid } from '@bishop/core';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { DayPicker, FieldLabel, PriorityPicker, ProjectPicker } from '../components/Pickers';
import { Button, ErrorLine } from '../components/ui';
import { useBuckets, useCreateTask, useProjects, useWorkspace } from '../lib/queries';
import { radius, space, type, useTheme } from '../lib/theme';
import { useToday } from '../lib/today';

/** Quick add. Opens with a project or day pre-selected when launched from one. */
export default function NewTask() {
  const t = useTheme();
  const router = useRouter();
  const today = useToday();
  const params = useLocalSearchParams<{ project_id?: string; day?: string }>();
  const ws = useWorkspace();
  const projects = useProjects();
  const buckets = useBuckets();
  const create = useCreateTask();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [projectId, setProjectId] = useState<Uuid | null>(params.project_id ?? null);
  const [day, setDay] = useState<DateOnly | null>(params.day ?? null);
  const [priority, setPriority] = useState<Priority>(0);

  const save = () => {
    if (!ws.data || !title.trim()) return;
    create.mutate(
      {
        workspace_id: ws.data.id,
        title: title.trim(),
        notes: notes.trim(),
        project_id: projectId,
        scheduled_for: day,
        priority,
      },
      {
        onSuccess: () => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <TextInput
          autoFocus
          value={title}
          onChangeText={setTitle}
          placeholder="What needs doing?"
          placeholderTextColor={t.textFaint}
          style={[type.heading, { color: t.text, fontSize: 22, paddingVertical: space.sm }]}
          multiline
          submitBehavior="blurAndSubmit"
          returnKeyType="done"
          onSubmitEditing={save}
          accessibilityLabel="Task title"
        />
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes"
          placeholderTextColor={t.textFaint}
          style={[type.body, { color: t.text, borderColor: t.border, borderWidth: 1, borderRadius: radius.md, padding: space.md, minHeight: 72, marginTop: space.sm, textAlignVertical: 'top' }]}
          multiline
          accessibilityLabel="Notes"
        />

        <FieldLabel>Project</FieldLabel>
        <ProjectPicker projects={projects.data ?? []} buckets={buckets.data ?? []} value={projectId} onChange={setProjectId} />

        <FieldLabel>When</FieldLabel>
        <DayPicker today={today} value={day} onChange={setDay} />

        <FieldLabel>Priority</FieldLabel>
        <PriorityPicker value={priority} onChange={setPriority} />

        <View style={{ marginTop: space.xl }}>
          <Button label="Add task" icon="add" onPress={save} disabled={!title.trim() || !ws.data} loading={create.isPending} />
        </View>
        <ErrorLine error={create.error} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
