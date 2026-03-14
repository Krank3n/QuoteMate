/**
 * View Invoice Screen
 * Full screen view for viewing and managing invoices
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Platform, Alert } from 'react-native';
import {
  Text,
  Button,
  Surface,
  Title,
  Chip,
  TextInput,
  Menu,
} from 'react-native-paper';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';

import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { SendInvoiceButton } from '../components/SendInvoiceButton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  formatPaymentTerms,
  calculateDueDate,
  getAmountDue,
  isInvoiceOverdue,
} from '../utils/invoiceCalculator';
import { Invoice, PaymentMethod } from '../types';
import {
  DocumentHeader,
  CustomerSection,
  JobSection,
  MaterialsSection,
  LaborSection,
  TotalsSection,
  documentStyles,
} from '../components/document';
import { WebContainer } from '../components/WebContainer';

function formatPaymentMethod(method: PaymentMethod): string {
  const methods: Record<PaymentMethod, string> = {
    bank_transfer: 'Bank Transfer',
    card: 'Card',
    cash: 'Cash',
    cheque: 'Cheque',
    other: 'Other',
  };
  return methods[method] || method;
}

export function ViewInvoiceScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const invoiceId = route.params?.invoiceId;
  const isNew = route.params?.isNew;

  const {
    invoices,
    currentInvoice,
    businessSettings,
    saveInvoice,
    setCurrentInvoice,
    updateInvoice,
  } = useStore();
  const insets = useSafeAreaInsets();

  const [displayInvoice, setDisplayInvoice] = useState<Invoice | null>(null);
  const [isEditing, setIsEditing] = useState(isNew || false);
  const [paymentTermsMenuVisible, setPaymentTermsMenuVisible] = useState(false);

  // Load invoice data
  useEffect(() => {
    if (isNew && currentInvoice) {
      setDisplayInvoice(currentInvoice);
      setIsEditing(true);
    } else if (invoiceId) {
      const savedInvoice = invoices.find((i) => i.id === invoiceId);
      if (savedInvoice) {
        setDisplayInvoice(savedInvoice);
      }
    }
  }, [invoiceId, invoices, currentInvoice, isNew]);

  // Refresh invoice data when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      if (!isNew && invoiceId) {
        const savedInvoice = invoices.find((i) => i.id === invoiceId);
        if (savedInvoice) {
          setDisplayInvoice(savedInvoice);
        }
      }
    }, [invoices, invoiceId, isNew])
  );

  const handleSave = async () => {
    if (!displayInvoice) return;

    try {
      await saveInvoice(displayInvoice);
      setIsEditing(false);
      setCurrentInvoice(null);
      Alert.alert('Success', 'Invoice saved successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to save invoice. Please try again.');
    }
  };

  const handleFieldChange = (field: keyof Invoice, value: any) => {
    if (!displayInvoice) return;

    let updatedInvoice = { ...displayInvoice, [field]: value };

    // Recalculate due date if payment terms changed
    if (field === 'paymentTerms') {
      updatedInvoice.dueDate = calculateDueDate(
        displayInvoice.issueDate,
        value,
        displayInvoice.customPaymentDays
      );
    }

    setDisplayInvoice(updatedInvoice);
    if (currentInvoice) {
      updateInvoice(updatedInvoice);
    }
  };

  const handleEditSection = (section: 'materials' | 'labor') => {
    setCurrentInvoice(displayInvoice);
    const screenMap = {
      materials: 'MaterialsList',
      labor: 'LaborMarkup',
    };
    navigation.navigate('NewInvoice', { screen: screenMap[section] });
  };

  if (!displayInvoice) {
    return (
      <View style={styles.container}>
        <Text>Invoice not found</Text>
      </View>
    );
  }

  const invoice = displayInvoice;
  const amountDue = getAmountDue(invoice);
  const isOverdue = isInvoiceOverdue(invoice);

  return (
    <View style={styles.container}>
      <DocumentHeader
        title={`Invoice ${isEditing ? '(Editing)' : 'Preview'}`}
        subtitle={invoice.invoiceNumber}
        onBackPress={() => {
          setCurrentInvoice(null);
          navigation.goBack();
        }}
        rightIcon={isEditing ? 'check' : 'pencil'}
        onRightPress={() => {
          if (isEditing) {
            handleSave();
          } else {
            setIsEditing(true);
          }
        }}
      />

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        <WebContainer>
        {/* Status Section */}
        <Surface style={documentStyles.section}>
          <View style={documentStyles.sectionHeader}>
            <Title style={documentStyles.sectionTitle}>Status</Title>
          </View>
          <View style={styles.statusRow}>
            <Chip
              style={[styles.statusChip, getStatusChipStyle(invoice.status)]}
              textStyle={styles.statusChipText}
            >
              {invoice.status}
            </Chip>
            {isOverdue && invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
              <Chip
                style={[styles.statusChip, { backgroundColor: colors.errorBg }]}
                textStyle={styles.statusChipText}
              >
                Overdue
              </Chip>
            )}
          </View>
          {invoice.paidAmount !== undefined && invoice.paidAmount > 0 && (
            <View style={styles.paymentInfo}>
              <Text style={styles.paymentLabel}>Paid: {formatCurrency(invoice.paidAmount)}</Text>
              <Text style={styles.paymentLabel}>Balance: {formatCurrency(amountDue)}</Text>
            </View>
          )}
        </Surface>

        <CustomerSection
          customerName={invoice.customerName}
          customerEmail={invoice.customerEmail}
          customerPhone={invoice.customerPhone}
          jobAddress={invoice.jobAddress}
          isEditing={isEditing}
          onFieldChange={(field, value) => handleFieldChange(field as keyof Invoice, value)}
        />

        {/* Dates Section */}
        <Surface style={documentStyles.section}>
          <View style={documentStyles.sectionHeader}>
            <Title style={documentStyles.sectionTitle}>Invoice Details</Title>
          </View>
          {isEditing ? (
            <TextInput
              label="Invoice Number"
              value={invoice.invoiceNumber || ''}
              onChangeText={(text) => handleFieldChange('invoiceNumber', text)}
              mode="outlined"
              style={styles.invoiceNumberInput}
              placeholder="e.g. INV-001"
            />
          ) : invoice.invoiceNumber ? (
            <View style={styles.invoiceNumberRow}>
              <Text style={styles.dateLabel}>Invoice #</Text>
              <Text style={styles.dateValue}>{invoice.invoiceNumber}</Text>
            </View>
          ) : null}
          <View style={styles.dateRow}>
            <View style={styles.dateItem}>
              <Text style={styles.dateLabel}>Issue Date</Text>
              <Text style={styles.dateValue}>
                {format(new Date(invoice.issueDate), 'dd MMM yyyy')}
              </Text>
            </View>
            <View style={styles.dateItem}>
              <Text style={styles.dateLabel}>Due Date</Text>
              <Text style={[styles.dateValue, isOverdue && styles.overdueDate]}>
                {format(new Date(invoice.dueDate), 'dd MMM yyyy')}
              </Text>
            </View>
          </View>
          <View style={styles.paymentTermsRow}>
            <Text style={styles.dateLabel}>Payment Terms</Text>
            {isEditing ? (
              <>
                <Menu
                  visible={paymentTermsMenuVisible}
                  onDismiss={() => setPaymentTermsMenuVisible(false)}
                  anchor={
                    <Button
                      mode="outlined"
                      onPress={() => setPaymentTermsMenuVisible(true)}
                      style={styles.termsButton}
                    >
                      {formatPaymentTerms(invoice.paymentTerms, invoice.customPaymentDays)}
                    </Button>
                  }
                >
                  <Menu.Item
                    onPress={() => {
                      handleFieldChange('paymentTerms', 'due_on_receipt');
                      setPaymentTermsMenuVisible(false);
                    }}
                    title="Due on Receipt"
                  />
                  <Menu.Item
                    onPress={() => {
                      handleFieldChange('paymentTerms', 'net_7');
                      setPaymentTermsMenuVisible(false);
                    }}
                    title="Net 7 Days"
                  />
                  <Menu.Item
                    onPress={() => {
                      handleFieldChange('paymentTerms', 'net_14');
                      setPaymentTermsMenuVisible(false);
                    }}
                    title="Net 14 Days"
                  />
                  <Menu.Item
                    onPress={() => {
                      handleFieldChange('paymentTerms', 'net_30');
                      setPaymentTermsMenuVisible(false);
                    }}
                    title="Net 30 Days"
                  />
                  <Menu.Item
                    onPress={() => {
                      handleFieldChange('paymentTerms', 'custom');
                      setPaymentTermsMenuVisible(false);
                    }}
                    title="Custom"
                  />
                </Menu>
                {invoice.paymentTerms === 'custom' && (
                  <TextInput
                    label="Custom Days"
                    value={invoice.customPaymentDays?.toString() || ''}
                    onChangeText={(text) => {
                      const days = parseInt(text) || 0;
                      const newDueDate = calculateDueDate(invoice.issueDate, 'custom', days);
                      setDisplayInvoice({
                        ...invoice,
                        customPaymentDays: days,
                        dueDate: newDueDate,
                      });
                      if (currentInvoice) {
                        updateInvoice({
                          ...invoice,
                          customPaymentDays: days,
                          dueDate: newDueDate,
                        });
                      }
                    }}
                    mode="outlined"
                    keyboardType="number-pad"
                    style={styles.customDaysInput}
                    right={<TextInput.Affix text="days" />}
                  />
                )}
              </>
            ) : (
              <Text style={styles.dateValue}>
                {formatPaymentTerms(invoice.paymentTerms, invoice.customPaymentDays)}
              </Text>
            )}
          </View>
        </Surface>

        <JobSection
          job={invoice.job}
          isEditing={isEditing}
          onJobChange={(job) => handleFieldChange('job', job)}
        />

        <MaterialsSection
          materials={invoice.materials}
          materialsSubtotal={invoice.materialsSubtotal}
          onEdit={() => handleEditSection('materials')}
          emptyMessage="No materials - Labor only"
        />

        <LaborSection
          laborHours={invoice.laborHours}
          laborRate={invoice.laborRate}
          laborTotal={invoice.laborTotal}
          showLaborHours={businessSettings?.showLaborHours}
          onEdit={() => handleEditSection('labor')}
        />

        <TotalsSection
          subtotal={invoice.subtotal}
          markup={invoice.markup}
          markupAmount={invoice.markupAmount}
          gst={invoice.gst}
          total={invoice.total}
          paidAmount={invoice.paidAmount}
          balanceDue={amountDue}
        />

        {/* Notes Section */}
        {(invoice.notes || isEditing) && (
          <Surface style={documentStyles.section}>
            <Title style={documentStyles.sectionTitle}>Notes</Title>
            {isEditing ? (
              <TextInput
                value={invoice.notes || ''}
                onChangeText={(text) => handleFieldChange('notes', text)}
                style={styles.input}
                mode="outlined"
                multiline
                numberOfLines={3}
              />
            ) : (
              <Text style={documentStyles.text}>{invoice.notes}</Text>
            )}
          </Surface>
        )}

        {/* Payment History Section */}
        {invoice.paidAmount !== undefined && invoice.paidAmount > 0 && (
          <Surface style={documentStyles.section}>
            <Title style={documentStyles.sectionTitle}>Payment History</Title>
            <View style={styles.paymentHistoryRow}>
              <View style={styles.paymentHistoryInfo}>
                <Text style={styles.paymentHistoryMethod}>
                  {invoice.paymentMethod ? formatPaymentMethod(invoice.paymentMethod) : 'Payment'}
                </Text>
                {invoice.paidDate && (
                  <Text style={styles.paymentHistoryDate}>
                    {format(new Date(invoice.paidDate), 'dd MMM yyyy')}
                  </Text>
                )}
                {invoice.paymentNotes && (
                  <Text style={styles.paymentHistoryNotes}>{invoice.paymentNotes}</Text>
                )}
              </View>
              <Text style={styles.paymentHistoryAmount}>
                {formatCurrency(invoice.paidAmount)}
              </Text>
            </View>
          </Surface>
        )}
        </WebContainer>
      </ScrollView>

      {/* Fixed bottom section */}
      {Platform.OS !== 'ios' && <View style={styles.solidBackground} />}

      <View
        style={[
          styles.actions,
          { paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        {amountDue > 0 && invoice.status !== 'cancelled' && (
          <Button
            mode="outlined"
            onPress={() =>
              navigation.navigate('RecordPayment' as never, { invoiceId: invoice.id } as never)
            }
            style={styles.button}
            contentStyle={styles.buttonContent}
            icon="cash"
          >
            Record Payment
          </Button>
        )}
        <SendInvoiceButton
          invoice={invoice}
          businessSettings={businessSettings}
          buttonStyle={styles.button}
        />
      </View>
    </View>
  );
}

function getStatusChipStyle(status: Invoice['status']) {
  switch (status) {
    case 'paid':
      return { backgroundColor: colors.successBg };
    case 'sent':
      return { backgroundColor: colors.warningBg };
    case 'partial':
      return { backgroundColor: colors.infoBg };
    case 'overdue':
      return { backgroundColor: colors.errorBg };
    case 'cancelled':
      return { backgroundColor: colors.errorBg };
    default:
      return { backgroundColor: colors.infoBg };
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  scrollContent: {
    paddingBottom: 140,
  },
  input: {
    marginBottom: 12,
    backgroundColor: colors.surface,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusChip: {
    height: 24,
  },
  statusChipText: {
    fontSize: 12,
    textTransform: 'capitalize',
    marginVertical: 0,
    lineHeight: 24,
  },
  paymentInfo: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  paymentLabel: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 4,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  dateItem: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 4,
  },
  dateValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  overdueDate: {
    color: colors.error,
  },
  paymentTermsRow: {
    marginTop: 8,
  },
  invoiceNumberInput: {
    marginBottom: 12,
    backgroundColor: colors.surface,
  },
  invoiceNumberRow: {
    marginBottom: 12,
  },
  termsButton: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  customDaysInput: {
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: colors.surface,
    maxWidth: 150,
  },
  solidBackground: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: colors.surface,
    zIndex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    position: 'absolute',
    bottom: 0,
    width: '100%',
    zIndex: 2,
    ...Platform.select({
      android: {
        elevation: 8,
      },
      web: {
        flexShrink: 0,
        position: 'sticky' as any,
        bottom: 0,
        boxShadow: '0 -2px 8px rgba(0,0,0,0.1)' as any,
      },
    }),
  },
  button: {
    flex: 1,
    margin: 0,
  },
  buttonContent: {
    paddingVertical: 8,
  },
  paymentHistoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  paymentHistoryInfo: {
    flex: 1,
  },
  paymentHistoryMethod: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.success,
    marginBottom: 2,
  },
  paymentHistoryDate: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 2,
  },
  paymentHistoryNotes: {
    fontSize: 12,
    color: colors.onSurface,
    fontStyle: 'italic',
  },
  paymentHistoryAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.success,
  },
});
