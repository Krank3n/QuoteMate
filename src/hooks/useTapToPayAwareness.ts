/**
 * useTapToPayAwareness
 *
 * Drives the Apple req 3.1 / 3.3 awareness banner. Keeps the three async reads
 * it needs — device eligibility, Square connection, Apple's record of T&C
 * acceptance — out of the dashboard, which has enough going on.
 *
 * The decision itself lives in `shouldShowTapToPayAwareness` so it is testable
 * without mounting anything.
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTapToPayEnabled } from './useTapToPayEnabled';
import { isTapToPayTermsAccepted } from '../services/squarePayments';
import { checkSquareConnection } from '../services/squareService';
import { shouldShowTapToPayAwareness } from '../utils/tapToPayAwareness';

export const TAP_TO_PAY_AWARENESS_DISMISSED_KEY = 'tapToPayAwarenessDismissedAt';

export interface TapToPayAwarenessState {
  visible: boolean;
  dismiss: () => void;
}

export function useTapToPayAwareness(): TapToPayAwarenessState {
  const tapToPay = useTapToPayEnabled();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Cheap, synchronous disqualifiers first — no point paying for a network
      // round trip to tell an Android tradie about an iPhone feature.
      if (Platform.OS !== 'ios' || !tapToPay.enabled) {
        if (!cancelled) setVisible(false);
        return;
      }

      try {
        const [dismissedRaw, termsAccepted, connection] = await Promise.all([
          AsyncStorage.getItem(TAP_TO_PAY_AWARENESS_DISMISSED_KEY),
          isTapToPayTermsAccepted(),
          checkSquareConnection().catch(() => ({ connected: false })),
        ]);
        if (cancelled) return;

        const parsed = dismissedRaw === null ? null : Number(dismissedRaw);
        setVisible(
          shouldShowTapToPayAwareness({
            platformOS: Platform.OS,
            tapToPayEnabled: tapToPay.enabled,
            squareConnected: Boolean(connection?.connected),
            termsAccepted,
            // A stored value that will not parse is treated as dismissed: a
            // banner that reappears because of a bad write is worse than one
            // that stays hidden.
            dismissedAt: parsed === null || Number.isNaN(parsed) ? (parsed === null ? null : 0) : parsed,
          }),
        );
      } catch {
        if (!cancelled) setVisible(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tapToPay.enabled]);

  const dismiss = useCallback(() => {
    setVisible(false);
    void AsyncStorage.setItem(
      TAP_TO_PAY_AWARENESS_DISMISSED_KEY,
      String(Date.now()),
    ).catch(() => {
      /* Hiding it this session is the part that matters to the tradie. */
    });
  }, []);

  return { visible, dismiss };
}
