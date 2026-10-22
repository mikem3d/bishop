import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, type, useTheme } from '../lib/theme';

/** A tab screen: large title, optional right-side element, pull to refresh. */
export function Screen({
  title,
  subtitle,
  right,
  children,
  onRefresh,
  refreshing = false,
  fab = true,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  fab?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingBottom: 120, paddingHorizontal: space.lg }}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.textMuted} /> : undefined}
      >
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={[type.title, { color: t.text }]} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text style={[type.small, { color: t.textMuted, marginTop: 2 }]}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
        {children}
      </ScrollView>
      {fab ? <AddButton /> : null}
    </View>
  );
}

/** Floating button that opens quick add. */
export function AddButton({ params }: { params?: Record<string, string> }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add task"
      onPress={() => router.push({ pathname: '/new-task', params })}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: t.idle, opacity: pressed ? 0.85 : 1, shadowColor: '#000' },
      ]}
    >
      <Ionicons name="add" size={30} color={t.onAccent} />
    </Pressable>
  );
}

export function SectionHeader({ title, count, color, action }: { title: string; count?: number; color?: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.sectionHeader}>
      {color ? <View style={[styles.sectionDot, { backgroundColor: color }]} /> : null}
      <Text style={[type.heading, { color: t.text, flex: 1 }]} accessibilityRole="header">
        {title}
        {count !== undefined ? <Text style={{ color: t.textFaint, fontWeight: '500' }}>  {count}</Text> : null}
      </Text>
      {action}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>{children}</View>;
}

export function EmptyLine({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[type.small, { color: t.textFaint, paddingVertical: space.sm }]}>{children}</Text>;
}

export function Chip({
  label,
  selected,
  onPress,
  color,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  color?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const t = useTheme();
  const accent = color ?? t.idle;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: selected ? accent : t.border, backgroundColor: selected ? `${accent}22` : t.surface },
      ]}
    >
      {icon ? <Ionicons name={icon} size={14} color={selected ? accent : t.textMuted} style={{ marginRight: 4 }} /> : null}
      <Text style={[type.small, { color: selected ? t.text : t.textMuted, fontWeight: selected ? '600' : '400' }]}>{label}</Text>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.idle : kind === 'danger' ? t.needsYouTint : t.surfaceRaised;
  const fg = kind === 'primary' ? t.onAccent : kind === 'danger' ? t.needsYou : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1, borderColor: kind === 'secondary' ? t.border : 'transparent' },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 6 }} /> : null}
          <Text style={[type.body, { color: fg, fontWeight: '600' }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
      <ActivityIndicator color={t.textMuted} />
    </View>
  );
}

export function ErrorLine({ error }: { error: unknown }) {
  const t = useTheme();
  if (!error) return null;
  return (
    <Text style={[type.small, { color: t.needsYou, paddingVertical: space.sm }]}>
      {error instanceof Error ? error.message : String(error)}
    </Text>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: space.xl, marginBottom: space.sm },
  sectionDot: { width: 8, height: 8, borderRadius: 4, marginRight: space.sm },
  card: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginRight: space.sm,
    marginBottom: space.sm,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  fab: {
    position: 'absolute',
    right: space.xl,
    bottom: space.xl,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
