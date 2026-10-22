import { isAgentOnline } from '@bishop/core';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Button, Card, ErrorLine, Loading, Screen } from '../../components/ui';
import { signOut } from '../../lib/auth';
import { useAgents, useTasks } from '../../lib/queries';
import { space, type, useTheme } from '../../lib/theme';

/** Each Mac's agent: online or not, what it can do, what it's running. */
export default function Agents() {
  const t = useTheme();
  const agents = useAgents();
  const tasks = useTasks();
  if (agents.isPending) return <Loading />;
  const list = agents.data ?? [];

  return (
    <Screen title="Agents" fab={false} onRefresh={() => void agents.refetch()} refreshing={agents.isRefetching}>
      <ErrorLine error={agents.error} />
      {list.length === 0 ? (
        <Card style={{ padding: space.xl, alignItems: 'center' }}>
          <Avatar state="thinking" size={64} />
          <Text style={[type.heading, { color: t.text, marginTop: space.md }]}>No agents yet</Text>
          <Text style={[type.small, { color: t.textMuted, marginTop: space.xs, textAlign: 'center' }]}>
            Agents arrive in v2. On each Mac, run bishop login, then bishop link in a project's folder.
          </Text>
        </Card>
      ) : (
        <Card>
          {list.map((a, i) => {
            const online = isAgentOnline(a);
            const running = (tasks.data ?? []).filter((x) => x.assignee_agent_id === a.id && x.status === 'in_progress').length;
            return (
              <View key={a.id} style={[styles.row, { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: t.border }]}>
                <View style={[styles.dot, { backgroundColor: online ? t.idle : t.textFaint }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: t.text }]}>{a.name}</Text>
                  <Text style={[type.small, { color: t.textFaint, marginTop: 2 }]}>
                    {[a.mac, online ? 'Online' : 'Offline', running ? `${running} running` : null, a.capabilities.join(', ') || null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              </View>
            );
          })}
        </Card>
      )}
      <View style={{ marginTop: space.xxl }}>
        <Button label="Sign out" kind="secondary" icon="log-out-outline" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: space.lg },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: space.md },
});
