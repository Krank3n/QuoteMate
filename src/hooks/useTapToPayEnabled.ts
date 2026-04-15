/**
 * useTapToPayEnabled
 *
 * Gates the in-app card / Tap to Pay row in TakePaymentSheet behind two ANDed
 * conditions:
 *  1. A remote feature flag at Firestore `config/squareTapToPay`
 *     (`{ ios: boolean, android: boolean }`). Lets us flip iOS on the day
 *     Apple's Tap-to-Pay entitlement is approved without an app release.
 *  2. The device itself supports Tap to Pay (Square SDK probe).
 *
 * Public read on `/config/{docId}` is already allowed by firestore.rules.
 */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../config/firebase';
import { isTapToPayCapable } from '../services/squarePayments';

interface TapToPayFlag {
  ios?: boolean;
  android?: boolean;
}

export interface TapToPayState {
  enabled: boolean;       // true ⇒ show the active row
  reason: 'ready' | 'pending_apple' | 'unsupported_device' | 'flag_off' | 'loading';
}

export function useTapToPayEnabled(): TapToPayState {
  const [state, setState] = useState<TapToPayState>({
    enabled: false,
    reason: 'loading',
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'config', 'squareTapToPay'));
        const flag = (snap.exists() ? snap.data() : {}) as TapToPayFlag;

        const platformAllowed =
          Platform.OS === 'ios' ? !!flag.ios : !!flag.android;

        if (!platformAllowed) {
          if (!cancelled) {
            setState({
              enabled: false,
              reason: Platform.OS === 'ios' ? 'pending_apple' : 'flag_off',
            });
          }
          return;
        }

        const capable = await isTapToPayCapable();
        if (cancelled) return;

        setState({
          enabled: capable,
          reason: capable ? 'ready' : 'unsupported_device',
        });
      } catch {
        if (!cancelled) setState({ enabled: false, reason: 'flag_off' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
