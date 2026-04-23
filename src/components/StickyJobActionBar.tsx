/**
 * StickyJobActionBar — pinned to the bottom of ViewJobScreen.
 *
 * One source of truth for "what should the contractor tap next on this job?"
 * The primary CTA morphs with the Job's stage (and the primary attached
 * Document's state), so every phase surfaces the right next action without
 * the tradie hunting for it:
 *
 *   no quote yet       → Create Quote
 *   draft quote        → Continue Quote
 *   quote sent         → Take Deposit (primary) + Mark Approved (secondary)
 *   accepted (deposit  → Take Deposit + Schedule
 *     still owed)
 *   accepted (deposit  → Schedule
 *     settled)
 *   scheduled          → Start Job + Edit date
 *   in_progress / no   → Generate Invoice + Mark Complete
 *     invoice yet
 *   invoice unpaid     → Take Final Payment + Send Invoice
 *   paid               → Close Job
 *   terminal (cancelled/
 *     closed)          → (hidden)
 *
 * "Take Deposit" / "Take Final Payment" both open TakePaymentSheet — the
 * same sheet that already handles Square Tap-to-Pay + Square pay-link
 * share. Zero new payment plumbing; just new entry points.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Job, JobStage } from '../../shared/job/types';
import type { Document } from '../types/document';
import { colors } from '../theme';
import { selectionTap, lightTap } from '../utils/haptics';

export type JobActionId =
  | 'createQuote'
  | 'continueQuote'
  | 'editQuote'
  | 'sendQuote'
  | 'resendQuote'
  | 'markApproved'
  | 'takeDeposit'
  | 'tapToPayDraft'
  | 'followUpQuote'
  | 'schedule'
  | 'startJob'
  | 'generateInvoice'
  | 'markComplete'
  | 'takeFinalPayment'
  | 'sendInvoice'
  | 'resendInvoice'
  | 'followUpInvoice'
  | 'recordPayment'
  | 'closeJob';

type ActionTone = 'primary' | 'ghost' | 'warning' | 'urgent';

interface ActionSpec {
  id: JobActionId;
  label: string;
  icon: string;
  tone: ActionTone;
}

/**
 * Age of the last send event in days. Feeds the Follow Up tone.
 * 0–1 → fresh (no follow-up shown), 2–3 → gentle, 4–6 → firm,
 * 7+ → overdue.
 */
export type FollowUpTone = 'gentle' | 'firm' | 'overdue';

function daysSince(ms?: number): number | null {
  if (!ms) return null;
  const diff = Date.now() - ms;
  if (diff < 0) return 0;
  return diff / (1000 * 60 * 60 * 24);
}

function quoteFollowUp(sentAt?: number): FollowUpTone | null {
  const d = daysSince(sentAt);
  if (d == null || d < 2) return null;
  if (d < 4) return 'gentle';
  if (d < 7) return 'firm';
  return 'overdue';
}

function invoiceFollowUp(sentAt?: number, dueAt?: number): FollowUpTone | null {
  // Invoices follow up against due-date rather than send-date once a due
  // date is known — that matches how tradies actually think about it.
  const baseline = dueAt ?? sentAt;
  const d = daysSince(baseline);
  if (d == null) return null;
  if (dueAt) {
    // Past due: firmness escalates by days *over* due.
    if (d < 0) return null;
    if (d < 3) return 'gentle';
    if (d < 7) return 'firm';
    return 'overdue';
  }
  // Fallback: age since send, same thresholds as quotes.
  if (d < 3) return null;
  if (d < 7) return 'gentle';
  if (d < 14) return 'firm';
  return 'overdue';
}

function toneForFollowUp(t: FollowUpTone): ActionTone {
  if (t === 'overdue') return 'urgent';
  if (t === 'firm') return 'warning';
  return 'ghost';
}

function followUpLabel(t: FollowUpTone, sentAt?: number): string {
  const d = daysSince(sentAt);
  if (t === 'overdue' && d != null) return `Nudge · ${Math.round(d)}d`;
  return 'Follow Up';
}

interface StickyJobActionBarProps {
  job: Job;
  primaryDoc: Document | null;
  onAction: (id: JobActionId) => void;
  pending?: JobActionId | null;
}

