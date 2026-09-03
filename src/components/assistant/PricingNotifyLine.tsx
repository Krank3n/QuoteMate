/**
 * "Lock your phone if you like" / "Tell me when it's done" — the line under
 * Mate's working card while a quote prices on the server. See
 * services/pricingNotifyLine for the decision logic and why the tap goes
 * straight to the OS prompt.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useThemeColors } from '../../theme';
import {
  acceptNotifyOffer,
  NOTIFY_LINE_COPY,
  resolveNotifyLineState,
  type NotifyLineIo,
  type NotifyLineState,
} from '../../services/pricingNotifyLine';

/**
 * Production wiring. The notification module is required lazily so a screen
 * that merely renders a working card never drags expo-notifications into a
 * test runner (the same trick pushPermissionPrompt uses).
 */
function deviceIo(): NotifyLineIo {
  let service: any = null;
  try {
    ({ notificationService: service } = require('../../services/notificationService'));
  } catch {
    service = null;
  }
  return {
    isWeb: Platform.OS === 'web',
    available: () => !!service?.isAvailable?.(),
    hasPermission: () => service.hasPermission(),
    canAskPermission: () => service.canAskPermission(),
    register: () => service.registerForPushNotifications({ promptIfNeeded: true }),
  };
}

type LineState = 'loading' | NotifyLineState | 'declined';

export function PricingNotifyLine({ io }: { io?: NotifyLineIo }) {
  const colors = useThemeColors();
  const [state, setState] = useState<LineState>('loading');
  const [resolvedIo] = useState<NotifyLineIo>(() => io ?? deviceIo());

  useEffect(() => {
    let alive = true;
    resolveNotifyLineState(resolvedIo)
      .then((next) => {
        if (alive) setState(next);
      })
      .catch(() => {
        if (alive) setState('hidden');
      });
    return () => {
      alive = false;
    };
  }, [resolvedIo]);

  const onAccept = useCallback(async () => {
    setState('loading');
    setState(await acceptNotifyOffer(resolvedIo));
  }, [resolvedIo]);

  if (state === 'loading' || state === 'hidden') return null;
  if (state === 'offer') {
    return (
      <Pressable onPress={onAccept} accessibilityRole="button" hitSlop={8} style={styles.wrap}>
        <Text style={[styles.text, { color: colors.accentText }]}>{NOTIFY_LINE_COPY.offer}</Text>
      </Pressable>
    );
  }
  return (
    <Text style={[styles.wrap, styles.text, { color: colors.textMuted }]}>
      {state === 'ready' ? NOTIFY_LINE_COPY.ready : NOTIFY_LINE_COPY.declined}
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 6,
  },
  text: {
    fontSize: 12,
    fontStyle: 'italic',
  },
});
