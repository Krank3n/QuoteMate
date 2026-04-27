/**
 * DocumentSentBanner
 *
 * Shown at the top of the Job Preview when the attached Document has been
 * sent (quote_sent / invoice_sent / partially_paid / paid). Tells the
 * tradie the customer already has a copy, and any edits won't reach them
 * until they press Resend. The customer's existing Pay Now link stays
 * live (re-mint kicks in if they open it after edits), so this is UX,
 * not a correctness guard.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Document } from '../types/document';
import { colors } from '../theme';

interface DocumentSentBannerProps {
  doc: Document | null | undefined;
}

function hasBeenSent(doc: Document): boolean {
  return (
    doc.stage === 'quote_sent' ||
    doc.stage === 'invoice_sent' ||
    doc.stage === 'partially_paid' ||
    doc.stage === 'paid'
  );
}

function describeSent(doc: Document): string {
  // "Sent as Quote" / "Sent as Invoice" per the plan — accurate to the
  // current state rather than the latest transition. An invoice that was
  // previously a quote reads as Invoice now.
  return doc.type === 'invoice' ? 'Sent as Invoice' : 'Sent as Quote';
}

export function DocumentSentBanner({ doc }: DocumentSentBannerProps) {
  if (!doc || !hasBeenSent(doc)) return null;

  // invoicedAt is the most reliable "sent" timestamp post-conversion; fall
  // back to respondedAt / updatedAt.
  const sentMs =
    (doc.type === 'invoice' && doc.invoicedAt) ||
    doc.respondedAt ||
    doc.updatedAt;
  const sentDate = sentMs ? new Date(Number(sentMs)) : new Date();
  const dateLabel = sentDate.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });
  const customerLabel = doc.customerName?.trim() || 'your customer';

  return (
    <Surface style={styles.banner} elevation={2}>
      <MaterialCommunityIcons
        name="email-check-outline"
        size={22}
        color={colors.info}
        style={styles.icon}
      />
      <View style={styles.body}>
        <Text style={styles.title}>
          {describeSent(doc)} · {customerLabel} · {dateLabel}
        </Text>
        <Text style={styles.subtitle}>
          Changes won't reach them until you tap Resend.
        </Text>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: colors.infoBg ?? '#E0F2FE',
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
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
    color: colors.text,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