/** Pick the primary actionable doc: any invoice beats the latest quote. */
export function pickPrimaryDoc(docs: Document[]): Document | null {
  if (docs.length === 0) return null;
  const invoices = docs.filter((d) => d.type === 'invoice');
  if (invoices.length > 0) {
    return [...invoices].sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    )[0];
  }
  return [...docs].sort(
    (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  )[0];
}

function depositOwed(doc: Document | null): boolean {
  if (!doc || doc.type !== 'quote') return false;
  const required = Number(doc.depositAmount ?? 0);
  const paid = Number(doc.depositPaid ?? 0);
  return required > 0 && paid < required;
}

function invoiceBalanceOwed(doc: Document | null): boolean {
  if (!doc || doc.type !== 'invoice') return false;
  const total = Number(doc.total ?? 0);
  const paid = Number(doc.paidTotal ?? 0);
  return total > 0 && paid < total;
}

/**
 * Resolve which actions to show for a given (jobStage, primaryDoc) combo.
 * Returns up to two actions — primary first, secondary second. The
 * sticky bar itself caps at two buttons.
 */
export function resolveJobActions(
  stage: JobStage,
  primaryDoc: Document | null,
): ActionSpec[] {
  if (stage === 'cancelled' || stage === 'closed') return [];

  // No doc attached yet — kick the tradie straight into the quote wizard.
  if (!primaryDoc) {
    return [
      { id: 'createQuote', label: 'Create Quote', icon: 'file-document-plus-outline', tone: 'primary' },
    ];
  }

  const isInvoice = primaryDoc.type === 'invoice';
  const isDraft = primaryDoc.stage === 'draft';
  const isQuoteSent = primaryDoc.stage === 'quote_sent';
  const isQuoteAccepted = primaryDoc.stage === 'quote_accepted';
  const isInvoiceUnpaid =
    isInvoice &&
    (primaryDoc.stage === 'invoice_sent' || primaryDoc.stage === 'partially_paid');
  const isInvoicePaid = isInvoice && primaryDoc.stage === 'paid';
  const isPartiallyPaid = isInvoice && primaryDoc.stage === 'partially_paid';

  // Invoice in play → money-collection is the priority.
  if (isInvoicePaid) {
    return [
      { id: 'closeJob', label: 'Close Job', icon: 'archive-arrow-down-outline', tone: 'primary' },
    ];
  }
  if (isInvoiceUnpaid || (isInvoice && invoiceBalanceOwed(primaryDoc))) {
    const followUp = invoiceFollowUp(primaryDoc.sentAt, primaryDoc.dueDate);
    const primary: ActionSpec = isPartiallyPaid
      ? { id: 'takeFinalPayment', label: 'Take Remaining', icon: 'credit-card-outline', tone: 'primary' }
      : { id: 'takeFinalPayment', label: 'Take Payment', icon: 'credit-card-outline', tone: 'primary' };
    if (followUp) {
      return [
        primary,
        {
          id: 'followUpInvoice',
          label: followUpLabel(followUp, primaryDoc.sentAt),
          icon: followUp === 'overdue' ? 'alert-circle-outline' : 'bell-outline',
          tone: toneForFollowUp(followUp),
        },
      ];
    }
    return [
      primary,
      isPartiallyPaid
        ? { id: 'recordPayment', label: 'Log Payment', icon: 'cash-multiple', tone: 'ghost' }
        : { id: 'resendInvoice', label: 'Resend', icon: 'email-send-outline', tone: 'ghost' },
    ];
  }
  if (isInvoice && isDraft) {
    return [
      { id: 'sendInvoice', label: 'Send Invoice', icon: 'email-send-outline', tone: 'primary' },
      { id: 'editQuote', label: 'Edit', icon: 'pencil-outline', tone: 'ghost' },
    ];
  }

  // Quote is the primary doc.
  if (isDraft) {
    return [
      { id: 'sendQuote', label: 'Send Quote', icon: 'send-outline', tone: 'primary' },
      { id: 'tapToPayDraft', label: 'Tap to Pay', icon: 'credit-card-outline', tone: 'ghost' },
    ];
  }
  if (isQuoteSent) {
    const followUp = quoteFollowUp(primaryDoc.sentAt);
    // Fresh (< 2 days) — no follow-up yet; lead with the approval path.
    if (!followUp) {
      if (depositOwed(primaryDoc)) {
        return [
          { id: 'takeDeposit', label: 'Take Deposit', icon: 'credit-card-outline', tone: 'primary' },
          { id: 'markApproved', label: 'Mark Approved', icon: 'check-circle-outline', tone: 'ghost' },
        ];
      }
      return [
        { id: 'markApproved', label: 'Mark Approved', icon: 'check-circle-outline', tone: 'primary' },
        { id: 'resendQuote', label: 'Resend', icon: 'email-send-outline', tone: 'ghost' },
      ];
    }
    // Aging — promote the follow-up, demote the approval path.
    return [
      {
        id: 'followUpQuote',
        label: followUpLabel(followUp, primaryDoc.sentAt),
        icon: followUp === 'overdue' ? 'alert-circle-outline' : 'bell-outline',
        tone: toneForFollowUp(followUp),
      },
      depositOwed(primaryDoc)
        ? { id: 'takeDeposit', label: 'Take Deposit', icon: 'credit-card-outline', tone: 'ghost' }
        : { id: 'markApproved', label: 'Mark Approved', icon: 'check-circle-outline', tone: 'ghost' },
    ];
  }
  if (isQuoteAccepted) {
    const actions: ActionSpec[] = [];
    if (stage === 'scheduled') {
      actions.push({ id: 'startJob', label: 'Start Job', icon: 'hammer-wrench', tone: 'primary' });
      actions.push({ id: 'schedule', label: 'Edit Date', icon: 'calendar-edit', tone: 'ghost' });
      return actions;
    }
    if (stage === 'in_progress') {
      actions.push({ id: 'generateInvoice', label: 'Generate Invoice', icon: 'receipt', tone: 'primary' });
      actions.push({ id: 'markComplete', label: 'Mark Complete', icon: 'flag-checkered', tone: 'ghost' });
      return actions;
    }
    if (stage === 'completed') {
      actions.push({ id: 'generateInvoice', label: 'Generate Invoice', icon: 'receipt', tone: 'primary' });
      if (depositOwed(primaryDoc)) {
        actions.push({ id: 'takeDeposit', label: 'Take Deposit', icon: 'credit-card-outline', tone: 'ghost' });
      }
      return actions;
    }
    // stage === 'accepted' (or any unexpected value): schedule is the priority.
    actions.push({ id: 'schedule', label: 'Pick a Date', icon: 'calendar-plus', tone: 'primary' });
    if (depositOwed(primaryDoc)) {
      actions.push({ id: 'takeDeposit', label: 'Take Deposit', icon: 'credit-card-outline', tone: 'ghost' });
    }
    return actions;
  }

  return [];
}

