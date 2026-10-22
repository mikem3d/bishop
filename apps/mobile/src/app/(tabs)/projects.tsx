import { isOpen } from '@bishop/core';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { InlineAdd } from '../../components/InlineAdd';
import { Card, EmptyLine, ErrorLine, Loading, Screen, SectionHeader } from '../../components/ui';
import { useBuckets, useCreateBucket, useCreateProject, useProjects, useTasks, useWorkspace } from '../../lib/queries';
import { BUCKET_COLORS, space, type, useTheme } from '../../lib/theme';

/** Buckets and their projects, each with its linked agent and open work. */
export default function Projects() {
  const t = useTheme();
  const router = useRouter();
  const ws = useWorkspace();
  const buckets = useBuckets();
  const projects = useProjects();
  const tasks = useTasks();
  const createBucket = useCreateBucket();
  const createProject = useCreateProject();

  if (buckets.isPending || projects.isPending) return <Loading />;

  const openCount = (projectId: string) =>
    (tasks.data ?? []).filter((x) => x.project_id === projectId && isOpen(x)).length;
  const runningCount = (projectId: string) =>
    (tasks.data ?? []).filter((x) => x.project_id === projectId && (x.status === 'in_progress' || x.status === 'queued')).length;

  return (
    <Screen
      title="Projects"
      onRefresh={() => {
        void buckets.refetch();
        void projects.refetch();
      }}
      refreshing={buckets.isRefetching || projects.isRefetching}
      fab={false}
    >
      <ErrorLine error={buckets.error ?? projects.error ?? createBucket.error ?? createProject.error} />
      {(buckets.data ?? []).map((b) => {
        const list = (projects.data ?? []).filter((p) => p.bucket_id === b.id);
        return (
          <View key={b.id}>
            <SectionHeader title={b.name} count={list.length} color={b.color} />
            {list.length ? (
              <Card>
                {list.map((p, i) => {
                  const open = openCount(p.id);
                  const running = runningCount(p.id);
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => router.push(`/project/${p.id}`)}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.row,
                        {
                          backgroundColor: pressed ? t.surfaceRaised : 'transparent',
                          borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                          borderTopColor: t.border,
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[type.body, { color: t.text }]}>{p.name}</Text>
                        <Text style={[type.small, { color: t.textFaint, marginTop: 2 }]}>
                          {p.linkedAgent ? `Linked to ${p.linkedAgent.name}` : 'Not linked'}
                          {running ? ` · ${running} in flight` : ''}
                        </Text>
                      </View>
                      <Text style={[type.body, { color: open ? t.text : t.textFaint, marginRight: space.sm }]}>{open}</Text>
                      <Ionicons name="chevron-forward" size={18} color={t.textFaint} />
                    </Pressable>
                  );
                })}
              </Card>
            ) : (
              <EmptyLine>No projects yet.</EmptyLine>
            )}
            {ws.data ? (
              <InlineAdd
                label={`Add project to ${b.name}`}
                placeholder="Project name"
                onAdd={(name) => createProject.mutate({ workspace_id: ws.data.id, bucket_id: b.id, name })}
              />
            ) : null}
          </View>
        );
      })}
      {ws.data ? (
        <View style={{ marginTop: space.xl }}>
          <InlineAdd
            label="Add bucket"
            placeholder="Bucket name"
            onAdd={(name) =>
              createBucket.mutate({
                workspace_id: ws.data.id,
                name,
                color: BUCKET_COLORS[(buckets.data?.length ?? 0) % BUCKET_COLORS.length],
              })
            }
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, paddingHorizontal: space.lg, minHeight: 60 },
});
