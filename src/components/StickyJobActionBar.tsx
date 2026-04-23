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
  | 'sendQuote'
  | 'markApproved'
  | 'takeDeposit'
  | 'schedule'
  | 'startJob'
  | 'generateInvoice'
  | 'markComplete'
  | 'takeFinalPayment'
  | 'sendInvoice'
  | 'closeJob';

interface ActionSpec {
  id: JobActionId;
  label: string;
  icon: string;
  tone: 'primary' | 'ghost' | 'warning';
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
 * Returns primary first, secondary second. One or both may be omitted.
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

  // Invoice in play → money-collection is the priority.
  if (isInvoicePaid) {
    return [
      { id: 'closeJob', label: 'Close Job', icon: 'archive-arrow-down-outline', tone: 'primary' },
    ];
  }
  if (isInvoiceUnpaid || (isInvoice && invoiceBalanceOwed(primaryDoc))) {
    return [
      { id: 'takeFinalPayment', label: 'Take Payment', icon: 'credit-card-outline', tone: 'primary' },
      { id: 'sendInvoice', label: 'Send Invoice', icon: 'email-send-outline', tone: 'ghost' },
    ];
  }
  if (isInvoice && isDraft) {
    return [
      { id: 'sendInvoice', label: 'Send Invoice', icon: 'email-send-outline', tone: 'primary' },
    ];
  }

  // Quote is the primary doc.
  if (isDraft) {
    return [
      { id: 'sendQuote', label: 'Send Quote', icon: 'send-outline', tone: 'primary' },
      { id: 'continueQuote', label: 'Edit Quote', icon: 'pencil-outline', tone: 'ghost' },
    ];
  }
  if (isQuoteSent) {
    const actions: ActionSpec[] = [];
    if (depositOwed(primaryDoc)) {
      actions.push({ id: 'takeDeposit', label: 'Take Deposit', icon: 'credit-card-outline', tone: 'primary' });
      actions.push({ id: 'markApproved', label: 'Mark Approved', icon: 'check-circle-outline', tone: 'ghost' });
    } else {
      actions.push({ id: 'markApproved', label: 'Mark Approved', icon: 'check-circle-outline', tone: 'primary' });
      actions.push({ id: 'sendQuote', label: 'Resend', icon: 'send-outline', tone: 'ghost' });
    }
    return actions;
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
          const isPrimary = action.tone === 'primary';
          return (
            <Pressable
              key={action.id}
              onPress={() => {
                if (isPending) return;
                isPrimary ? selectionTap() : lightTap();
                onAction(action.id);
              }}
              disabled={isPending}
              style={({ pressed }) => [
                styles.button,
                isPrimary ? styles.primary : styles.ghost,
                pressed && styles.pressed,
                isPending && styles.disabled,
              ]}
            >
              {isPending ? (
                <ActivityIndicator
                  size="small"
                  color={isPrimary ? colors.white : colors.primary}
                />
              ) : (
                <MaterialCommunityIcons
                  name={action.icon as any}
                  size={18}
                  color={isPrimary ? colors.white : colors.primary}
                />
              )}
              <Text
                style={[
                  styles.label,
                  isPrimary ? styles.labelPrimary : styles.labelGhost,
                ]}
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
  primary: {
    backgroundColor: colors.primary,
  },
  ghost: {
    backgroundColor: colors.surfaceGray3,
    borderWidth: 1,
    borderColor: colors.border,
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
  labelPrimary: {
    color: colors.white,
  },
  labelGhost: {
    color: colors.text,
  },
});
