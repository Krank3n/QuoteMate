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
import { View, StyleSheet, Pressable, type GestureResponderEvent } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Document } from '../types/document';
import type { Tokens } from '../theme';
import { makeStyles, useThemeColors } from '../theme';
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
  /**
   * The event is forwarded so a chip sitting inside a pressable row (the
   * Jobs list card) can stop the tap bubbling up and opening the row
   * instead. Handlers that don't care may ignore it.
   */
  onPress?: (doc: Document, event?: GestureResponderEvent) => void;
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

function metaFor(doc: Document, state: PaymentState, themeColors: Tokens): PaymentMeta {
  switch (state) {
    case 'unpaid':
      return {
        label: 'Unpaid',
        icon: 'cash-remove',
        color: themeColors.textMuted,
        bgColor: themeColors.surfacePressed,
      };
    case 'deposit_paid':
      return {
        label: `Deposit ${formatCurrency(Number(doc.paidTotal) || 0)}`,
        icon: 'cash-plus',
        color: themeColors.info,
        bgColor: themeColors.infoSubtle,
      };
    case 'partially_paid':
      return {
        label: `Part paid ${formatProgress(doc)}`,
        icon: 'progress-check',
        color: themeColors.warning,
        bgColor: themeColors.warningSubtle,
      };
    case 'paid':
      return {
        label: 'Paid',
        icon: 'cash-check',
        color: themeColors.money,
        bgColor: themeColors.moneySubtle,
      };
    case 'overpaid':
      return {
        label: `Overpaid ${formatProgress(doc)}`,
        icon: 'cash-refund',
        color: themeColors.warning,
        bgColor: themeColors.warningSubtle,
      };
  }
}

export function PaymentChip({ doc, onPress }: PaymentChipProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const state = derivePaymentState(doc);
  const meta = metaFor(doc, state, themeColors);

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
      onPress={(e) => {
        selectionTap();
        onPress(doc, e);
      }}
      hitSlop={8}
      style={({ pressed }) => [pressed ? { opacity: 0.7 } : null]}
    >
      {content}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
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
}));
