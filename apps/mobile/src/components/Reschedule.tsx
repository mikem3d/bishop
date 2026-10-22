import { addDays, fromDateOnly, toDateOnly, type DateOnly, type Task } from '@bishop/core';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUpdateTask } from '../lib/queries';
import { radius, space, type, useTheme } from '../lib/theme';

export interface DayOption {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  day: DateOnly | null;
}

/** Quick day choices relative to today. */
export function dayOptions(today: DateOnly): DayOption[] {
  const d = fromDateOnly(today).getDay(); // 0 Sun … 6 Sat
  const toSaturday = (6 - d + 7) % 7 || 7;
  const toMonday = (1 - d + 7) % 7 || 7;
  return [
    { label: 'Today', icon: 'today-outline', day: today },
    { label: 'Tomorrow', icon: 'sunny-outline', day: addDays(today, 1) },
    { label: 'This weekend', icon: 'cafe-outline', day: addDays(today, toSaturday) },
    { label: 'Next week', icon: 'calendar-outline', day: addDays(today, toMonday) },
    { label: 'No date', icon: 'remove-circle-outline', day: null },
  ];
}

const RescheduleContext = createContext<(task: Task) => void>(() => {});

/** Long-press any task to move it to another day. */
export function RescheduleProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [task, setTask] = useState<Task | null>(null);
  const update = useUpdateTask();

  const open = useCallback((x: Task) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTask(x);
  }, []);

  const choose = (day: DateOnly | null) => {
    if (task) update.mutate({ id: task.id, patch: { scheduled_for: day } });
    setTask(null);
  };

  return (
    <RescheduleContext.Provider value={open}>
      {children}
      <Modal visible={!!task} transparent animationType="fade" onRequestClose={() => setTask(null)}>
        <Pressable style={styles.backdrop} onPress={() => setTask(null)} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: t.surface, paddingBottom: insets.bottom + space.md }]}>
          <Text style={[type.small, { color: t.textMuted, marginBottom: space.sm }]} numberOfLines={1}>
            Move “{task?.title}”
          </Text>
          {dayOptions(toDateOnly(new Date())).map((o) => (
            <Pressable
              key={o.label}
              onPress={() => choose(o.day)}
              style={({ pressed }) => [styles.option, { backgroundColor: pressed ? t.surfaceRaised : 'transparent' }]}
              accessibilityRole="button"
            >
              <Ionicons name={o.icon} size={20} color={t.textMuted} />
              <Text style={[type.body, { color: t.text, marginLeft: space.md, flex: 1 }]}>{o.label}</Text>
              {o.day && o.label !== 'Today' && o.label !== 'Tomorrow' ? (
                <Text style={[type.small, { color: t.textFaint }]}>
                  {fromDateOnly(o.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      </Modal>
    </RescheduleContext.Provider>
  );
}

export const useReschedule = () => useContext(RescheduleContext);

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
  },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: space.sm, borderRadius: radius.sm },
});
