/**
 * Record Payment — bottom-sheet screen for logging money already received
 * (bank transfer / cash / cheque) against an invoice, and for editing or
 * removing a ledger entry.
 *
 * Registered as a `transparentModal` route rendering the shared BottomSheet,
 * so every navigate('RecordPayment') call site keeps working while the
 * surface matches TakePaymentSheet / PaymentSheet instead of pushing a
 * full headered screen. The screen's own card is invisible — BottomSheet
 * portals above the navigator and owns all motion.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Pressable } from 'react-native';
import { Text, Button, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { format, subDays, isToday, isYesterday, isSameDay } from 'date-fns';

import { useStore, PAYMENT_METHOD_TO_LEDGER } from '../store/useStore';
import { maxAmountForEdit } from '../utils/editablePayment';
import { PaymentMethod } from '../types';
import { makeStyles, useThemeColors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { getAmountDue } from '../utils/invoiceCalculator';
import { BottomSheet } from '../components/BottomSheet';
import { CurrencyInput } from '../components/CurrencyInput';
import { DueDateSheet } from '../components/DueDateSheet';
import { useAlertModal } from '../hooks/useAlertModal';
import { paymentCopy } from '../constants/paymentCopy';

/**
 * Ledger method → the form option that represents it. Lossy on purpose:
 * card / cheque / other all store as 'other', so an edited card payment
 * prefills as "Other". The amount, date and notes are what people come back
 * to fix; losing the card/cheque distinction is the cheaper trade than
 * widening the stored vocabulary.
 */
