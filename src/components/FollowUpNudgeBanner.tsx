/**
 * FollowUpNudgeBanner — the dashboard's "what should I chase today?" card.
 *
 * Renders the single nudge picked by pickFollowUpNudge. Visually mirrors
 * the draft banner (Surface + accent border + icon circle + chevron) so
 * the home screen keeps one card language. Dismissing (X) snoozes the
 * item — handled by the caller.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Tokens } from '../theme';
import { makeStyles, useThemeColors } from '../theme';
import { lightTap } from '../utils/haptics';
import { trackEvent } from '../services/analyticsService';
import type { FollowUpNudge, NudgeType } from '../utils/followUpNudge';

interface NudgeMeta {
  icon: string;
  accent: string;
  accentBg: string;
  subtitle: (n: FollowUpNudge) => string;
}

const nudgeMetaFor = (themeColors: Tokens): Record<NudgeType, NudgeMeta> => ({
  invoice_overdue: {
    icon: 'alert-circle-outline',
    accent: themeColors.error,
    accentBg: themeColors.errorSubtle,
    subtitle: (n) =>
      n.days === 0
        ? 'Invoice due today — worth a nudge'
        : `Invoice ${n.days} day${n.days === 1 ? '' : 's'} overdue — chase it up`,
  },
  self_sent_quote: {
    icon: 'email-arrow-right-outline',
    accent: themeColors.info,
    accentBg: themeColors.infoSubtle,
    subtitle: () => 'Only sent to your inbox — send it to your customer',
  },
  unsent_quote: {
    icon: 'send-outline',
    accent: themeColors.accent,
    accentBg: themeColors.accentSubtle,
    subtitle: (n) =>
      n.testSent
        ? 'Happy with how it looks? Send it to your customer'
        : "Quote's ready to go — send it to your customer",
  },
  quote_follow_up: {
    icon: 'bell-outline',
    accent: themeColors.warning,
    accentBg: themeColors.warningSubtle,
    subtitle: (n) => `Sent ${n.days} day${n.days === 1 ? '' : 's'} ago, no reply — worth a follow-up`,
  },
});

interface FollowUpNudgeBannerProps {
  nudge: FollowUpNudge;
  onPress: (nudge: FollowUpNudge) => void;
  onDismiss: (nudge: FollowUpNudge) => void;
}

export function FollowUpNudgeBanner({ nudge, onPress, onDismiss }: FollowUpNudgeBannerProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const NUDGE_META = nudgeMetaFor(themeColors);
  const meta = NUDGE_META[nudge.type];

  // One impression event per surfaced item — key changes only when the
  // nudge itself does, so re-renders don't spam analytics.
  useEffect(() => {
    trackEvent('nudge_shown', { nudge_type: nudge.type });
  }, [nudge.key]);

  const title =
    [nudge.jobName, nudge.customerName].filter(Boolean).join(' — ') ||
    (nudge.type === 'invoice_overdue' ? 'Invoice' : 'Quote');

  return (
    <View>
      <TouchableOpacity
        onPress={() => {
          lightTap();
          trackEvent('nudge_tapped', { nudge_type: nudge.type });
          onPress(nudge);
        }}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${meta.subtitle(nudge)}`}
      >
        <Surface style={[styles.banner, { borderLeftColor: meta.accent }]}>
          <View style={styles.content}>
            <View style={[styles.iconCircle, { backgroundColor: meta.accentBg }]}>
              <MaterialCommunityIcons name={meta.icon as any} size={20} color={meta.accent} />
            </View>
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.subtitle} numberOfLines={2}>
                {meta.subtitle(nudge)}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={meta.accent} />
          </View>
        </Surface>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.dismissButton}
        onPress={() => {
          lightTap();
          trackEvent('nudge_dismissed', { nudge_type: nudge.type });
          onDismiss(nudge);
        }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss reminder for a few days"
      >
        <MaterialCommunityIcons name="close-circle" size={22} color={themeColors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  banner: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 18,
    borderRadius: 12,
    backgroundColor: t.colors.surfaceRaised,
    elevation: 2,
    borderLeftWidth: 3,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: t.colors.textSecondary,
    marginTop: 2,
  },
  dismissButton: {
    position: 'absolute',
    top: -6,
    right: 14,
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 11,
    zIndex: 10,
    elevation: 10,
  },
}));
