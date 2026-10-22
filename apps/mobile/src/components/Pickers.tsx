import type { Bucket, DateOnly, Priority, ProjectWithLink, Uuid } from '@bishop/core';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { space, type, useTheme } from '../lib/theme';
import { dayOptions } from './Reschedule';
import { Chip } from './ui';

export function FieldLabel({ children }: { children: string }) {
  const t = useTheme();
  return <Text style={[type.tiny, styles.label, { color: t.textFaint }]}>{children.toUpperCase()}</Text>;
}

export function DayPicker({ today, value, onChange }: { today: DateOnly; value: DateOnly | null; onChange: (d: DateOnly | null) => void }) {
  const options = dayOptions(today);
  const matched = options.some((o) => o.day === value);
  return (
    <View style={styles.wrap}>
      {options.map((o) => (
        <Chip key={o.label} label={o.label} icon={o.icon} selected={o.day === value} onPress={() => onChange(o.day)} />
      ))}
      {!matched && value ? <Chip label={value} selected onPress={() => onChange(value)} /> : null}
    </View>
  );
}

const PRIORITIES: { label: string; value: Priority }[] = [
  { label: 'None', value: 0 },
  { label: 'Low', value: 1 },
  { label: 'Medium', value: 2 },
  { label: 'High', value: 3 },
];

export function PriorityPicker({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  const t = useTheme();
  return (
    <View style={styles.wrap}>
      {PRIORITIES.map((p) => (
        <Chip
          key={p.value}
          label={p.label}
          selected={p.value === value}
          color={p.value === 3 ? t.needsYou : undefined}
          onPress={() => onChange(p.value)}
        />
      ))}
    </View>
  );
}

export function ProjectPicker({
  projects,
  buckets,
  value,
  onChange,
}: {
  projects: ProjectWithLink[];
  buckets: Bucket[];
  value: Uuid | null;
  onChange: (id: Uuid | null) => void;
}) {
  const color = (bucketId: Uuid) => buckets.find((b) => b.id === bucketId)?.color;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: space.lg }}>
      <Chip label="Inbox" icon="file-tray-outline" selected={value === null} onPress={() => onChange(null)} />
      {projects.map((p) => (
        <Chip key={p.id} label={p.name} color={color(p.bucket_id)} selected={p.id === value} onPress={() => onChange(p.id)} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  label: { marginTop: space.xl, marginBottom: space.sm },
});
