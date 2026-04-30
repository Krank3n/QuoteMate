/**
 * Trial-Expired Gate
 *
 * Once the 7-day Pro trial elapses, the free tier requires a connected Square
 * account (that's how the platform monetises the free tier — every customer
 * payment goes through Square so we collect a fee). When trial has elapsed
 * AND Square is not connected, this modal blocks dashboard interaction with
 * two CTAs: Connect Square (free tier) or Upgrade to Pro.
 *
 * If the user is Pro, in-trial, or already has Square connected, the gate
 * renders nothing.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Modal } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import { checkSquareConnection } from '../services/squareService';
import { colors } from '../theme';

export function TrialExpiredGate() {
  const navigation = useNavigation<any>();
  const isTrialExpired = useStore((s) => s.isTrialExpired);
  const getEffectivePlan = useStore((s) => s.getEffectivePlan);

  const [squareConnected, setSquareConnected] = useState<boolean | null>(null);

  const expired = isTrialExpired();
  const plan = getEffectivePlan();

  // Re-check Square connection whenever the screen comes into focus so a
  // user who just connected Square in another flow doesn't get stuck behind
  // a stale "Connect Square" modal.
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      if (expired && plan !== 'pro') {
        checkSquareConnection()
          .then((c) => {
            if (!cancelled) setSquareConnected(!!c.connected);
          })
          .catch(() => {
            if (!cancelled) setSquareConnected(false);
          });
      }
      return () => {
        cancelled = true;
      };
    }, [expired, plan])
  );

  if (!expired || plan === 'pro') return null;
  if (squareConnected === null || squareConnected === true) return null;

  return (
    <Modal transparent visible animationType="fade">
      <View style={styles.backdrop}>
        <Surface style={styles.card} elevation={4}>
          <MaterialCommunityIcons
            name="lock-outline"
            size={36}
            color={colors.primary}
            style={styles.icon}
          />
          <Text style={styles.title}>Pick how you want to keep going</Text>
          <Text style={styles.subtitle}>
            Your 7-day trial's done. To keep sending quotes, connect a Square
            account so customers can pay you online — or upgrade to Pro for the
            lower fee and all payment methods.
          </Text>

          <Button
            mode="contained"
            onPress={() => navigation.navigate('SquareIntegration' as never)}
            style={styles.primaryButton}
            contentStyle={styles.buttonContent}
            icon="bank-outline"
          >
            Connect Square (free)
          </Button>
          <Button
            mode="outlined"
            onPress={() => navigation.navigate('Paywall' as never)}
            style={styles.secondaryButton}
            contentStyle={styles.buttonContent}
            icon="crown-outline"
          >
            Upgrade to Pro
          </Button>
        </Surface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  icon: {
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  primaryButton: {
    width: '100%',
    marginBottom: 10,
  },
  secondaryButton: {
    width: '100%',
  },
  buttonContent: {
    paddingVertical: 4,
  },
});
