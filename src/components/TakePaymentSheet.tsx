/**
 * TakePaymentSheet
 *
 * Bottom sheet offering payment methods when collecting on-site, hosted in
 * the shared BottomSheet like every other sheet. Phase 1 ships only "Share
 * Pay Link" (works on every device); Phase 2 will activate Card / Apple Pay /
 * Google Pay / Tap to Pay via Square's Mobile Payments SDK — those rows
 * render now but disabled so the UX stays stable.
 *
 * The header shows already-paid vs. remaining so the tradie doesn't double
 * charge a customer who already paid via an emailed link.
 */

import React, { useRef, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  Share,
  ActivityIndicator,
  Platform,
  ScrollView,
} from 'react-native';
import { Text, Button } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { maybeRequestReview } from '../services/storeReviewService';

import { makeStyles, useThemeColors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import * as squareService from '../services/squareService';
import { takeInAppPayment } from '../services/squarePayments';
import { useTapToPayEnabled } from '../hooks/useTapToPayEnabled';
import { dollarsToCents, centsToDollars } from '../../shared/pdf/money';
import {
  QM_APP_FEE_PCT_IN_PERSON,
  PASSTHROUGH_SURCHARGE_PCT,
} from '../../shared/pdf/squareFees';
import { useStore } from '../store/useStore';
import { BottomSheet } from './BottomSheet';
import { PillToggle } from './PillToggle';
import { CurrencyInput } from './CurrencyInput';
import { paymentCopy } from '../constants/paymentCopy';

export type TakePaymentTarget =
  | {
      kind: 'invoice';
      invoiceId: string;
      total: number;
      paidAmount: number;
      jobName?: string;
      invoiceNumber?: string;
      /**
       * Snapshot of the T&Cs attached to this invoice at send time. When
       * present, the sheet shows a "View terms" row and requires the tradie
       * to tick an acknowledgement before charging in person. When absent,
       * the terms section is hidden entirely.
       */
      terms?: string | null;
    }
  | {
      kind: 'quote_deposit';
      quoteId: string;
      depositAmount: number;
      depositPaid: number;
      total: number;            // Full quote total, for the "Full amount" mode.
      jobName?: string;
      terms?: string | null;
    };

type QuotePaymentMode = 'deposit' | 'full';

interface TakePaymentSheetProps {
  visible: boolean;
  target: TakePaymentTarget | null;
  onDismiss: () => void;
  onError: (message: string) => void;
  /**
   * A card charge went through. Fired after onDismiss so the host can show
   * its success dialog over the closing sheet. Share-pay-link stays silent —
   * sharing a link is not a completed payment.
   */
  onSuccess?: (info: { kind: 'card_charge'; amount: number }) => void;
  /**
   * Route to the manual-recording flow (RecordPaymentScreen) for an already-
   * received bank transfer / cash / cheque. Only wired for invoice targets —
   * quotes have no manual deposit path. When omitted, the row is hidden.
   */
  onRecordManualPayment?: (invoiceId: string) => void;
  /**
   * Square connection gate. The sheet always opens (so manual recording works
   * with zero Square setup); the Square-only rows call this before doing any
   * Square work and, when it resolves false, it has already routed the tradie
   * to the Square settings screen. When omitted, the rows proceed unguarded.
   */
  ensureSquareConnected?: () => Promise<boolean>;
}

function describeAmounts(
  target: TakePaymentTarget,
  quoteMode: QuotePaymentMode,
  /** The deposit actually being collected — the tradie can edit it on the day. */
  depositAmount: number,
): {
  alreadyPaid: number;
  remaining: number;
  label: string;
} {
  if (target.kind === 'invoice') {
    const remaining = Math.max(0, target.total - target.paidAmount);
    return {
      alreadyPaid: target.paidAmount,
      remaining,
      label: target.invoiceNumber
        ? `Invoice ${target.invoiceNumber}`
        : 'Invoice',
    };
  }
  if (quoteMode === 'full') {
    const remaining = Math.max(0, target.total - target.depositPaid);
    return {
      alreadyPaid: target.depositPaid,
      remaining,
      label: target.jobName ? `Full quote — ${target.jobName}` : 'Full quote',
    };
  }
  const remaining = Math.max(0, depositAmount - target.depositPaid);
  return {
    alreadyPaid: target.depositPaid,
    remaining,
    label: target.jobName ? `Deposit — ${target.jobName}` : 'Deposit',
  };
}

export function TakePaymentSheet({
  visible,
  target,
  onDismiss,
  onError,
  onSuccess,
  onRecordManualPayment,
  ensureSquareConnected,
}: TakePaymentSheetProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [sharing, setSharing] = useState(false);
  const [chargingCard, setChargingCard] = useState(false);
  const [quoteMode, setQuoteMode] = useState<QuotePaymentMode>('deposit');
  // Tradie attests the customer has been shown the terms on the quote/invoice
  // before we charge in person. The server stamps the actual acceptance record
  // (with version hash + timestamp) from the quote/invoice snapshot.
  const [termsAcknowledged, setTermsAcknowledged] = useState(false);
  const [termsModalVisible, setTermsModalVisible] = useState(false);
  const tapToPay = useTapToPayEnabled();
  const { businessSettings, getDocumentById, saveDocument } = useStore();
  const surchargeOn = businessSettings?.surchargePaymentFees === true;

  // The quote's deposit is a starting point, not a rule — on the day the
  // tradie agrees whatever gets the job started ("give us $500 and we'll
  // start Monday"). CurrencyInput holds the raw text while focused;
  // `depositOverride` is the committed dollar figure for this session.
  const [depositOverride, setDepositOverride] = useState<number | null>(null);
  // Share Pay Link mints server-side off `quote.depositAmount`, so an edit has
  // to land in Firestore BEFORE the link is minted. Payment rows await this.
  // Resolves false when the write failed (the sheet has already told the user).
  const depositSave = useRef<Promise<boolean> | null>(null);

  // Reset the acknowledgement + modal state whenever the sheet opens so
  // previous ticks don't carry over. On-open rather than on-close: the sheet
  // stays rendered through the close animation, and resetting then would
  // visibly untick the checkbox mid-slide.
  React.useEffect(() => {
    if (visible) {
      setTermsAcknowledged(false);
      setTermsModalVisible(false);
      setDepositOverride(null);
      depositSave.current = null;
    }
  }, [visible]);

  // Hosts null the target on dismiss (`visible={!!target}`), which used to
  // unmount the sheet mid-frame and skip the exit animation. Keep the last
  // real target so the content stays rendered while BottomSheet slides out.
  const lastTargetRef = useRef<TakePaymentTarget | null>(target);
  if (target) lastTargetRef.current = target;
  const activeTarget = target ?? lastTargetRef.current;

  // Prefer the terms snapshotted onto the quote/invoice at send time — that's
  // what the customer received in the emailed PDF. Fall back to the tradie's
  // current business-profile terms if no snapshot exists (e.g. quote was sent
  // before the tradie added terms, or never emailed — just taking payment
  // on-site). Server still stamps acceptance against whatever's on the doc.
  const snapshotTerms = activeTarget?.terms?.trim() || '';
  const liveTerms = (businessSettings?.termsAndConditions || '').trim();
  const effectiveTerms = snapshotTerms || liveTerms;
  const hasTerms = !!effectiveTerms;
  // If no terms are attached, skip the ack gate entirely — nothing to confirm.
  const termsGatePassed = !hasTerms || termsAcknowledged;

  if (!activeTarget) return null;

  // Every quote gets the deposit/full pill: the deposit is editable here, so
  // "no deposit set" is a starting value of zero rather than a missing option.
  const showQuoteModePill =
    activeTarget.kind === 'quote_deposit' && activeTarget.total > 0;

  const quoteDeposit =
    activeTarget.kind === 'quote_deposit'
      ? depositOverride ?? activeTarget.depositAmount
      : 0;
  const editingDeposit =
    activeTarget.kind === 'quote_deposit' && quoteMode === 'deposit';

  const amounts = describeAmounts(activeTarget, quoteMode, quoteDeposit);

  /**
   * Write the edited deposit back to the quote. Also flips `requireDeposit`
   * on and re-derives the percentage, because the server's link minter reads
   * all three — a quote that never had a deposit configured can be given one
   * from here.
   */
  const persistDeposit = async (amount: number): Promise<boolean> => {
    if (activeTarget.kind !== 'quote_deposit') return true;
    try {
      const doc = getDocumentById(activeTarget.quoteId);
      if (!doc) throw new Error('Quote not found');
      const pct =
        activeTarget.total > 0
          ? Math.round((amount / activeTarget.total) * 10000) / 100
          : 0;
      await saveDocument({
        ...doc,
        requireDeposit: true,
        depositAmount: amount,
        depositPercentage: pct,
      });
      return true;
    } catch {
      // Roll the display back to the stored figure — charging an amount we
      // failed to record would leave the quote and the payment disagreeing.
      setDepositOverride(null);
      onError(
        'Could not save the new deposit amount. Check your connection and try again.',
      );
      return false;
    }
  };

  // Parsing, cent-rounding, clamping to [0, total] and the unchanged check
  // live in CurrencyInput; only the domain rule stays here.
  const handleDepositCommit = (next: number) => {
    if (activeTarget.kind !== 'quote_deposit') return;
    // Zero: leave the stored figure alone — an uncollectable deposit.
    if (next <= 0) return;
    setDepositOverride(next);
    depositSave.current = persistDeposit(next);
  };

  /** Block a charge on an edit that never made it to Firestore. */
  const depositWriteSettled = async (): Promise<boolean> => {
    if (!depositSave.current) return true;
    return depositSave.current;
  };

  const handleTakeCardPayment = async () => {
    if (chargingCard || amounts.remaining <= 0) return;
    setChargingCard(true);
    try {
      // An in-flight deposit edit has to land first — otherwise we'd charge a
      // figure the quote doesn't know about.
      if (!(await depositWriteSettled())) return;
      // Square-only path: route to settings if not connected. Runs inside
      // the spinner window (the check is a network round-trip) and the
      // guard has already navigated away, so dismiss to avoid a stranded
      // modal over the settings screen.
      if (ensureSquareConnected && !(await ensureSquareConnected())) {
        onDismiss();
        return;
      }
      // Bake the passthrough surcharge (if opted in) into the charged amount
      // so the customer sees/pays the inflated total. The app fee (our cut)
      // is computed off the CHARGED amount so we also earn on the surcharge.
      const baseCents = dollarsToCents(amounts.remaining);
      const surchargeCents = surchargeOn
        ? dollarsToCents(
            centsToDollars(baseCents) * (PASSTHROUGH_SURCHARGE_PCT / 100),
          )
        : 0;
      const amountCents = baseCents + surchargeCents;
      const appFeeCents = dollarsToCents(
        centsToDollars(amountCents) * (QM_APP_FEE_PCT_IN_PERSON / 100),
      );
      await takeInAppPayment({
        target:
          activeTarget.kind === 'invoice'
            ? { kind: 'invoice', invoiceId: activeTarget.invoiceId }
            : { kind: 'quote_deposit', quoteId: activeTarget.quoteId },
        amountCents,
        appFeeCents,
        note:
          activeTarget.kind === 'invoice'
            ? `Invoice ${activeTarget.invoiceNumber || ''}`.trim()
            : `Deposit — ${activeTarget.jobName || 'job'}`,
        // Only send fallback when the doc lacks its own snapshot — the server
        // won't overwrite an existing one. Keeps the per-quote record of
        // exactly what the customer saw at send time intact.
        fallbackTerms: !snapshotTerms && liveTerms ? liveTerms : undefined,
      });
      onDismiss();
      onSuccess?.({ kind: 'card_charge', amount: centsToDollars(amountCents) });
    } catch (error: any) {
      // User-cancelled flows surface as errors from the SDK; surface a
      // friendlier message in that case.
      const message = String(error?.message || '');
      if (/cancel/i.test(message)) {
        // Silent — user backed out of payment sheet.
      } else {
        onError(message || 'Payment failed. Please try again.');
      }
    } finally {
      setChargingCard(false);
    }
  };

  const handleShareLink = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      // The deposit link is minted server-side from quote.depositAmount, so an
      // edit must be written before we ask for a link.
      if (!(await depositWriteSettled())) return;
      // Square-only path: route to settings if not connected. Runs inside
      // the spinner window (the check is a network round-trip) and the
      // guard has already navigated away, so dismiss to avoid a stranded
      // modal over the settings screen.
      if (ensureSquareConnected && !(await ensureSquareConnected())) {
        onDismiss();
        return;
      }
      const result =
        activeTarget.kind === 'invoice'
          ? await squareService.mintInvoicePaymentLink(activeTarget.invoiceId)
          : quoteMode === 'full'
            ? await squareService.mintQuoteFullPaymentLink(activeTarget.quoteId)
            : await squareService.mintQuoteDepositPaymentLink(activeTarget.quoteId);

      const jobPart = activeTarget.jobName ? ` for ${activeTarget.jobName}` : '';
      const message = `Pay ${formatCurrency(amounts.remaining)}${jobPart}: ${
        result.paymentLinkUrl
      }`;

      await Share.share(
        Platform.OS === 'ios'
          ? { message, url: result.paymentLinkUrl }
          : { message }
      );
      // Tradie just sent a pay link — phone is in THEIR hand (unlike the
      // in-person tap-to-pay flow, where the customer may hold the device), so
      // this is a safe moment to ask for a store review. Rate-limited + F&F.
      maybeRequestReview('payment_success').catch(() => {});
      onDismiss();
    } catch (error: any) {
      onError(
        error.message ||
          'Could not create a Square payment link. Please try again.'
      );
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <BottomSheet
        visible={visible}
        onDismiss={onDismiss}
        title={paymentCopy.takePayment}
        subtitle={amounts.label}
      >
        {showQuoteModePill && (
          <PillToggle<QuotePaymentMode>
            value={quoteMode}
            onChange={setQuoteMode}
            options={[
              { value: 'deposit', label: 'Deposit' },
              { value: 'full', label: 'Full amount' },
            ]}
            style={styles.modeSwitcher}
          />
        )}

        <View style={styles.amountsRow}>
          <View style={styles.amountBlock}>
            <Text style={styles.amountLabel}>Already paid</Text>
            <Text style={styles.amountValue}>
              {formatCurrency(amounts.alreadyPaid)}
            </Text>
          </View>
          <View style={styles.amountDivider} />
          <View style={styles.amountBlock}>
            <Text style={styles.amountLabel}>
              {editingDeposit ? 'Deposit' : 'Remaining'}
            </Text>
            {editingDeposit ? (
              <CurrencyInput
                variant="inline"
                value={quoteDeposit}
                min={0}
                max={activeTarget.total}
                onCommit={handleDepositCommit}
                accessibilityLabel="Deposit amount"
              />
            ) : (
              <Text style={[styles.amountValue, styles.amountValueDue]}>
                {formatCurrency(amounts.remaining)}
              </Text>
            )}
          </View>
        </View>

        {/* Only says something the row above doesn't when part of the
            deposit is already in — then the edited figure is the whole
            deposit, not what's being collected now. */}
        {editingDeposit && amounts.alreadyPaid > 0 && (
          <Text style={styles.sheetNote}>
            Taking {formatCurrency(amounts.remaining)} now.
          </Text>
        )}

        {surchargeOn && amounts.remaining > 0 && (
          <Text style={styles.sheetNote}>
            Customer pays {formatCurrency(amounts.remaining * (1 + PASSTHROUGH_SURCHARGE_PCT / 100))} on card (incl. {PASSTHROUGH_SURCHARGE_PCT}% surcharge).
          </Text>
        )}

        {/* Terms row — only surfaced when this quote/invoice carries a
            T&Cs snapshot. Two-in-one: tap to review the full text in a
            modal, checkbox to attest the customer has read them. Keeps the
            sheet tidy instead of a wall of tiny print. */}
        {tapToPay.enabled && hasTerms && (
          <View style={styles.termsCard}>
            <TouchableOpacity
              style={styles.termsHeader}
              onPress={() => setTermsModalVisible(true)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="file-document-outline"
                size={18}
                color={themeColors.accentText}
              />
              <Text style={styles.termsHeaderText}>
                Terms for this {activeTarget.kind === 'invoice' ? 'invoice' : 'quote'}
              </Text>
              <Text style={styles.termsViewLink}>View</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ackRow}
              activeOpacity={0.7}
              onPress={() => setTermsAcknowledged((v) => !v)}
            >
              <View
                style={[
                  styles.ackCheckbox,
                  termsAcknowledged && styles.ackCheckboxActive,
                ]}
              >
                {termsAcknowledged && (
                  <MaterialCommunityIcons
                    name="check"
                    size={14}
                    color={themeColors.onAccent}
                  />
                )}
              </View>
              <Text style={styles.ackText}>
                Customer has read and agrees to the terms.
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Tap to Pay / Card Entry — gated on remote flag + device capability */}
        <MethodRow
          icon="cellphone-nfc"
          title="Tap to Pay / Card Entry"
          subtitle={
            tapToPay.enabled
              ? termsGatePassed
                ? 'Tap a card or phone, or key in details.'
                : 'Confirm customer has read terms above.'
              : tapToPay.reason === 'pending_apple'
                ? 'Coming soon on iPhone — pending Apple approval.'
                : tapToPay.reason === 'unsupported_device'
                  ? 'This device does not support Tap to Pay.'
                  : tapToPay.reason === 'loading'
                    ? 'Checking device…'
                    : 'Not enabled for your account yet.'
          }
          onPress={
            tapToPay.enabled && termsGatePassed
              ? handleTakeCardPayment
              : undefined
          }
          disabled={!tapToPay.enabled || !termsGatePassed}
          loading={chargingCard}
        />

        {/* Phase 1 — Share a Square pay link */}
        <MethodRow
          icon="share-variant"
          title="Share Pay Link"
          subtitle="Send a Square checkout link via SMS, email or WhatsApp."
          onPress={handleShareLink}
          loading={sharing}
        />

        {/* Manual recording — invoice only (quotes have no manual deposit
            path). No Square guard: works with zero Square setup. */}
        {activeTarget.kind === 'invoice' && onRecordManualPayment && (
          <MethodRow
            icon="cash-multiple"
            title={paymentCopy.recordPayment}
            subtitle={paymentCopy.recordPaymentSubtitle}
            onPress={() => {
              onDismiss();
              onRecordManualPayment(activeTarget.invoiceId);
            }}
          />
        )}

        <Button
          mode="text"
          onPress={onDismiss}
          style={styles.cancelButton}
          disabled={sharing || chargingCard}
        >
          {paymentCopy.cancel}
        </Button>
      </BottomSheet>

      {/* Terms preview — a native Modal so it layers above the Portal sheet. */}
      {hasTerms && (
        <TermsPreviewModal
          visible={termsModalVisible}
          terms={effectiveTerms}
          docLabel={activeTarget.kind === 'invoice' ? 'Invoice' : 'Quote'}
          onClose={() => setTermsModalVisible(false)}
          onAccept={() => {
            setTermsAcknowledged(true);
            setTermsModalVisible(false);
          }}
          alreadyAccepted={termsAcknowledged}
        />
      )}
    </>
  );
}

interface TermsPreviewModalProps {
  visible: boolean;
  terms: string;
  docLabel: string;
  onClose: () => void;
  onAccept: () => void;
  alreadyAccepted: boolean;
}

function TermsPreviewModal({
  visible,
  terms,
  docLabel,
  onClose,
  onAccept,
  alreadyAccepted,
}: TermsPreviewModalProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.termsBackdrop}>
        <View style={styles.termsModal}>
          <View style={styles.termsModalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.termsModalTitle}>Terms &amp; Conditions</Text>
              <Text style={styles.termsModalSubtitle}>{docLabel}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons name="close" size={22} color={themeColors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.termsModalBody}
            contentContainerStyle={styles.termsModalBodyContent}
          >
            <Text style={styles.termsModalText}>{terms}</Text>
          </ScrollView>
          {/* Single primary action — the header X and Android back dismiss. */}
          <View style={styles.termsModalFooter}>
            <Button
              mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent}
              onPress={onAccept}
              disabled={alreadyAccepted}
              icon={alreadyAccepted ? 'check' : undefined}
            >
              {alreadyAccepted ? 'Confirmed' : 'Customer agrees'}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface MethodRowProps {
  icon: string;
  title: string;
  subtitle: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
}

