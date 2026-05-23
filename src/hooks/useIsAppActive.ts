import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Tracks whether the app is in the foreground. Returns true while AppState
 * is 'active', false on 'background' / 'inactive'. Used to gate ambient
 * looping animations so they don't keep ticking the native compositor when
 * the user has switched away — left running, they accumulate cost over the
 * session and only release when iOS suspends the process (~10–15 min).
 */
export function useIsAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      setActive(next === 'active');
    });
    return () => sub.remove();
  }, []);

  return active;
}
