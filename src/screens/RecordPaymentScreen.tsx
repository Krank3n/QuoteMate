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

  const { invoices, currentInvoice, recordPayment } = useStore();

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

    if (paymentAmount > amountDue) {
      Alert.alert(
        'Amount Exceeds Balance',
        `The payment amount ($${paymentAmount.toFixed(2)}) exceeds the balance due ($${amountDue.toFixed(2)}). Do you want to continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Continue',
            onPress: () => submitPayment(paymentAmount),
          },
        ]
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
        <Title style={styles.summaryTitle}>Invoice Summary</Title>
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
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Already Paid</Text>
            <Text style={[styles.summaryValue, { color: colors.success }]}>
              {formatCurrency(invoice.paidAmount || 0)}
            </Text>
          </View>
        )}
        <View style={[styles.summaryRow, styles.balanceRow]}>
          <Text style={styles.balanceLabel}>Balance Due</Text>
          <Text style={styles.balanceValue}>{formatCurrency(amountDue)}</Text>
        </View>
      </Surface>

      {/* Payment Amount */}
      <Surface style={styles.section}>
        <Title style={styles.sectionTitle}>Payment Amount</Title>
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
        <Title style={styles.sectionTitle}>Payment Method</Title>
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
        <Title style={styles.sectionTitle}>Payment Date</Title>
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
        <Title style={styles.sectionTitle}>Notes (Optional)</Title>
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
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: colors.surfaceGray,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
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
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
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
    borderRadius: 4,
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