function MethodRow({
  icon,
  title,
  subtitle,
  onPress,
  loading,
  disabled,
}: MethodRowProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <TouchableOpacity
      style={[styles.methodRow, disabled && styles.methodRowDisabled]}
      onPress={disabled ? undefined : onPress}
      activeOpacity={disabled ? 1 : 0.7}
    >
      <View style={[styles.methodIcon, disabled && styles.methodIconDisabled]}>
        <MaterialCommunityIcons
          name={icon as any}
          size={24}
          color={disabled ? themeColors.textMuted : themeColors.accent}
        />
      </View>
      <View style={styles.methodText}>
        <Text
          style={[
            styles.methodTitle,
            disabled && styles.methodTitleDisabled,
          ]}
        >
          {title}
        </Text>
        <Text style={styles.methodSubtitle}>{subtitle}</Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={themeColors.accentText} />
      ) : (
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={disabled ? themeColors.textMuted : themeColors.textSecondary}
        />
      )}
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((t) => ({
  modeSwitcher: {
    alignSelf: 'center',
    marginBottom: 16,
  },
  amountsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaceOverlay,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    ...t.elevation[1],
  },
  amountBlock: {
    flex: 1,
    alignItems: 'center',
  },
  amountDivider: {
    width: 1,
    height: 32,
    backgroundColor: t.colors.border,
  },
  amountLabel: {
    fontSize: 12,
    color: t.colors.textSecondary,
    marginBottom: 4,
  },
  amountValue: {
    fontSize: 18,
    fontWeight: '700',
    color: t.colors.text,
  },
  amountValueDue: {
    color: t.colors.money,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaceOverlay,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    ...t.elevation[1],
  },
  methodRowDisabled: {
    opacity: 0.55,
  },
  methodIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  methodIconDisabled: {
    backgroundColor: t.colors.border,
  },
  methodText: { flex: 1 },
  methodTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: t.colors.text,
  },
  methodTitleDisabled: {
    color: t.colors.textMuted,
  },
  methodSubtitle: {
    fontSize: 12,
    color: t.colors.textSecondary,
    marginTop: 2,
  },
  cancelButton: {
    marginTop: 8,
  },
  ackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
    marginBottom: 6,
  },
  ackCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  ackCheckboxActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  ackText: {
    flex: 1,
    fontSize: 13,
    color: t.colors.textSecondary,
    lineHeight: 18,
  },
  sheetNote: {
    fontSize: 12,
    color: t.colors.textMuted,
    textAlign: 'center',
    marginTop: -8,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  termsCard: {
    backgroundColor: t.colors.surfaceOverlay,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 10,
    ...t.elevation[1],
  },
  termsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  termsHeaderText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
  },
  termsViewLink: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.accentText,
  },
  termsBackdrop: {
    flex: 1,
    backgroundColor: t.colors.backdrop,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  termsModal: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '85%',
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 16,
    overflow: 'hidden',
  },
  termsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
  },
  termsModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: t.colors.text,
  },
  termsModalSubtitle: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  termsModalBody: {
    paddingHorizontal: 20,
  },
  termsModalBodyContent: {
    paddingTop: 14,
    paddingBottom: 18,
  },
  termsModalText: {
    fontSize: 14,
    lineHeight: 22,
    color: t.colors.text,
  },
  termsModalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
  },
}));
