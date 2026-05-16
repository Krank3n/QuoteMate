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

import { useStore } from '../store/useStore';
import { PaymentMethod } from '../types';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { getAmountDue } from '../utils/invoiceCalculator';

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export function RecordPaymentScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const invoiceId = route.params?.invoiceId;

  const invoices = useStore((s) => s.invoices);
  const currentInvoice = useStore((s) => s.currentInvoice);
  const xeroConnection = useStore((s) => s.xeroConnection);
  const recordPayment = useStore((s) => s.recordPayment);
  const pushPaymentToXero = useStore((s) => s.pushPaymentToXero);

  // Check both saved invoices and currentInvoice (for unsaved invoices)
  const invoice = invoices.find((i) => i.id === invoiceId) ||
    (currentInvoice?.id === invoiceId ? currentInvoice : null);
  const amountDue = invoice ? getAmountDue(invoice) : 0;

  const [amount, setAmount] = useState(amountDue.toFixed(2));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank_transfer');
  const [notes, setNotes] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date());
  const [dateMenuVisible, setDateMenuVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (invoice) {
      setAmount(getAmountDue(invoice).toFixed(2));
    }
  }, [invoice]);

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
    if (paymentAmount > amountDue + 0.01) {
      Alert.alert(
        'Amount exceeds balance',
        `Enter up to ${formatCurrency(amountDue)}. This invoice doesn't owe more than that.`,
      );
      return;
    }

    await submitPayment(paymentAmount);
  };

  const submitPayment = async (paymentAmount: number) => {
    if (!invoice) return;

    setIsSubmitting(true);
    try {
      await recordPayment(invoice.id, paymentAmount, paymentMethod, notes || undefined, paymentDate);

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
        <Text>Invoice not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Invoice Summary */}
      <Surface style={styles.summaryCard}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionIconCircle, { backgroundColor: colors.warningBg }]}>
            <MaterialCommunityIcons name="file-document-outline" size={18} color={colors.secondary} />
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
              <Text style={[styles.summaryValue, { color: colors.success }]}>
                {formatCurrency(invoice.paidAmount || 0)}
              </Text>
            </View>
            {invoice.squarePaymentId && (
              <View style={styles.squareNoteRow}>
                <MaterialCommunityIcons
                  name="credit-card-check-outline"
                  size={14}
                  color={colors.textMuted}
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
          <View style={[styles.sectionIconCircle, { backgroundColor: colors.primaryBg }]}>
            <MaterialCommunityIcons name="cash" size={18} color={colors.primary} />
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
          <View style={[styles.sectionIconCircle, { backgroundColor: colors.infoBg }]}>
            <MaterialCommunityIcons name="credit-card-outline" size={18} color={colors.info} />
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
          <View style={[styles.sectionIconCircle, { backgroundColor: colors.successBg }]}>
            <MaterialCommunityIcons name="calendar-check" size={18} color={colors.success} />
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
          <View style={[styles.sectionIconCircle, { backgroundColor: colors.infoBg }]}>
            <MaterialCommunityIcons name="note-text-outline" size={18} color={colors.info} />
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
        mode="contained"
        onPress={handleRecordPayment}
        style={styles.submitButton}
        loading={isSubmitting}
        disabled={isSubmitting}
        icon="check"
      >
        Record Payment
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  summaryCard: {
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    backgroundColor: colors.surface,
    elevation: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: colors.onSurface,
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
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  balanceRow: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  balanceLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.primary,
  },
  balanceValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
  },
  section: {
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    backgroundColor: colors.surface,
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
    backgroundColor: colors.surface,
  },
  quickAmounts: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  quickButton: {
    borderColor: colors.primary,
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
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  dateText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  dateLabelText: {
    fontSize: 14,
    color: colors.textMuted,
    marginLeft: 8,
  },
  submitButton: {
    marginTop: 8,
    paddingVertical: 8,
  },
});
