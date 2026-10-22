import { toDateOnly, type DateOnly } from '@bishop/core';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** Today's local date, refreshed when the app returns to the foreground or passes midnight. */
export function useToday(): DateOnly {
  const [today, setToday] = useState(() => toDateOnly(new Date()));
  useEffect(() => {
    const refresh = () => setToday(toDateOnly(new Date()));
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    const timer = setInterval(refresh, 60_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);
  return today;
}
