/**
 * View Invoice Screen
 * Full screen view for viewing and managing invoices
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Platform, TouchableOpacity, Alert } from 'react-native';
import {
  Text,
  Button,
  Surface,
  Title,
  Divider,
  IconButton,
  Chip,
  TextInput,
  Menu,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
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
import { Invoice, PaymentTerms, PaymentMethod } from '../types';

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
    // Set the invoice as current invoice for editing
    setCurrentInvoice(displayInvoice);

    // Navigate to the specific screen in the NewInvoice flow
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
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          size={24}
          onPress={() => {
            setCurrentInvoice(null);
            navigation.goBack();
          }}
        />
        <View style={styles.headerTitleContainer}>
          <Title>Invoice {isEditing ? '(Editing)' : 'Preview'}</Title>
          {invoice.invoiceNumber && (
            <Text style={styles.headerInvoiceNumber}>{invoice.invoiceNumber}</Text>
          )}
        </View>
        <IconButton
          icon={isEditing ? 'check' : 'pencil'}
          size={24}
          onPress={() => {
            if (isEditing) {
              handleSave();
            } else {
              setIsEditing(true);
            }
          }}
        />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        {/* Status Section */}
        <Surface style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title style={styles.sectionTitle}>Status</Title>
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

        {/* Customer Section */}
        <Surface style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title style={styles.sectionTitle}>Customer</Title>
          </View>
          {isEditing ? (
            <>
              <TextInput
                label="Customer Name"
                value={invoice.customerName}
                onChangeText={(text) => handleFieldChange('customerName', text)}
                style={styles.input}
                mode="outlined"
              />
              <TextInput
                label="Email"
                value={invoice.customerEmail || ''}
                onChangeText={(text) => handleFieldChange('customerEmail', text)}
                style={styles.input}
                mode="outlined"
                keyboardType="email-address"
              />
              <TextInput
                label="Phone"
                value={invoice.customerPhone || ''}
                onChangeText={(text) => handleFieldChange('customerPhone', text)}
                style={styles.input}
                mode="outlined"
                keyboardType="phone-pad"
              />
              <TextInput
                label="Job Address"
                value={invoice.jobAddress || ''}
                onChangeText={(text) => handleFieldChange('jobAddress', text)}
                style={styles.input}
                mode="outlined"
                multiline
              />
            </>
          ) : (
            <>
              <Text style={styles.text}>{invoice.customerName}</Text>
              {invoice.customerEmail && <Text style={styles.subtext}>{invoice.customerEmail}</Text>}
              {invoice.customerPhone && <Text style={styles.subtext}>{invoice.customerPhone}</Text>}
              {invoice.jobAddress && <Text style={styles.subtext}>{invoice.jobAddress}</Text>}
            </>
          )}
        </Surface>

        {/* Dates Section */}
        <Surface style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title style={styles.sectionTitle}>Invoice Details</Title>
          </View>
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

        {/* Job Section */}
        <Surface style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title style={styles.sectionTitle}>Job</Title>
          </View>
          {isEditing ? (
            <>
              <TextInput
                label="Job Name"
                value={invoice.job.name}
                onChangeText={(text) =>
                  handleFieldChange('job', { ...invoice.job, name: text })
                }
                style={styles.input}
                mode="outlined"
              />
              <TextInput
                label="Description"
                value={invoice.job.description}
                onChangeText={(text) =>
                  handleFieldChange('job', { ...invoice.job, description: text })
                }
                style={styles.input}
                mode="outlined"
                multiline
              />
            </>
          ) : (
            <>
              <Text style={styles.text}>{invoice.job.name}</Text>
              <Text style={styles.subtext}>{invoice.job.description}</Text>
            </>
          )}
        </Surface>

        {/* Materials Section */}
        <TouchableOpacity onPress={() => handleEditSection('materials')} activeOpacity={0.7}>
          <Surface style={styles.section}>
            <View style={styles.sectionHeader}>
              <Title style={styles.sectionTitle}>Materials ({invoice.materials.length})</Title>
              <IconButton icon="pencil" size={18} iconColor={colors.primary} style={styles.editIcon} />
            </View>
            {invoice.materials.length === 0 ? (
              <Text style={styles.subtext}>No materials - Labor only</Text>
            ) : (
              invoice.materials.map((material) => (
                <View key={material.id} style={styles.itemRow}>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemName}>{material.name}</Text>
                    <Text style={styles.itemDetails}>
                      {material.quantity} {material.unit} × {formatCurrency(material.price)}
                    </Text>
                  </View>
                  <Text style={styles.itemTotal}>{formatCurrency(material.totalPrice)}</Text>
                </View>
              ))
            )}
            <Divider style={styles.divider} />
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Materials Subtotal</Text>
              <Text style={styles.summaryValue}>{formatCurrency(invoice.materialsSubtotal)}</Text>
            </View>
          </Surface>
        </TouchableOpacity>

        {/* Labor Section */}
        <TouchableOpacity onPress={() => handleEditSection('labor')} activeOpacity={0.7}>
          <Surface style={styles.section}>
            <View style={styles.sectionHeader}>
              <Title style={styles.sectionTitle}>Labor</Title>
              <IconButton icon="pencil" size={18} iconColor={colors.primary} style={styles.editIcon} />
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.text}>
                {businessSettings?.showLaborHours
                  ? `${invoice.laborHours} hours @ ${formatCurrency(invoice.laborRate)}/hr`
                  : 'Labor'}
              </Text>
              <Text style={styles.summaryValue}>{formatCurrency(invoice.laborTotal)}</Text>
            </View>
          </Surface>
        </TouchableOpacity>

        {/* Totals Section */}
        <Surface style={styles.totalSection}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>{formatCurrency(invoice.subtotal)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Markup ({invoice.markup}%)</Text>
            <Text style={styles.summaryValue}>{formatCurrency(invoice.markupAmount)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>GST (10%)</Text>
            <Text style={styles.summaryValue}>{formatCurrency(invoice.gst)}</Text>
          </View>
          <Divider style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>{formatCurrency(invoice.total)}</Text>
          </View>
          {invoice.paidAmount !== undefined && invoice.paidAmount > 0 && (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Amount Paid</Text>
                <Text style={[styles.summaryValue, { color: colors.success }]}>
                  -{formatCurrency(invoice.paidAmount)}
                </Text>
              </View>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>BALANCE DUE</Text>
                <Text style={styles.balanceValue}>{formatCurrency(amountDue)}</Text>
              </View>
            </>
          )}
        </Surface>

        {/* Notes Section */}
        {(invoice.notes || isEditing) && (
          <Surface style={styles.section}>
            <Title style={styles.sectionTitle}>Notes</Title>
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
              <Text style={styles.text}>{invoice.notes}</Text>
            )}
          </Surface>
        )}

        {/* Payment History Section */}
        {invoice.paidAmount !== undefined && invoice.paidAmount > 0 && (
          <Surface style={styles.section}>
            <Title style={styles.sectionTitle}>Payment History</Title>
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
      </ScrollView>

      {/* Fixed bottom section */}
      {Platform.OS !== 'ios' && <View style={styles.solidBackground} />}

      <View
        style={[
          styles.actions,
          Platform.OS !== 'ios' && { marginBottom: Math.max(insets.bottom, 16) },
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleContainer: {
    alignItems: 'center',
  },
  headerInvoiceNumber: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  scrollContent: {
    paddingBottom: 140,
  },
  section: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  editIcon: {
    margin: 0,
  },
  text: {
    fontSize: 14,
    marginBottom: 4,
  },
  subtext: {
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 2,
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
  termsButton: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  customDaysInput: {
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: colors.surface,
    maxWidth: 150,
    marginTop: 4,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  itemDetails: {
    fontSize: 12,
    color: colors.onSurface,
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    marginVertical: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalSection: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 3,
    backgroundColor: colors.surfaceGray,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  balanceLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.warning,
  },
  balanceValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.warning,
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
