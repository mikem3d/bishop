import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RescheduleProvider } from '../components/Reschedule';
import { Loading } from '../components/ui';
import { AuthProvider, useAuth } from '../lib/auth';
import { useLiveUpdates } from '../lib/queries';
import { useTheme } from '../lib/theme';

function Navigator() {
  const { session, loading } = useAuth();
  const t = useTheme();
  useLiveUpdates(!!session);
  if (loading) return <Loading />;

  return (
    <Stack
      screenOptions={{
        headerTintColor: t.idle,
        headerTitleStyle: { color: t.text },
        headerStyle: { backgroundColor: t.bg },
        headerShadowVisible: false,
        headerTransparent: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    >
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="task/[id]" options={{ title: '' }} />
        <Stack.Screen name="project/[id]" options={{ title: '' }} />
        <Stack.Screen name="new-task" options={{ presentation: 'modal', title: 'New task' }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RescheduleProvider>
            <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
            <Navigator />
          </RescheduleProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
