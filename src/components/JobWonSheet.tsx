/**
 * JobWonSheet — the "job won" moment.
 *
 * Shown once per won quote (see ViewJobScreen): right after a tradie marks it
 * accepted, or on their first open of a job the customer accepted remotely —
 * from the email, the hosted quote page, or by paying the deposit.
 * The next thing that happens on a won job is money: the deposit they asked
 * for, or the invoice. That is the primary button, and it runs the same flows
 * the sticky job bar runs — the sheet owns no navigation of its own, it calls
 * back into the job screen.
 *
 * Pro is secondary and only offered when it is actually the tradie's next
 * problem: a trial about to end, or a free account that has set up bank
 * transfer / PayID / BPAY / PayPal, which Free keeps off the document. Free
 * keeps unlimited quotes and Square invoicing, so nothing here may suggest
 * otherwise — the sheet used to put "See Pro" in front of an unpaid job and
 * tell free users that Pro "lets you invoice this job".
 *
 * Dismissible and non-blocking — the stage change has already landed before
 * this appears. Who sees it and how often is gated by the caller
 * (maybeShowWonPrompt); this component just renders and reports. It is only
 * mounted while it's up, so the close animation never renders a stale total.
 */

import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

import { makeStyles } from '../theme';
import { BottomSheet } from './BottomSheet';
import { formatCurrency } from '../utils/quoteCalculator';
import { trackEvent } from '../services/analyticsService';
import { selectionTap, lightTap } from '../utils/haptics';
import type { PaymentMethodSettings } from '../types';

/** The money step a won job is up to. Never a percentage — see collectBody. */
export type WonCollectAction = 'deposit' | 'invoice';

interface JobWonSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** Customer name, falling back to the job name. */
  name: string;
  /** The quote total just accepted — the value delivered. */
  total: number;
  /**
   * Whole days left in an ending trial, or null for a free user. A trial user
   * already has what Pro does, so the line names what they're about to lose
   * instead of selling them something they have.
   */
  trialDaysRemaining: number | null;
  /**
   * Which collection flow this job needs next: the deposit the tradie asked
   * for on the quote, or the invoice. Decided by the caller from the document.
   */
  collect: WonCollectAction;
  /** Runs that flow on the job screen (take payment / create the invoice). */
  onCollect: () => void;
  /**
   * The account has a non-Square payment method saved. Free keeps those off
   * quotes and invoices, so this is what makes the Pro line true rather than
   * generic — see shouldOfferPro.
   */
  hasOtherPaymentMethod: boolean;
}

/** The primary button: the money step, named plainly. */
export function collectLabel(action: WonCollectAction): string {
  return action === 'deposit' ? 'Take the deposit' : 'Create the invoice';
}

/**
 * The line under the total. Deliberately says nothing about how big a deposit
 * should be — the amount is whatever the tradie put on the quote.
 */
export function collectBody(action: WonCollectAction): string {
  return action === 'deposit'
    ? "Next step is the deposit — take it now and you're underway."
    : 'Next step is the invoice — create it now and get paid.';
}

/**
 * True when the account has a non-Square payment method set up with something
 * to actually print. Mirrors the enabled + has-data checks in
 * generatePaymentMethodsHTML (shared/pdf/htmlBuilders.ts), which is the gate
 * Pro lifts.
 */
export function hasNonSquarePaymentMethod(
  pm: PaymentMethodSettings | undefined | null,
): boolean {
  if (!pm) return false;
  const bank = pm.bankAccount;
  if (bank?.enabled && (bank.accountName || bank.bsb || bank.accountNumber)) return true;
  if (pm.payId?.enabled && pm.payId.payIdValue) return true;
  if (pm.bpay?.enabled && (pm.bpay.billerCode || pm.bpay.referenceNumber)) return true;
  if (pm.paypal?.enabled && pm.paypal.email) return true;
  if (pm.other?.enabled && pm.other.instructions) return true;
  return false;
}

