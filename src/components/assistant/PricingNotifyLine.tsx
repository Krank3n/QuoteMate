/**
 * The line under Mate's working card while a quote prices on the server:
 * "Lock your phone if you like…", or a "Tell me when it's done" button. See
 * services/pricingNotifyLine for the decision logic and why the tap goes
 * straight to the OS prompt.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useThemeColors } from '../../theme';
import {
  acceptNotifyOffer,
  NOTIFY_LINE_COPY,
  plainLineCopy,
  resolveNotifyLineState,
  type NotifyLineIo,
  type NotifyLineState,
} from '../../services/pricingNotifyLine';
import { pushDeviceIo } from '../../services/pushPermissionPrompt';

/** Production wiring, on the same device surface the send-time prompt uses. */
function deviceIo(): NotifyLineIo {
  const device = pushDeviceIo();
  return {
    isWeb: Platform.OS === 'web',
    available: () => !!device,
    hasPermission: () => (device ? device.hasPermission() : Promise.resolve(false)),
    canAskPermission: () => (device ? device.canAskPermission() : Promise.resolve(false)),
    register: () => (device ? device.register() : Promise.resolve(null)),
  };
}

type LineState = 'loading' | NotifyLineState | 'asking' | 'declined';

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
        if (alive) setState('plain');
      });
    return () => {
      alive = false;
    };
  }, [resolvedIo]);

  const onAccept = useCallback(async () => {
    // Keep the row while the OS dialog is up so the card doesn't reflow
    // underneath it.
    setState('asking');
    setState(await acceptNotifyOffer(resolvedIo));
  }, [resolvedIo]);

  if (state === 'loading') return null;
  if (state === 'offer' || state === 'asking') {
    const asking = state === 'asking';
    return (
      <Pressable
        onPress={asking ? undefined : onAccept}
        disabled={asking}
        accessibilityRole="button"
        accessibilityHint="Turns on notifications so Mate can tell you when the quote is priced"
        testID="pricing-notify-offer"
        style={[styles.button, { borderColor: colors.accentText, opacity: asking ? 0.6 : 1 }]}
      >
        <Text style={[styles.buttonText, { color: colors.accentText }]}>
          {asking ? NOTIFY_LINE_COPY.asking : NOTIFY_LINE_COPY.offer}
        </Text>
      </Pressable>
    );
  }
  const copy =
    state === 'ready'
      ? NOTIFY_LINE_COPY.ready
      : state === 'declined'
        ? NOTIFY_LINE_COPY.declined
        : plainLineCopy(resolvedIo.isWeb);
  return <Text style={[styles.note, { color: colors.textMuted }]}>{copy}</Text>;
}

const styles = StyleSheet.create({
  note: {
    marginTop: 6,
    fontSize: 12,
    fontStyle: 'italic',
  },
  button: {
    marginTop: 8,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
