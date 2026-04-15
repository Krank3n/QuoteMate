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
} from 'react-native';
import { Text, Button } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import * as squareService from '../services/squareService';
import { takeInAppPayment } from '../services/squarePayments';
import { useTapToPayEnabled } from '../hooks/useTapToPayEnabled';

export type TakePaymentTarget =
  | {
      kind: 'invoice';
      invoiceId: string;
      total: number;
      paidAmount: number;
      jobName?: string;
      invoiceNumber?: string;
    }
  | {
      kind: 'quote_deposit';
      quoteId: string;
      depositAmount: number;
      depositPaid: number;
      jobName?: string;
    };

interface TakePaymentSheetProps {
  visible: boolean;
  target: TakePaymentTarget | null;
  onDismiss: () => void;
  onError: (message: string) => void;
}

function describeAmounts(target: TakePaymentTarget): {
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
  const tapToPay = useTapToPayEnabled();

  if (!target) return null;

  const amounts = describeAmounts(target);

  const handleTakeCardPayment = async () => {
    if (chargingCard || amounts.remaining <= 0) return;
    setChargingCard(true);
    try {
      const amountCents = Math.round(amounts.remaining * 100);
      await takeInAppPayment({
        target:
          target.kind === 'invoice'
            ? { kind: 'invoice', invoiceId: target.invoiceId }
            : { kind: 'quote_deposit', quoteId: target.quoteId },
        amountCents,
        note:
          target.kind === 'invoice'
            ? `Invoice ${target.invoiceNumber || ''}`.trim()
            : `Deposit — ${target.jobName || 'job'}`,
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

          {/* Tap to Pay / Card Entry — gated on remote flag + device capability */}
          <MethodRow
            icon="cellphone-nfc"
            title="Tap to Pay / Card Entry"
            subtitle={
              tapToPay.enabled
                ? 'Tap a card or phone, or key in details.'
                : tapToPay.reason === 'pending_apple'
                  ? 'Coming soon on iPhone — pending Apple approval.'
                  : tapToPay.reason === 'unsupported_device'
                    ? 'This device does not support Tap to Pay.'
                    : tapToPay.reason === 'loading'
                      ? 'Checking device…'
                      : 'Not enabled for your account yet.'
            }
            onPress={tapToPay.enabled ? handleTakeCardPayment : undefined}
            disabled={!tapToPay.enabled}
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
});
