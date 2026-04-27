/**
 * Banners surfacing Square reconciliation failures and open disputes on a
 * quote/invoice. These live side-by-side with SquareReconnectBanner and are
 * deliberately separate so copy + severity can diverge — a reconcile failure
 * needs the tradie to investigate right now; a dispute needs them to act
 * before a Square-enforced deadline.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors } from '../theme';
import type { PaymentSyncError, SquareDisputeStatus } from '../types';

interface SyncProps {
  error?: PaymentSyncError | null;
}

export function PaymentSyncErrorBanner({ error }: SyncProps) {
  if (!error) return null;
  return (
    <View style={[styles.banner, styles.errorBanner]}>
      <MaterialCommunityIcons name="alert-octagon" size={20} color={colors.error} style={styles.icon} />
      <View style={styles.textWrap}>
        <Text style={[styles.title, { color: colors.error }]}>Payment didn't reconcile</Text>
        <Text style={styles.body}>
          A card payment was received but we couldn't record it automatically.
          Check the Square dashboard and mark this paid manually if needed.
        </Text>
        {error.message ? (
          <Text style={styles.subtle}>{error.message}</Text>
        ) : null}
      </View>
    </View>
  );
}

interface DisputeProps {
  status?: SquareDisputeStatus | string | null;
  disputeId?: string | null;
}

const ACTION_REQUIRED: ReadonlySet<string> = new Set([
  'INQUIRY_EVIDENCE_REQUIRED',
  'EVIDENCE_REQUIRED',
]);

const RESOLVED: ReadonlySet<string> = new Set(['WON', 'INQUIRY_CLOSED']);

export function DisputeBanner({ status, disputeId }: DisputeProps) {
  if (!status) return null;
  const needsAction = ACTION_REQUIRED.has(status);
  const resolved = RESOLVED.has(status);
  const lost = status === 'LOST' || status === 'ACCEPTED';

  const tone = resolved
    ? { bg: colors.successBg, border: colors.success, title: 'Dispute resolved', icon: 'check-circle' as const }
    : lost
      ? { bg: colors.errorBg, border: colors.error, title: 'Dispute lost', icon: 'close-octagon' as const }
      : needsAction
        ? { bg: colors.errorBg, border: colors.error, title: 'Dispute needs evidence', icon: 'alert' as const }
        : { bg: colors.warningBg, border: colors.warning, title: 'Dispute open', icon: 'shield-alert' as const };

  return (
    <View style={[styles.banner, { backgroundColor: tone.bg, borderLeftColor: tone.border }]}>
      <MaterialCommunityIcons name={tone.icon} size={20} color={tone.border} style={styles.icon} />
      <View style={styles.textWrap}>
        <Text style={[styles.title, { color: tone.border }]}>{tone.title}</Text>
        <Text style={styles.body}>
          {needsAction
            ? 'Square is asking for evidence. Respond in the Square dashboard before the deadline or you\u2019ll lose by default.'
            : lost
              ? 'The chargeback was finalised against you. Funds have been returned to the customer.'
              : resolved
                ? 'No further action needed.'
                : `Current state: ${String(status).replace(/_/g, ' ').toLowerCase()}.`}
        </Text>
        {disputeId ? <Text style={styles.subtle}>Dispute ID: {disputeId}</Text> : null}
      </View>
    </View>
  );
}

interface InvoicedProps {
  invoicedAt?: Date | string | number | null;
  onPress?: () => void;
}

export function InvoicedBanner({ invoicedAt, onPress }: InvoicedProps) {
  const dateLabel = formatInvoicedDate(invoicedAt);
  const Wrapper: any = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      style={[styles.banner, { backgroundColor: colors.successBg, borderLeftColor: colors.success }]}
    >
      <MaterialCommunityIcons name="receipt" size={20} color={colors.success} style={styles.icon} />
      <View style={styles.textWrap}>
        <Text style={[styles.title, { color: colors.success }]}>
          {dateLabel ? `Invoiced ${dateLabel}` : 'Invoiced'}
        </Text>
        {onPress ? (
          <Text style={styles.body}>Tap to view the invoice.</Text>
        ) : null}
      </View>
      {onPress ? (
        <MaterialCommunityIcons
          name="chevron-right"
          size={22}
          color={colors.success}
          style={{ alignSelf: 'center' }}
        />
      ) : null}
    </Wrapper>
  );
}

function formatInvoicedDate(value: InvoicedProps['invoicedAt']): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value as any);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderLeftWidth: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 10,
  },
  errorBanner: {
    backgroundColor: colors.errorBg,
    borderLeftColor: colors.error,
  },
  icon: {
    marginRight: 10,
    marginTop: 2,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  body: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 16,
  },
  subtle: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
});
