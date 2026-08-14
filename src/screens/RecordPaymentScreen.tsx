/**
 * Record Payment Screen
 * Modal screen for recording payments on invoices
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform, TouchableOpacity } from 'react-native';
import {
  Text,
  Button,
  Surface,
  TextInput,
  RadioButton,
  Title,
  Menu,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { format, subDays, isToday, isYesterday } from 'date-fns';

import { useStore, PAYMENT_METHOD_TO_LEDGER } from '../store/useStore';
import { maxAmountForEdit } from '../utils/editablePayment';
import { PaymentMethod } from '../types';
import { makeStyles, useThemeColors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { getAmountDue } from '../utils/invoiceCalculator';
import { GridBackground } from '../components/GridBackground';
import { WebContainer } from '../components/WebContainer';

/**
 * Ledger method → the radio option that represents it. Lossy on purpose:
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
  { value: 'bank_transfer', label: 'Bank Transfer' },
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

  const [amount, setAmount] = useState(
    editingPayment ? (Number(editingPayment.amount) || 0).toFixed(2) : amountDue.toFixed(2),
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    LEDGER_METHOD_TO_FORM[editingPayment?.method ?? ''] ?? 'bank_transfer',
  );
  const [notes, setNotes] = useState(editingPayment?.notes ?? '');
  const [paymentDate, setPaymentDate] = useState(
    editingPayment?.paidAt ? new Date(editingPayment.paidAt) : new Date(),
  );
  const [dateMenuVisible, setDateMenuVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Don't stomp the value being edited when the doc reloads.
    if (invoice && !editingPayment) {
      setAmount(amountDue.toFixed(2));
    }
  }, [invoice, amountDue, editingPayment]);

  const handleRecordPayment = async () => {
    if (!invoice) return;

    const paymentAmount = parseFloat(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount.');
      return;
    }

    // Hard-reject overpayment. Allow a 1c tolerance for rounding (e.g., when
    // a Square webhook records $50.001 and the tradie tries to close the
    // remaining cent via cash).
    if (paymentAmount > ceiling + 0.01) {
      Alert.alert(
        'Amount exceeds balance',
        `Enter up to ${formatCurrency(ceiling)}. This invoice doesn't owe more than that.`,
      );
      return;
    }

    await submitPayment(paymentAmount);
  };

  const handleDelete = () => {
    if (!editingPaymentId || !document) return;
    Alert.alert(
      'Remove this payment?',
      'The invoice balance goes back up by this amount.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setIsSubmitting(true);
            try {
              await deleteDocumentPayment(document.id, editingPaymentId);
              navigation.goBack();
            } catch (err: any) {
              Alert.alert('Couldn’t remove it', err?.message || 'Please try again.');
            } finally {
              setIsSubmitting(false);
            }
          },
        },
      ],
    );
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
        Alert.alert('Saved', 'Payment updated.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
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

      Alert.alert('Success', 'Payment recorded successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to record payment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!invoice) {
    return (
      <View style={styles.container}>
      <GridBackground />
        <Text>Invoice not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* This is a `presentation: 'modal'` screen, and on web that modal is
          as wide as the browser — a payment form with a $ field and four
          radios stretched across a 27" display. 600 matches the other
          payment surfaces (TakePaymentSheet, StripeCheckoutModal). No-op on
          native. */}
      <WebContainer maxWidth={600}>
      {/* Invoice Summary */}
      <Surface style={styles.summaryCard}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionIconCircle, { backgroundColor: themeColors.accentSubtle }]}>
            <MaterialCommunityIcons name="file-document-outline" size={18} color={themeColors.accentText} />
          </View>
          <Title style={styles.sectionTitle}>Invoice Summary</Title>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Invoice</Text>
          <Text style={styles.summaryValue}>{invoice.invoiceNumber || 'Draft'}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Customer</Text>
          <Text style={styles.summaryValue}>{invoice.customerName}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={styles.summaryValue}>{formatCurrency(invoice.total)}</Text>
        </View>
        {(invoice.paidAmount || 0) > 0 && (
          <>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Already Paid</Text>
              <Text style={[styles.summaryValue, { color: themeColors.money }]}>
                {formatCurrency(invoice.paidAmount || 0)}
              </Text>
            </View>
            {invoice.squarePaymentId && (
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
            )}
          </>
        )}
        <View style={[styles.summaryRow, styles.balanceRow]}>
          <Text style={styles.balanceLabel}>Balance Due</Text>
          <Text style={styles.balanceValue}>{formatCurrency(amountDue)}</Text>
        </View>
      </Surface>

      {/* Payment Amount */}
      <Surface style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionIconCircle, { backgroundColor: themeColors.accentSubtle }]}>
            <MaterialCommunityIcons name="cash" size={18} color={themeColors.accentText} />
          </View>
          <Title style={styles.sectionTitle}>Payment Amount</Title>
        </View>
        <TextInput
          label="Amount"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          mode="outlined"
          style={styles.input}
          left={<TextInput.Affix text="$" />}
        />
        <View style={styles.quickAmounts}>
          <Button
            mode="outlined"
            onPress={() => setAmount(amountDue.toFixed(2))}
            style={styles.quickButton}
            compact
          >
            Full Balance
          </Button>
          {amountDue >= 100 && (
            <Button
              mode="outlined"
              onPress={() => setAmount((amountDue / 2).toFixed(2))}
              style={styles.quickButton}
              compact
            >
              50%
            </Button>
          )}
        </View>
      </Surface>

      {/* Payment Method */}
      <Surface style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionIconCircle, { backgroundColor: themeColors.infoSubtle }]}>
            <MaterialCommunityIcons name="credit-card-outline" size={18} color={themeColors.info} />
          </View>
          <Title style={styles.sectionTitle}>Payment Method</Title>
        </View>
        <RadioButton.Group
          onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}
          value={paymentMethod}
        >
          {PAYMENT_METHODS.map((method) => (
            <RadioButton.Item
              key={method.value}
              label={method.label}
              value={method.value}
              style={styles.radioItem}
              labelStyle={styles.radioLabel}
            />
          ))}
        </RadioButton.Group>
      </Surface>

      {/* Payment Date */}
      <Surface style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionIconCircle, { backgroundColor: themeColors.moneySubtle }]}>
            <MaterialCommunityIcons name="calendar-check" size={18} color={themeColors.money} />
          </View>
          <Title style={styles.sectionTitle}>Payment Date</Title>
        </View>
        <Menu
          visible={dateMenuVisible}
          onDismiss={() => setDateMenuVisible(false)}
          anchor={
            <TouchableOpacity
              style={styles.dateSelector}
              onPress={() => setDateMenuVisible(true)}
            >
              <Text style={styles.dateText}>
                {format(paymentDate, 'dd MMM yyyy')}
              </Text>
              <Text style={styles.dateLabelText}>
                {isToday(paymentDate) ? '(Today)' : isYesterday(paymentDate) ? '(Yesterday)' : ''}
              </Text>
            </TouchableOpacity>
          }
        >
          <Menu.Item
            onPress={() => {
              setPaymentDate(new Date());
              setDateMenuVisible(false);
            }}
            title="Today"
          />
          <Menu.Item
            onPress={() => {
              setPaymentDate(subDays(new Date(), 1));
              setDateMenuVisible(false);
            }}
            title="Yesterday"
          />
          <Menu.Item
            onPress={() => {
              setPaymentDate(subDays(new Date(), 2));
              setDateMenuVisible(false);
            }}
            title="2 days ago"
          />
          <Menu.Item
            onPress={() => {
              setPaymentDate(subDays(new Date(), 7));
              setDateMenuVisible(false);
            }}
            title="1 week ago"
          />
        </Menu>
      </Surface>

      {/* Notes */}
      <Surface style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionIconCircle, { backgroundColor: themeColors.infoSubtle }]}>
            <MaterialCommunityIcons name="note-text-outline" size={18} color={themeColors.info} />
          </View>
          <Title style={styles.sectionTitle}>Notes (Optional)</Title>
        </View>
        <TextInput
          label="Payment notes"
          value={notes}
          onChangeText={setNotes}
          mode="outlined"
          style={styles.input}
          multiline
          numberOfLines={3}
          placeholder="e.g., Transaction ID, reference number..."
        />
      </Surface>

      {/* Submit Button */}
      <Button
        mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent}
        onPress={handleRecordPayment}
        style={styles.submitButton}
        loading={isSubmitting}
        disabled={isSubmitting}
        icon="check"
      >
        {editingPaymentId ? 'Save Changes' : 'Record Payment'}
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
      </WebContainer>
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  summaryCard: {
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    backgroundColor: t.colors.surfaceRaised,
    elevation: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: t.colors.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  squareNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -4,
    marginBottom: 8,
    marginLeft: 2,
  },
  squareNoteText: {
    fontSize: 12,
    color: t.colors.textMuted,
    fontStyle: 'italic',
  },
  balanceRow: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  balanceLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: t.colors.text,
  },
  balanceValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: t.colors.money,
  },
  section: {
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    backgroundColor: t.colors.surfaceRaised,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  sectionIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 0,
    lineHeight: 20,
  },
  input: {
    backgroundColor: t.colors.surfaceRaised,
  },
  quickAmounts: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  quickButton: {
    borderColor: t.colors.accent,
  },
  radioItem: {
    paddingVertical: 4,
  },
  radioLabel: {
    fontSize: 14,
  },
  dateSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 10,
    backgroundColor: t.colors.surfaceRaised,
  },
  dateText: {
    fontSize: 16,
    fontWeight: '500',
    color: t.colors.text,
  },
  dateLabelText: {
    fontSize: 14,
    color: t.colors.textMuted,
    marginLeft: 8,
  },
  submitButton: {
    marginTop: 8,
    paddingVertical: 8,
  },
  deleteButton: {
    marginTop: 4,
  },
}));
