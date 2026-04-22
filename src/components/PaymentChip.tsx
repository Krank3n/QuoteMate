/**
 * PaymentChip
 * Payment-state indicator for a unified Document. Splits the "status" UI in
 * two: the existing stage chip (workflow) and this chip (money). Independent
 * axes — a quote can be accepted with zero paid; an invoice can be paid
 * while still technically staged as invoice_sent until the webhook lands.
 *
 * Tap → PaymentSheet (payment history + "record payment" shortcut).
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Document } from '../types/document';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { selectionTap } from '../utils/haptics';

export type PaymentState =
  | 'unpaid'
  | 'deposit_paid'
  | 'partially_paid'
  | 'paid'
  | 'overpaid';

interface PaymentChipProps {
  doc: Document;
  onPress?: (doc: Document) => void;
}

interface PaymentMeta {
  label: string;
  icon: string;
  color: string;
  bgColor: string;
}

// Ordered so "overpaid" feels like an unusual positive (surplus) rather than
// a negative; the refund path still drives stage → cancelled elsewhere.
export function derivePaymentState(doc: Document): PaymentState {
  const total = Number(doc.total) || 0;
  const paid = Number(doc.paidTotal) || 0;
  if (total <= 0 && paid <= 0) return 'unpaid';
  const tolerance = 0.005;
  if (paid + tolerance >= total && total > 0) {
    return paid > total + tolerance ? 'overpaid' : 'paid';
  }
  if (paid > 0) {
    // Pre-invoice deposit behaves differently from mid-invoice partial.
    if (doc.type === 'quote') return 'deposit_paid';
    return 'partially_paid';
  }
  return 'unpaid';
}

function formatProgress(doc: Document): string {
  const total = Number(doc.total) || 0;
  const paid = Number(doc.paidTotal) || 0;
  if (total <= 0) return formatCurrency(paid);
  return `${formatCurrency(paid)} / ${formatCurrency(total)}`;
}

function metaFor(doc: Document, state: PaymentState): PaymentMeta {
  switch (state) {
    case 'unpaid':
      return {
        label: 'Unpaid',
        icon: 'cash-remove',
        color: colors.textMuted,
        bgColor: colors.surfaceGray3,
      };
    case 'deposit_paid':
      return {
        label: `Deposit ${formatCurrency(Number(doc.paidTotal) || 0)}`,
        icon: 'cash-plus',
        color: colors.info,
        bgColor: colors.infoBg,
      };
    case 'partially_paid':
      return {
        label: `Part paid ${formatProgress(doc)}`,
        icon: 'progress-check',
        color: colors.warning,
        bgColor: colors.warningBg,
      };
    case 'paid':
      return {
        label: 'Paid',
        icon: 'cash-check',
        color: colors.success,
        bgColor: colors.successBg,
      };
    case 'overpaid':
      return {
        label: `Overpaid ${formatProgress(doc)}`,
        icon: 'cash-refund',
        color: colors.warning,
        bgColor: colors.warningBg,
      };
  }
}

export function PaymentChip({ doc, onPress }: PaymentChipProps) {
  const state = derivePaymentState(doc);
  const meta = metaFor(doc, state);

  const content = (
    <View style={[styles.chip, { backgroundColor: meta.bgColor, borderColor: meta.color + '44' }]}>
      <MaterialCommunityIcons name={meta.icon as any} size={14} color={meta.color} />
      <Text style={[styles.label, { color: meta.color }]} numberOfLines={1}>
        {meta.label}
      </Text>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={() => {
        selectionTap();
        onPress(doc);
      }}
      hitSlop={8}
      style={({ pressed }) => [pressed ? { opacity: 0.7 } : null]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    gap: 4,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