export function StickyJobActionBar({
  job,
  primaryDoc,
  onAction,
  pending,
}: StickyJobActionBarProps) {
  const insets = useSafeAreaInsets();
  const actions = resolveJobActions(job.stage, primaryDoc);

  if (actions.length === 0) return null;

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.row}>
        {actions.map((action) => {
          const isPending = pending === action.id;
          const palette = resolveToneStyle(action.tone);
          const tint = palette.tint;
          return (
            <Pressable
              key={action.id}
              onPress={() => {
                if (isPending) return;
                action.tone === 'primary' || action.tone === 'urgent'
                  ? selectionTap()
                  : lightTap();
                onAction(action.id);
              }}
              disabled={isPending}
              style={({ pressed }) => [
                styles.button,
                palette.container,
                pressed && styles.pressed,
                isPending && styles.disabled,
              ]}
            >
              {isPending ? (
                <ActivityIndicator size="small" color={tint} />
              ) : (
                <MaterialCommunityIcons
                  name={action.icon as any}
                  size={18}
                  color={tint}
                />
              )}
              <Text
                style={[styles.label, { color: tint }]}
                numberOfLines={1}
              >
                {action.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

interface TonePalette {
  container: { backgroundColor: string; borderColor?: string; borderWidth?: number };
  tint: string;
}

function resolveToneStyle(tone: ActionTone): TonePalette {
  switch (tone) {
    case 'primary':
      return { container: { backgroundColor: colors.primary }, tint: colors.white };
    case 'warning':
      return {
        container: {
          backgroundColor: colors.warningBg,
          borderWidth: 1,
          borderColor: colors.warning + '66',
        },
        tint: colors.warning,
      };
    case 'urgent':
      return { container: { backgroundColor: colors.error }, tint: colors.white };
    default:
      return {
        container: {
          backgroundColor: colors.surfaceGray3,
          borderWidth: 1,
          borderColor: colors.border,
        },
        tint: colors.text,
      };
  }
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 10,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.6,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
  },
});