/**
 * Whether Pro is worth mentioning on this win at all. A trial in its last days
 * is losing something real; a free account is only shown the offer when it has
 * a payment method Free is holding back. Anything else and the secondary is
 * just "Not now" — a won job that is not yet paid is no place for a sales
 * pitch.
 */
export function shouldOfferPro(args: {
  trialDaysRemaining: number | null;
  hasOtherPaymentMethod: boolean;
}): boolean {
  if (args.trialDaysRemaining !== null) return true;
  return args.hasOtherPaymentMethod;
}

/** The one line on what Pro does, told from where the tradie stands. */
export function proLine(trialDaysRemaining: number | null): string {
  if (trialDaysRemaining === null) {
    return 'Pro also puts bank transfer, PayID and PayPal on your quotes and invoices, alongside Square.';
  }
  const ending =
    trialDaysRemaining <= 0
      ? 'Your trial ends today'
      : `Your trial ends in ${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'}`;
  return `${ending} — Pro keeps bank transfer, PayID and PayPal on your documents.`;
}

export function JobWonSheet({
  visible,
  onDismiss,
  name,
  total,
  trialDaysRemaining,
  collect,
  onCollect,
  hasOtherPaymentMethod,
}: JobWonSheetProps) {
  const styles = useStyles();
  const navigation = useNavigation<any>();
  // One outcome per sheet. The buttons stay live through BottomSheet's close
  // animation, so a double-tap would otherwise report two won_prompt_tapped
  // events (and navigate on top of a dismiss).
  const decided = useRef(false);
  const offerPro = shouldOfferPro({ trialDaysRemaining, hasOtherPaymentMethod });

  // One impression per open. Keyed on `visible` so a re-render mid-sheet
  // doesn't re-fire, and the close animation (visible=false) never counts.
  useEffect(() => {
    if (visible) {
      decided.current = false;
      trackEvent('won_prompt_shown', { collect, pro_offered: offerPro });
    }
  }, [visible]);

  const handleCollect = () => {
    if (decided.current) return;
    decided.current = true;
    selectionTap();
    trackEvent('won_prompt_tapped', { outcome: collect });
    onDismiss();
    onCollect();
  };

  const handleSeePro = () => {
    if (decided.current) return;
    decided.current = true;
    selectionTap();
    trackEvent('won_prompt_tapped', { outcome: 'see_pro' });
    onDismiss();
    navigation.navigate('Paywall', { source: 'job_won' });
  };

  const handleNotNow = () => {
    if (decided.current) return;
    decided.current = true;
    lightTap();
    trackEvent('won_prompt_tapped', { outcome: 'not_now' });
    onDismiss();
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Job won" subtitle={name}>
      <View style={styles.container}>
        <Text style={styles.total}>{formatCurrency(total)}</Text>
        <Text style={styles.totalLabel}>accepted</Text>

        <Text style={styles.body}>{collectBody(collect)}</Text>

        <Button
          mode="contained"
          onPress={handleCollect}
          style={styles.primaryButton}
          contentStyle={styles.primaryButtonContent}
        >
          {collectLabel(collect)}
        </Button>

        {offerPro ? (
          <>
            <Text style={styles.proNote}>{proLine(trialDaysRemaining)}</Text>
            <Button mode="text" onPress={handleSeePro} style={styles.secondaryButton}>
              See Pro
            </Button>
          </>
        ) : null}

        <Button mode="text" onPress={handleNotNow} style={styles.secondaryButton}>
          Not now
        </Button>
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    alignItems: 'center',
    gap: 4,
    paddingBottom: 8,
  },
  total: {
    fontSize: 34,
    fontWeight: '800',
    color: t.colors.money,
  },
  totalLabel: {
    fontSize: 13,
    color: t.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    color: t.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  proNote: {
    fontSize: 13,
    color: t.colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 16,
    paddingHorizontal: 4,
  },
  primaryButton: {
    alignSelf: 'stretch',
    borderRadius: 12,
  },
  primaryButtonContent: {
    paddingVertical: 8,
  },
  secondaryButton: {
    marginTop: 4,
  },
}));
