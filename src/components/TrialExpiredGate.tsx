/**
 * Trial-Expired Banner
 *
 * Once the Pro trial elapses, the free tier requires a connected Square
 * account (that's how the platform monetises the free tier — every customer
 * payment goes through Square so we collect a fee).
 *
 * Previously this rendered as a dashboard-blocking Modal, which cut off
 * engagement at the exact moment a tradie was most likely to abandon. We've
 * switched to a non-blocking inline banner: the user can keep building
 * quotes, the live preview and PDFs get watermarked, and the hard gate only
 * fires at Send (see SendDocumentDialog + quoteDeliveryGuard). This is the
 * sunk-cost-fallacy flow — by the time we ask for Square, they've already
 * invested 15-20 minutes building the quote.
 *
 * Renders nothing for Pro users, in-trial users, or anyone already connected
 * to Square. The export is named TrialExpiredBanner; the legacy TrialExpiredGate
 * alias is kept so existing imports don't break.
 */

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import { checkSquareConnection } from '../services/squareService';
import { trackEvent } from '../services/analyticsService';
import { colors } from '../theme';

export function TrialExpiredBanner() {
  const isTrialExpired = useStore((s) => s.isTrialExpired);
  const getEffectivePlan = useStore((s) => s.getEffectivePlan);

  const [squareConnected, setSquareConnected] = useState<boolean | null>(null);

  const expired = isTrialExpired();
  const plan = getEffectivePlan();

  // Re-check Square connection on focus so a user who just connected Square
  // in another flow doesn't get stuck behind a stale banner.
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
    <TrialExpiredBannerCard />
  );
}

/**
 * Inner card that owns the impression event. Split out from the host so the
 * effect only runs on the render that the banner is actually visible —
 * mounting the impression directly on the outer component would also fire on
 * the renders that return null before this point.
 */
function TrialExpiredBannerCard() {
  const navigation = useNavigation<any>();
  React.useEffect(() => {
    trackEvent('trial_expired_banner_shown');
  }, []);

  return (
    <Surface style={styles.card} elevation={2}>
      <View style={styles.header}>
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name="lock-clock" size={20} color={colors.error} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Trial expired</Text>
          <Text style={styles.subtitle}>
            Connect Square to keep sending quotes for free, or upgrade to Pro.
          </Text>
        </View>
      </View>
      <View style={styles.buttonRow}>
        <Button
          mode="contained"
          compact
          onPress={() => navigation.navigate('SquareIntegration' as never)}
          style={styles.primaryButton}
          icon="bank-outline"
        >
          Connect Square
        </Button>
        <TouchableOpacity onPress={() => navigation.navigate('Paywall' as never)}>
          <Text style={styles.upgradeLink}>Upgrade →</Text>
        </TouchableOpacity>
      </View>
    </Surface>
  );
}

// Back-compat: the previous name. New code should use TrialExpiredBanner.
export const TrialExpiredGate = TrialExpiredBanner;

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: colors.error + '20',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.onSurface,
    marginTop: 2,
    lineHeight: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  primaryButton: {
    flex: 1,
  },
  upgradeLink: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
});