const LEDGER_METHOD_TO_FORM: Record<string, PaymentMethod> = {
  cash: 'cash',
  bank: 'bank_transfer',
  square: 'card',
  other: 'other',
};

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export function RecordPaymentScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const invoiceId = route.params?.invoiceId;
  // Present → edit that ledger entry instead of appending a new one. Same
  // fields either way, so the screen is reused rather than duplicated.
  const editingPaymentId: string | undefined = route.params?.paymentId;

  const invoices = useStore((s) => s.invoices);
  const currentInvoice = useStore((s) => s.currentInvoice);
  const documents = useStore((s) => s.documents);
  const xeroConnection = useStore((s) => s.xeroConnection);
  const recordPayment = useStore((s) => s.recordPayment);
  const recordDocumentPayment = useStore((s) => s.recordDocumentPayment);
  const pushPaymentToXero = useStore((s) => s.pushPaymentToXero);
  const updateDocumentPayment = useStore((s) => s.updateDocumentPayment);
  const deleteDocumentPayment = useStore((s) => s.deleteDocumentPayment);

  const { showAlert, dismissAlert, alertNode } = useAlertModal();

  // Sheet lifecycle on a navigation screen: mounted visible, dismissal plays
  // the close animation, and goBack() only fires from onClosed — popping any
  // earlier would snap the sheet away mid-slide.
  const [visible, setVisible] = useState(true);
  const closingRef = useRef(false);
  const dismiss = useCallback(() => setVisible(false), []);
  const handleClosed = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // A hardware back that already popped this (transparent) screen leaves
    // us unfocused — a second goBack here would pop the screen underneath.
    if (navigation.isFocused()) navigation.goBack();
  }, [navigation]);

  // Callers navigate here with a *Document* id (ViewJobScreen passes
  // actionableDoc.id). The legacy `invoices` array is never loaded at
  // bootstrap and its ids diverge from Document ids after a quote → invoice
  // conversion, so a legacy-only lookup dead-ended on "Invoice not found"
  // for the modern flow. Resolve the unified doc as well and render from
  // whichever we find.
  const legacyInvoice = invoices.find((i) => i.id === invoiceId) ||
    (currentInvoice?.id === invoiceId ? currentInvoice : null);
  const document = documents.find(
    (d) => d.type === 'invoice' && (d.id === invoiceId || d.legacyInvoiceId === invoiceId),
  );
  // A payment written to the unified ledger is the one that sticks; the
  // legacy row is only kept in step when it exists.
  const invoice = legacyInvoice ||
    (document
      ? {
          id: document.id,
          invoiceNumber: document.number,
          total: Number(document.total) || 0,
          paidAmount: Number(document.paidTotal) || 0,
          customerName: document.customerName || '',
          squarePaymentId: document.squarePaymentId,
          squarePaidAt: document.squarePaidAt,
          xeroInvoiceId: document.xeroInvoiceId,
        } as any
      : null);
  // The legacy row wins the lookup above, and its projection can reach us
  // without a customerName — which printed a blank customer line on a
  // screen whose whole job is confirming who paid you. Take the name from
  // whichever source actually has one.
  const customerName =
    (invoice?.customerName || '').trim() || (document?.customerName || '').trim();
  const amountDue = document
    ? Math.max(0, (Number(document.total) || 0) - (Number(document.paidTotal) || 0))
    : invoice
      ? getAmountDue(invoice)
      : 0;

  const editingPayment = editingPaymentId
    ? (document?.payments || []).find((p) => p.id === editingPaymentId)
    : undefined;
  // When editing, the ceiling has to exclude the payment being edited —
  // otherwise an unchanged entry caps at zero. See maxAmountForEdit.
  const ceiling = editingPayment && document
    ? maxAmountForEdit(document, editingPayment)
    : amountDue;

  // Cent-round the prefill: amountDue is a float subtraction (total -
  // paidTotal) and its IEEE noise would otherwise ride the accept-the-default
  // path straight into the ledger and the Xero push.
  const [amount, setAmount] = useState<number>(
    Math.round((editingPayment ? Number(editingPayment.amount) || 0 : amountDue) * 100) / 100,
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    LEDGER_METHOD_TO_FORM[editingPayment?.method ?? ''] ?? 'bank_transfer',
  );
  const [notes, setNotes] = useState(editingPayment?.notes ?? '');
  const [paymentDate, setPaymentDate] = useState(
    editingPayment?.paidAt ? new Date(editingPayment.paidAt) : new Date(),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The shared month calendar (same one due dates and document backdating
  // use), for payments older than the quick chips reach.
  const [dateSheetVisible, setDateSheetVisible] = useState(false);

  // Keyed on the resolved id + figure, NOT the `invoice` object — that
  // projection is rebuilt every render, and an identity dep made this effect
  // fire after every keystroke, stomping a hand-entered amount (and the 50%
  // quick-pick) back to the full balance.
  const invoiceKey = invoice ? invoice.id : null;
  useEffect(() => {
    // Don't stomp the value being edited when the doc reloads.
    if (invoiceKey && !editingPayment) {
      setAmount(Math.round(amountDue * 100) / 100);
    }
  }, [invoiceKey, amountDue, editingPayment]);

  const handleRecordPayment = async () => {
    if (!invoice) return;

    if (!Number.isFinite(amount) || amount <= 0) {
      showAlert({
        type: 'warning',
        title: 'Enter an amount',
        message: 'Enter the payment amount before saving.',
      });
      return;
    }

    // Hard-reject overpayment. Allow a 1c tolerance for rounding (e.g., when
    // a Square webhook records $50.001 and the tradie tries to close the
    // remaining cent via cash).
    if (amount > ceiling + 0.01) {
      showAlert({
        type: 'warning',
        title: 'Amount exceeds balance',
        message: `Enter up to ${formatCurrency(ceiling)}. This invoice doesn't owe more than that.`,
      });
      return;
    }

    await submitPayment(amount);
  };

  const handleDelete = () => {
    if (!editingPaymentId || !document) return;
    showAlert({
      type: 'warning',
      title: 'Remove this payment?',
      message: 'The invoice balance goes back up by this amount.',
      primaryButtonText: 'Remove',
      secondaryButtonText: paymentCopy.cancel,
      // AlertModal renders the secondary button only when BOTH text and
      // action are present — without this no-op, a destructive confirm
      // ships with "Remove" as its only button.
      secondaryButtonAction: () => {},
      // Keeps-open so a failure can swap in the error dialog without the
      // auto-dismiss wiping it.
      primaryKeepsOpen: true,
      primaryButtonAction: async () => {
        setIsSubmitting(true);
        try {
          await deleteDocumentPayment(document.id, editingPaymentId);
          dismissAlert();
          dismiss();
        } catch (err: any) {
          showAlert({
            type: 'error',
            title: 'Couldn’t remove it',
            message: err?.message || 'Please try again.',
          });
        } finally {
          setIsSubmitting(false);
        }
      },
    });
  };

  const submitPayment = async (paymentAmount: number) => {
    if (!invoice) return;

    setIsSubmitting(true);
    try {
      if (editingPaymentId && document) {
        await updateDocumentPayment(document.id, editingPaymentId, {
          amount: paymentAmount,
          paidAt: paymentDate.getTime(),
          method: PAYMENT_METHOD_TO_LEDGER[paymentMethod] ?? 'other',
          notes: notes || undefined,
        });
        showAlert({
          type: 'success',
          title: paymentCopy.paymentUpdatedTitle,
          message: `This payment is now ${formatCurrency(paymentAmount)}.`,
          primaryButtonText: 'Done',
          primaryButtonAction: dismiss,
        });
        return;
      }
      if (document) {
        // recordDocumentPayment mirrors into the legacy row itself when one
        // exists, so this branch covers both id-spaces.
        await recordDocumentPayment(document.id, paymentAmount, paymentMethod, notes || undefined, paymentDate);
      } else {
        await recordPayment(invoice.id, paymentAmount, paymentMethod, notes || undefined, paymentDate);
      }

      // Also push payment to Xero if connected and invoice is synced
      if (xeroConnection && invoice.xeroInvoiceId) {
        try {
          await pushPaymentToXero(invoice.id, invoice.xeroInvoiceId, paymentAmount, paymentDate, paymentMethod);
        } catch (xeroError) {
        }
      }

      showAlert({
        type: 'success',
        title: paymentCopy.paymentRecordedTitle,
        message: `${formatCurrency(paymentAmount)} recorded against this invoice.`,
        primaryButtonText: 'Done',
        primaryButtonAction: dismiss,
      });
    } catch (error) {
      showAlert({
        type: 'error',
        title: paymentCopy.paymentErrorTitle,
        message: 'Failed to record payment. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!invoice) {
    return (
      <BottomSheet
        visible={visible}
        onDismiss={dismiss}
        onClosed={handleClosed}
        title={paymentCopy.recordPayment}
      >
        <View style={styles.notFound}>
          <MaterialCommunityIcons
            name="file-question-outline"
            size={32}
            color={themeColors.textMuted}
          />
          <Text style={styles.notFoundText}>
            We couldn't find this invoice on this device.
          </Text>
        </View>
        <Button mode="text" onPress={dismiss}>
          {paymentCopy.close}
        </Button>
        {alertNode}
      </BottomSheet>
    );
  }

  const dateOptions = [
    { label: 'Today', date: new Date() },
    { label: 'Yesterday', date: subDays(new Date(), 1) },
    { label: '2 days ago', date: subDays(new Date(), 2) },
    { label: '1 week ago', date: subDays(new Date(), 7) },
  ];

  return (
    <BottomSheet
      visible={visible}
      onDismiss={dismiss}
      onClosed={handleClosed}
      title={editingPaymentId ? 'Edit Payment' : paymentCopy.recordPayment}
      subtitle={`Invoice ${invoice.invoiceNumber || 'Draft'}${customerName ? ` · ${customerName}` : ''}`}
      scrollable
      maxHeightRatio={0.9}
    >
      {/* Total / paid / balance at a glance — same grammar as PaymentSheet,
          so the sheet answers "how much is left?" before asking anything. */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCell}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={styles.summaryValue}>{formatCurrency(invoice.total)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCell}>
          <Text style={styles.summaryLabel}>Paid</Text>
          <Text
            style={[
              styles.summaryValue,
              (invoice.paidAmount || 0) > 0 && { color: themeColors.money },
            ]}
          >
            {formatCurrency(invoice.paidAmount || 0)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCell}>
          <Text style={styles.summaryLabel}>Balance due</Text>
          <Text style={[styles.summaryValue, styles.summaryValueDue]}>
            {formatCurrency(amountDue)}
          </Text>
        </View>
      </View>
      {invoice.squarePaymentId ? (
        <View style={styles.squareNoteRow}>
          <MaterialCommunityIcons
            name="credit-card-check-outline"
            size={14}
            color={themeColors.textMuted}
          />
          <Text style={styles.squareNoteText}>
            Paid via Square
            {invoice.squarePaidAt
              ? ` on ${format(new Date(invoice.squarePaidAt as any), 'd MMM yyyy')}`
              : ''}
          </Text>
        </View>
      ) : null}

      {/* Amount */}
      <Text style={styles.fieldLabel}>Amount</Text>
      <CurrencyInput
        variant="field"
        value={amount}
        onCommit={setAmount}
        accessibilityLabel="Payment amount"
      />
      <View style={styles.chipRow}>
        <Chip
          label="Full balance"
          onPress={() => setAmount(Math.round(amountDue * 100) / 100)}
        />
        {amountDue >= 100 && (
          <Chip
            label="50%"
            onPress={() => setAmount(Math.round((amountDue / 2) * 100) / 100)}
          />
        )}
      </View>

      {/* Method */}
      <Text style={styles.fieldLabel}>How was it paid?</Text>
      <View style={styles.chipRow}>
        {PAYMENT_METHODS.map((method) => (
          <Chip
            key={method.value}
            label={method.label}
            active={paymentMethod === method.value}
            onPress={() => setPaymentMethod(method.value)}
          />
        ))}
      </View>

      {/* Date */}
      <Text style={styles.fieldLabel}>When?</Text>
      <Text style={styles.dateText}>
        {format(paymentDate, 'EEE d MMM yyyy')}
        {isToday(paymentDate)
          ? ' (Today)'
          : isYesterday(paymentDate)
            ? ' (Yesterday)'
            : ''}
      </Text>
      <View style={styles.chipRow}>
        {dateOptions.map((option) => (
          <Chip
            key={option.label}
            label={option.label}
            active={isSameDay(paymentDate, option.date)}
            onPress={() => setPaymentDate(option.date)}
          />
        ))}
        <Chip
          label="Pick a date"
          active={!dateOptions.some((o) => isSameDay(paymentDate, o.date))}
          onPress={() => setDateSheetVisible(true)}
        />
      </View>

      {/* Notes */}
      <Text style={styles.fieldLabel}>Notes (optional)</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        mode="outlined"
        dense
        style={styles.notesInput}
        multiline
        numberOfLines={2}
        placeholder="e.g., Transaction ID, reference number..."
        accessibilityLabel="Payment notes"
      />

      <Button
        mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent}
        onPress={handleRecordPayment}
        style={styles.submitButton}
        loading={isSubmitting}
        disabled={isSubmitting}
        icon="check"
      >
        {editingPaymentId ? 'Save Changes' : paymentCopy.recordPayment}
      </Button>

      {editingPaymentId ? (
        <Button
          mode="text"
          textColor={themeColors.error}
          onPress={handleDelete}
          disabled={isSubmitting}
          icon="trash-can-outline"
          style={styles.deleteButton}
        >
          Remove this payment
        </Button>
      ) : null}

      {/* Explicit way out — with the keyboard up the sheet translates past
          the top of the screen and the backdrop can't be tapped at all. */}
      <Button mode="text" onPress={dismiss} disabled={isSubmitting}>
        {paymentCopy.cancel}
      </Button>

      {/* Portal-hosted, so position in the tree only sets mount order —
          after the sheet, which puts these on top (ScheduleJobSheet's
          in-sheet prompt is the precedent). */}
      <DueDateSheet
        visible={dateSheetVisible}
        onDismiss={() => setDateSheetVisible(false)}
        value={paymentDate.getTime()}
        onChange={(next) => {
          // Clear = back to today. A future-dated payment reads as corrupt
          // data in reports, so clamp forward picks to today too.
          const picked = next ? new Date(next) : new Date();
          setPaymentDate(picked.getTime() > Date.now() ? new Date() : picked);
        }}
        title="Payment date"
        clearLabel="Reset to today"
      />
      {alertNode}
    </BottomSheet>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      // react-native-web drops accessibilityState.selected on buttons;
      // the explicit alias reaches the DOM (and assistive tech) on web.
      aria-selected={!!active}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && !active && { opacity: 0.85 },
      ]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaceOverlay,
    borderRadius: 12,
    padding: 16,
    ...t.elevation[1],
  },
  summaryCell: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: t.colors.border,
  },
  summaryLabel: {
    fontSize: 12,
    color: t.colors.textSecondary,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text,
  },
  summaryValueDue: {
    color: t.colors.money,
    fontSize: 18,
  },
  squareNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginLeft: 2,
  },
  squareNoteText: {
    fontSize: 12,
    color: t.colors.textMuted,
    fontStyle: 'italic',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.textSecondary,
    marginTop: 18,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    // 10 matches PillToggle and keeps the tap target near the 44pt guideline
    // for gloved on-site thumbs.
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceOverlay,
  },
  chipActive: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.text,
  },
  chipLabelActive: {
    color: t.colors.onAccent,
  },
  dateText: {
    fontSize: 15,
    fontWeight: '500',
    color: t.colors.text,
  },
  notesInput: {
    backgroundColor: t.colors.surfaceRaised,
  },
  submitButton: {
    marginTop: 20,
  },
  deleteButton: {
    marginTop: 4,
  },
  notFound: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  notFoundText: {
    fontSize: 14,
    color: t.colors.textSecondary,
    textAlign: 'center',
  },
}));
