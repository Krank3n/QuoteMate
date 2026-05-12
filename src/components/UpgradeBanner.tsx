/**
 * Upgrade Banner
 *
 * Free-tier dashboard upsell. Tap to open Paywall, × to dismiss permanently.
 * Once dismissed the banner never auto-shows again — Pro is still reachable
 * from Settings → Subscription so the dismissal isn't a dead end.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import { colors } from '../theme';

export function UpgradeBanner() {
  const navigation = useNavigation<any>();
  const subscriptionStatus = useStore((s) => s.subscriptionStatus);
  const getEffectivePlan = useStore((s) => s.getEffectivePlan);
  const dismissUpgradeBanner = useStore((s) => s.dismissUpgradeBanner);

  if (getEffectivePlan() !== 'free') return null;
  if (subscriptionStatus?.dismissedUpgradeBanner) return null;

  const handlePress = () => navigation.navigate('Paywall' as never);

  return (
    <Surface style={styles.card} elevation={2}>
      <TouchableOpacity onPress={handlePress} activeOpacity={0.7} style={styles.row}>
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name="crown-outline" size={20} color={colors.primary} />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.title}>Upgrade to Pro</Text>
          <Text style={styles.subtitle}>
            Drop the platform fee from 1.7% to 1% and unlock all payment methods.
          </Text>
        </View>
        <TouchableOpacity
          onPress={dismissUpgradeBanner}
          accessibilityLabel="Dismiss upgrade banner"
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <MaterialCommunityIcons name="close" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    flexDirection: 'column',
    gap: 2,
    marginRight: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.onSurface,
  },
});
