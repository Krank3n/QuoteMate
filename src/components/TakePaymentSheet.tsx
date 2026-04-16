/**
 * TakePaymentSheet
 *
 * Bottom-sheet modal offering payment methods when collecting on-site.
 * Phase 1 ships only "Share Pay Link" (works on every device); Phase 2 will
 * activate Card / Apple Pay / Google Pay / Tap to Pay via Square's Mobile
 * Payments SDK — those rows render now but disabled so the UX stays stable.
 *
 * The header shows already-paid vs. remaining so the tradie doesn't double
 * charge a customer who already paid via an emailed link.
 */

import React, { useState } from 'react';
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

import { colors } from '../theme';
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
}

function describeAmounts(
  target: TakePaymentTarget,
  quoteMode: QuotePaymentMode,
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
  const remaining = Math.max(0, target.depositAmount - target.depositPaid);
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
}: TakePaymentSheetProps) {
  const [sharing, setSharing] = useState(false);
  const [chargingCard, setChargingCard] = useState(false);
  const [quoteMode, setQuoteMode] = useState<QuotePaymentMode>('deposit');
  // Tradie attests the customer has been shown the terms on the quote/invoice
  // before we charge in person. The server stamps the actual acceptance record
  // (with version hash + timestamp) from the quote/invoice snapshot.
  const [termsAcknowledged, setTermsAcknowledged] = useState(false);
  const [termsModalVisible, setTermsModalVisible] = useState(false);
  const tapToPay = useTapToPayEnabled();
  const { businessSettings } = useStore();
  const surchargeOn = businessSettings?.surchargePaymentFees === true;

  // Reset the acknowledgement + modal state whenever the sheet opens for a
  // new target so previous ticks don't carry over.
  React.useEffect(() => {
    if (!visible) {
      setTermsAcknowledged(false);
      setTermsModalVisible(false);
    }
  }, [visible]);

  // Prefer the terms snapshotted onto the quote/invoice at send time — that's
  // what the customer received in the emailed PDF. Fall back to the tradie's
  // current business-profile terms if no snapshot exists (e.g. quote was sent
  // before the tradie added terms, or never emailed — just taking payment
  // on-site). Server still stamps acceptance against whatever's on the doc.
  const snapshotTerms = target?.terms?.trim() || '';
  const liveTerms = (businessSettings?.termsAndConditions || '').trim();
  const effectiveTerms = snapshotTerms || liveTerms;
  const hasTerms = !!effectiveTerms;
  // If no terms are attached, skip the ack gate entirely — nothing to confirm.
  const termsGatePassed = !hasTerms || termsAcknowledged;

  if (!target) return null;

  // Show the deposit/full pill only when a quote has a deposit smaller than
  // total — otherwise the toggle has nothing to toggle.
  const showQuoteModePill =
    target.kind === 'quote_deposit' &&
    target.total > target.depositAmount;

  const amounts = describeAmounts(target, quoteMode);

  const handleTakeCardPayment = async () => {
    if (chargingCard || amounts.remaining <= 0) return;
    setChargingCard(true);
    try {
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
          target.kind === 'invoice'
            ? { kind: 'invoice', invoiceId: target.invoiceId }
            : { kind: 'quote_deposit', quoteId: target.quoteId },
        amountCents,
        appFeeCents,
        note:
          target.kind === 'invoice'
            ? `Invoice ${target.invoiceNumber || ''}`.trim()
            : `Deposit — ${target.jobName || 'job'}`,
        // Only send fallback when the doc lacks its own snapshot — the server
        // won't overwrite an existing one. Keeps the per-quote record of
        // exactly what the customer saw at send time intact.
        fallbackTerms: !snapshotTerms && liveTerms ? liveTerms : undefined,
      });
      onDismiss();
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
      const result =
        target.kind === 'invoice'
          ? await squareService.mintInvoicePaymentLink(target.invoiceId)
          : quoteMode === 'full'
            ? await squareService.mintQuoteFullPaymentLink(target.quoteId)
            : await squareService.mintQuoteDepositPaymentLink(target.quoteId);

      const jobPart = target.jobName ? ` for ${target.jobName}` : '';
      const message = `Pay ${formatCurrency(amounts.remaining)}${jobPart}: ${
        result.paymentLinkUrl
      }`;

      await Share.share(
        Platform.OS === 'ios'
          ? { message, url: result.paymentLinkUrl }
          : { message }
      );
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
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onDismiss}
      >
        <TouchableOpacity style={styles.sheet} activeOpacity={1}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Take Payment</Text>
          <Text style={styles.subtitle}>{amounts.label}</Text>

          {showQuoteModePill && (
            <View style={styles.modeSwitcher}>
              <TouchableOpacity
                style={[
                  styles.modePill,
                  quoteMode === 'deposit' && styles.modePillActive,
                ]}
                onPress={() => setQuoteMode('deposit')}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.modePillText,
                    quoteMode === 'deposit' && styles.modePillTextActive,
                  ]}
                >
                  Deposit
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modePill,
                  quoteMode === 'full' && styles.modePillActive,
                ]}
                onPress={() => setQuoteMode('full')}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.modePillText,
                    quoteMode === 'full' && styles.modePillTextActive,
                  ]}
                >
                  Full amount
                </Text>
              </TouchableOpacity>
            </View>
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
              <Text style={styles.amountLabel}>Remaining</Text>
              <Text style={[styles.amountValue, styles.amountValueDue]}>
                {formatCurrency(amounts.remaining)}
              </Text>
            </View>
          </View>

          {surchargeOn && amounts.remaining > 0 && (
            <Text style={styles.surchargeNote}>
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
                  color={colors.primary}
                />
                <Text style={styles.termsHeaderText}>
                  Terms for this {target.kind === 'invoice' ? 'invoice' : 'quote'}
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
                      color={colors.onPrimary}
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

          <Button
            mode="text"
            onPress={onDismiss}
            style={styles.cancelButton}
            disabled={sharing || chargingCard}
          >
            Cancel
          </Button>
        </TouchableOpacity>
      </TouchableOpacity>

      {/* Terms preview modal. Rendered inside the parent Modal so it layers
          above the sheet without fighting its backdrop. */}
      {hasTerms && (
        <TermsPreviewModal
          visible={termsModalVisible}
          terms={effectiveTerms}
          docLabel={target.kind === 'invoice' ? 'Invoice' : 'Quote'}
          onClose={() => setTermsModalVisible(false)}
          onAccept={() => {
            setTermsAcknowledged(true);
            setTermsModalVisible(false);
          }}
          alreadyAccepted={termsAcknowledged}
        />
      )}
    </Modal>
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
              <MaterialCommunityIcons name="close" size={22} color={colors.onSurface} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.termsModalBody}
            contentContainerStyle={styles.termsModalBodyContent}
          >
            <Text style={styles.termsModalText}>{terms}</Text>
          </ScrollView>
          <View style={styles.termsModalFooter}>
            <Button mode="text" onPress={onClose} compact>
              Close
            </Button>
            <Button
              mode="contained"
              onPress={onAccept}
              disabled={alreadyAccepted}
              icon={alreadyAccepted ? 'check' : undefined}
              style={{ marginLeft: 8 }}
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
          color={disabled ? colors.textMuted : colors.primary}
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
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={disabled ? colors.textMuted : colors.onSurface}
        />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  modeSwitcher: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: colors.background,
    borderRadius: 999,
    padding: 4,
    marginBottom: 16,
    gap: 2,
  },
  modePill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  modePillActive: {
    backgroundColor: colors.primary,
  },
  modePillText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  modePillTextActive: {
    color: colors.onPrimary,
  },
  amountsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  amountBlock: {
    flex: 1,
    alignItems: 'center',
  },
  amountDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.border,
  },
  amountLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 4,
  },
  amountValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  amountValueDue: {
    color: colors.primary,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  methodRowDisabled: {
    opacity: 0.55,
  },
  methodIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  methodIconDisabled: {
    backgroundColor: colors.border,
  },
  methodText: { flex: 1 },
  methodTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  methodTitleDisabled: {
    color: colors.textMuted,
  },
  methodSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
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
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  ackCheckboxActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  ackText: {
    flex: 1,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  surchargeNote: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: -8,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  termsCard: {
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 10,
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
    color: colors.text,
  },
  termsViewLink: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  termsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  termsModal: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '85%',
    backgroundColor: colors.surface,
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
    borderBottomColor: colors.border,
  },
  termsModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  termsModalSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
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
    color: colors.text,
  },
  termsModalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
