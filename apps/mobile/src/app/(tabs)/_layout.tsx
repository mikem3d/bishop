import { buildHome } from '@bishop/core';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useTasks } from '../../lib/queries';
import { useTheme } from '../../lib/theme';
import { useToday } from '../../lib/today';

type IconName = keyof typeof Ionicons.glyphMap;
const icon = (name: IconName) => ({ color, size }: { color: ColorValue; size: number }) => (
  <Ionicons name={name} color={color as string} size={size} />
);

export default function TabsLayout() {
  const t = useTheme();
  const today = useToday();
  const tasks = useTasks();
  const view = tasks.data ? buildHome(tasks.data, today) : null;
  const needsYou = view?.counts.needsYou ?? 0;
  const inbox = view?.inbox.length ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.idle,
        tabBarInactiveTintColor: t.textFaint,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: icon('home-outline'),
          tabBarBadge: needsYou > 0 ? needsYou : undefined,
          tabBarBadgeStyle: { backgroundColor: t.needsYou },
        }}
      />
      <Tabs.Screen name="plan" options={{ title: 'Plan', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: icon('file-tray-outline'),
          tabBarBadge: inbox > 0 ? inbox : undefined,
          tabBarBadgeStyle: { backgroundColor: t.textFaint },
        }}
      />
      <Tabs.Screen name="projects" options={{ title: 'Projects', tabBarIcon: icon('albums-outline') }} />
      <Tabs.Screen name="agents" options={{ title: 'Agents', tabBarIcon: icon('hardware-chip-outline') }} />
    </Tabs>
  );
}
