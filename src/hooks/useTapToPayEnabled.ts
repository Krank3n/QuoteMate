/**
 * useTapToPayEnabled
 *
 * Gates the in-app card / Tap to Pay row in TakePaymentSheet behind two ANDed
 * conditions:
 *  1. A remote feature flag at Firestore `config/squareTapToPay`
 *     (`{ ios: boolean, android: boolean }`) — or a local dev build, see below.
 *  2. The device itself supports Tap to Pay (Square SDK probe).
 *
 * On iOS the flag must stay OFF in production until Apple grants the
 * *publishing* entitlement. Apple's Apr 2026 grant is development-only, so
 * every shipped build carries no entitlement: flipping `ios: true` would light
 * the row up for real tradies and then fail at `authorize()` in front of a
 * paying customer. A local dev build IS signed with the development
 * entitlement, so it bypasses the flag — that is the only way to exercise the
 * flow before the publishing entitlement lands.
 *
 * NOTE: Apple requirement 5.3 says this button must never be greyed out, and
 * 3.7 says pressing it should open T&C acceptance. Both conflict with the
 * disabled row TakePaymentSheet renders today — see docs/SQUARE_TAP_TO_PAY.md.
 *
 * Public read on `/config/{docId}` is already allowed by firestore.rules.
 */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';

import { auth, db } from '../config/firebase';
import { isTapToPayCapable } from '../services/squarePayments';
import { isTapToPayOsSupported } from '../services/tapToPayErrors';

interface TapToPayFlag {
  ios?: boolean;
  android?: boolean;
  /**
   * UIDs allowed through regardless of the platform flag.
   *
   * Exists because a Release build has no `__DEV__` bypass, so the only way to
   * exercise Tap to Pay on iPhone before the publishing entitlement lands would
   * otherwise be flipping `ios` globally — which would light the row up for
   * every tradie on an App Store build, none of which carry the entitlement at
   * all. Apple's flow recordings have to be shot on a Release build (a debug
   * one shows the Expo dev launcher), so this is the only safe way to film.
   *
   * Empty in normal operation. Clear it once `ios` goes true for real.
   */
  allowUserIds?: string[];
  /**
   * Same escape hatch, matched on email instead.
   *
   * Needed because Apple's "New User Flow" recording has to show account
   * creation, so the account does not exist until the camera is already
   * rolling — there is no uid to allowlist beforehand. The email is chosen in
   * advance, so it can be. Compared case-insensitively; addresses are not
   * case-sensitive in practice and a capitalised sign-up would otherwise fail
   * silently, mid-shoot.
   */
  allowEmails?: string[];
}

export interface TapToPayState {
  enabled: boolean;       // true ⇒ show the active row
  reason:
    | 'ready'
    | 'pending_apple'
    | 'unsupported_device'
    /** Apple req 1.4 — capable hardware, but the OS is below the floor. */
    | 'os_too_old'
    | 'flag_off'
    | 'loading';
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

        const uid = auth.currentUser?.uid ?? null;
        const email = auth.currentUser?.email?.trim().toLowerCase() ?? null;
        const allowlisted =
          (!!uid &&
            Array.isArray(flag.allowUserIds) &&
            flag.allowUserIds.includes(uid)) ||
          (!!email &&
            Array.isArray(flag.allowEmails) &&
            flag.allowEmails.some(
              (e) => typeof e === 'string' && e.trim().toLowerCase() === email,
            ));

        const platformAllowed =
          __DEV__ ||
          allowlisted ||
          (Platform.OS === 'ios' ? !!flag.ios : !!flag.android);

        if (!platformAllowed) {
          if (!cancelled) {
            setState({
              enabled: false,
              reason: Platform.OS === 'ios' ? 'pending_apple' : 'flag_off',
            });
          }
          return;
        }

        // Apple req 1.4: an OS below the floor is a distinct state from
        // incapable hardware. Checked BEFORE the SDK probe, because
        // isDeviceCapable() answers about the Secure Element and would happily
        // say "yes" on an iPhone that then fails at authorize().
        if (!isTapToPayOsSupported()) {
          if (!cancelled) setState({ enabled: false, reason: 'os_too_old' });
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
