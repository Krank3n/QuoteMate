/**
 * Quote Sent Banner
 *
 * Shown at the top of quote edit screens when quote.status === 'sent' so the
 * tradie knows the customer has a copy of this quote and any edits won't
 * reach them until they press Resend. The customer's existing Pay Now link
 * remains live (re-mint kicks in if they open it after edits), so this is
 * UX — not a correctness guard.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { Quote } from '../types';
import { makeStyles, useThemeColors } from '../theme';

interface QuoteSentBannerProps {
  quote: Quote | null | undefined;
}

export function QuoteSentBanner({ quote }: QuoteSentBannerProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  if (!quote || quote.status !== 'sent') return null;

  const sentDate = quote.respondedAt
    ? new Date(quote.respondedAt)
    : new Date(quote.updatedAt);
  const dateLabel = sentDate.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });
  const customerLabel = quote.customerName?.trim() || 'your customer';

  return (
    <Surface style={styles.banner} elevation={2}>
      <MaterialCommunityIcons
        name="email-check-outline"
        size={22}
        color={themeColors.info}
        style={styles.icon}
      />
      <View style={styles.body}>
        <Text style={styles.title}>Sent to {customerLabel} on {dateLabel}</Text>
        <Text style={styles.subtitle}>
          Changes won't reach them until you tap Resend.
        </Text>
      </View>
    </Surface>
  );
}

const useStyles = makeStyles((t) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: t.colors.infoSubtle ?? '#E0F2FE',
    borderLeftWidth: 3,
    borderLeftColor: t.colors.info,
  },
  icon: {
    marginRight: 10,
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    color: t.colors.textMuted,
    lineHeight: 18,
  },
}));
