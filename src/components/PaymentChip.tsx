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
  /** Drop the figures from the label — for rows that share space. */
  compact?: boolean;
  /** What the Job knows and the document can't — see PaymentContext. */
  context?: PaymentContext;
}

interface PaymentMeta {
  label: string;
  icon: string;
  color: string;
  bgColor: string;
}

/**
 * What the JOB knows that the document can't.
 *
 * A cash job never gets invoiced and never touches the payment ledger, so
 * the tradie marking the job Paid is the only record that exists. The
 * document alone would call that "unpaid" — and now that the timeline rail
 * is workflow-only (see jobTimeline.JobSubStatusSlot), the chip is the last
 * place on the card that could say otherwise.
 */
export interface PaymentContext {
  /** The Job's own stage reads `paid`. */
  jobIsPaid?: boolean;
}

/** The Job's word only counts where the document has no money of its own —
 *  an invoice's ledger is the record, and a real balance outranks a stage. */
function jobStandsInForLedger(doc: Document, ctx: PaymentContext): boolean {
  return !!ctx.jobIsPaid && doc.type !== 'invoice' && (Number(doc.paidTotal) || 0) <= 0;
}

// Ordered so "overpaid" feels like an unusual positive (surplus) rather than
// a negative; the refund path still drives stage → cancelled elsewhere.
export function derivePaymentState(doc: Document, ctx: PaymentContext = {}): PaymentState {
  const total = Number(doc.total) || 0;
  const paid = Number(doc.paidTotal) || 0;
  if (jobStandsInForLedger(doc, ctx)) return 'paid';
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

/**
 * Whether a doc has a money story worth putting a chip on.
 *
 * Every surface asks this same question, so it lives next to
 * derivePaymentState rather than in any one caller. The Jobs list and the
 * job screen used to disagree: the list gated on this, the job screen
 * chipped everything, so one quote could show "Unpaid" on its detail
 * screen and nothing on its card.
 *
 * A quote nobody has been asked to pay isn't "unpaid" — it's just a
 * quote. But a quote with an outstanding deposit IS owed money, and its
 * chip is the way into TakePaymentSheet when StickyJobActionBar isn't
 * offering "Take Deposit" (it only does so when a deposit amount is
 * configured, and never on iOS while Square is gated there). Dropping
 * that case would strand the pay-link route on those quotes — mirrors
 * depositOwed in StickyJobActionBar.
 */
export function shouldShowPaymentChip(
  doc?: Document | null,
  ctx: PaymentContext = {},
): boolean {
  if (!doc) return false;
  if (doc.stage === 'cancelled') return false;
  if (doc.type === 'invoice') return true;
  if ((Number(doc.paidTotal) || 0) > 0) return true;
  const depositRequired = Number(doc.depositAmount) || 0;
  const depositPaid = Number(doc.depositPaid) || 0;
  if (depositRequired > 0 && depositPaid < depositRequired) return true;
  // Cash job marked paid on the Job itself — see PaymentContext.
  return jobStandsInForLedger(doc, ctx);
}

function formatProgress(doc: Document): string {
  const total = Number(doc.total) || 0;
  const paid = Number(doc.paidTotal) || 0;
  if (total <= 0) return formatCurrency(paid);
  return `${formatCurrency(paid)} / ${formatCurrency(total)}`;
}

/**
 * `compact` drops the money from the label.
 *
 * On a list card the chip shares one row with the status line, and
 * "Part paid $1,303.13 / $2,606.26" is wide enough to squeeze that line down
 * to "Started 2 mi…". The state is what a tradie scans a list for; the
 * figures are on the card already and in the job. Detail views pass no flag
 * and keep the full label.
 */
function metaFor(
  doc: Document,
  state: PaymentState,
  themeColors: Tokens,
  compact = false,
): PaymentMeta {
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
        label: compact
          ? 'Deposit paid'
          : `Deposit ${formatCurrency(Number(doc.paidTotal) || 0)}`,
        icon: 'cash-plus',
        color: themeColors.info,
        bgColor: themeColors.infoSubtle,
      };
    case 'partially_paid':
      return {
        label: compact ? 'Part paid' : `Part paid ${formatProgress(doc)}`,
        icon: 'progress-check',
        color: themeColors.warning,
        bgColor: themeColors.warningSubtle,
      };
    case 'paid':
      return {
        // Non-compact rows sit beside a stage chip that already says "Paid",
        // so carry the figure there rather than echoing the word twice.
        label: compact ? 'Paid' : `Paid ${formatCurrency(Number(doc.paidTotal) || 0)}`,
        icon: 'cash-check',
        color: themeColors.money,
        bgColor: themeColors.moneySubtle,
      };
    case 'overpaid':
      return {
        label: compact ? 'Overpaid' : `Overpaid ${formatProgress(doc)}`,
        icon: 'cash-refund',
        color: themeColors.warning,
        bgColor: themeColors.warningSubtle,
      };
  }
}

export function PaymentChip({ doc, onPress, compact, context }: PaymentChipProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const state = derivePaymentState(doc, context);
  const meta = metaFor(doc, state, themeColors, compact);

  /**
   * A chip you can act on has to look like one.
   *
   * The fastest way to record a payment in the app is this chip — two taps
   * from the jobs list to a pre-filled Record Payment. It rendered as muted
   * grey text on a pressed-surface pill, sitting in a row of chips that are
   * genuinely inert, so nobody found it: a tradie chasing this exact job went
   * looking for the feature and concluded it wasn't there. The state word
   * stays (it's true and it's what the row is scanned for); the colour and the
   * chevron say it's a door.
   *
   * Only where money is actually owed. On a settled invoice the chip is a
   * receipt, not an invitation.
   */
  const owed = state === 'unpaid' || state === 'partially_paid';
  const actionable = !!onPress && owed;
  const fg = actionable ? themeColors.accentText : meta.color;
  const bg = actionable ? themeColors.accentSubtle : meta.bgColor;

  const content = (
    <View style={[styles.chip, { backgroundColor: bg, borderColor: fg + '44' }]}>
      <MaterialCommunityIcons name={meta.icon as any} size={14} color={fg} />
      <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
        {meta.label}
      </Text>
      {actionable ? (
        <MaterialCommunityIcons name={'chevron-right' as any} size={14} color={fg} />
      ) : null}
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
