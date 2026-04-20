/**
 * View Invoice Screen
 * Full screen view for viewing and managing invoices
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Platform, Alert, TouchableOpacity, useWindowDimensions } from 'react-native';
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
import * as Print from 'expo-print';

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { SendInvoiceButton } from '../components/SendInvoiceButton';
import { TakePaymentSheet, TakePaymentTarget } from '../components/TakePaymentSheet';
import { SquareReconnectBanner } from '../components/SquareReconnectBanner';
import { PaymentSyncErrorBanner, DisputeBanner } from '../components/PaymentAlertBanners';
import { AlertModal } from '../components/AlertModal';
import * as squareService from '../services/squareService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  formatPaymentTerms,
  calculateDueDate,
  getAmountDue,
  isInvoiceOverdue,
} from '../utils/invoiceCalculator';
import { Invoice, PaymentMethod } from '../types';
import { documentToInvoice } from '../types/documentAdapter';
import {
  DocumentHeader,
  CustomerSection,
  JobSection,
  MaterialsSection,
  LaborSection,
  TotalsSection,
  documentStyles,
} from '../components/document';
import { useResolvedCustomer } from '../hooks/useResolvedCustomer';
import { WebContainer } from '../components/WebContainer';
import { StatusSheet, INVOICE_STATUS_OPTIONS } from '../components/StatusSheet';

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
    xeroConnection,
    pushInvoiceToXero,
    getDocumentByLegacyId,
  } = useStore();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const compactLabels = windowWidth < 400;

  const [displayInvoice, setDisplayInvoice] = useState<Invoice | null>(null);
  const [isEditing, setIsEditing] = useState(isNew || false);
  const [isEditingJob, setIsEditingJob] = useState(false);
  const [paymentTermsMenuVisible, setPaymentTermsMenuVisible] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [statusSheetVisible, setStatusSheetVisible] = useState(false);
  const [isXeroPushing, setIsXeroPushing] = useState(false);
  const [squareConnected, setSquareConnected] = useState(false);
  const [squareDisconnectedReason, setSquareDisconnectedReason] = useState<string | null>(null);
  const [takePaymentVisible, setTakePaymentVisible] = useState(false);
  const [takePaymentError, setTakePaymentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    squareService
      .checkSquareConnection()
      .then((s) => {
        if (cancelled) return;
        setSquareConnected(!!s.connected);
        setSquareDisconnectedReason(s.disconnectedReason || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Load invoice data — prefer the legacy slice, fall back to the unified
  // documents collection (needed once the legacy collection is empty for a
  // user, or while the documents listener is the only fresh source).
  useEffect(() => {
    if (isNew && currentInvoice) {
      setDisplayInvoice(currentInvoice);
      setIsEditing(true);
    } else if (invoiceId) {
      const savedInvoice = invoices.find((i) => i.id === invoiceId);
      if (savedInvoice) {
        setDisplayInvoice(savedInvoice);
      } else {
        const docMatch = getDocumentByLegacyId(invoiceId);
        if (docMatch) setDisplayInvoice(documentToInvoice(docMatch));
      }
    }
  }, [invoiceId, invoices, currentInvoice, isNew, getDocumentByLegacyId]);

  // Refresh invoice data when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      if (!isNew && invoiceId) {
        const savedInvoice = invoices.find((i) => i.id === invoiceId);
        if (savedInvoice) {
          setDisplayInvoice(savedInvoice);
        } else {
          const docMatch = getDocumentByLegacyId(invoiceId);
          if (docMatch) setDisplayInvoice(documentToInvoice(docMatch));
        }
      }
    }, [invoices, invoiceId, isNew, getDocumentByLegacyId])
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
    navigation.navigate('NewInvoice', { screen: screenMap[section], params: { editing: true } });
  };

  const handleStatusSelect = async (newStatus: string) => {
    if (!displayInvoice) return;
    try {
      const updatedInvoice = {
        ...displayInvoice,
        status: newStatus as Invoice['status'],
        updatedAt: new Date(),
      };
      await saveInvoice(updatedInvoice);
      setDisplayInvoice(updatedInvoice);
    } catch (error) {
      Alert.alert('Error', 'Failed to update invoice status.');
    }
    setStatusSheetVisible(false);
  };

  const handlePushToXero = async () => {
    if (!displayInvoice) return;
    setIsXeroPushing(true);
    try {
      await pushInvoiceToXero(displayInvoice);
      Alert.alert('Synced', 'Invoice pushed to Xero successfully.');
    } catch (error: any) {
      Alert.alert('Sync Failed', error.message || 'Failed to push invoice to Xero. Please try again.');
    } finally {
      setIsXeroPushing(false);
    }
  };

  const handleViewPDF = async () => {
    if (!displayInvoice) return;
    setIsPdfLoading(true);
    try {
      const html = await generateInvoicePDF(displayInvoice, businessSettings);
      if (Platform.OS === 'web') {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        const iframeDoc = iframe.contentWindow?.document;
        if (iframeDoc) {
          iframeDoc.open();
          iframeDoc.write(html);
          iframeDoc.close();
          iframe.onload = () => {
            setTimeout(() => {
              iframe.contentWindow?.print();
              setTimeout(() => document.body.removeChild(iframe), 1000);
            }, 250);
          };
        }
      } else {
        await Print.printAsync({ html });
      }
    } catch (error) {
    } finally {
      setIsPdfLoading(false);
    }
  };

  const resolvedCustomer = useResolvedCustomer(displayInvoice);

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
        title="Invoice Preview"
        subtitle={invoice.invoiceNumber}
        onBackPress={() => {
          setCurrentInvoice(null);
          navigation.goBack();
        }}
        rightIcon="file-pdf-box"
        onRightPress={handleViewPDF}
        rightDisabled={isPdfLoading}
      />

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        <WebContainer>
        {/* Square reconnect prompt — only visible if this invoice has a
            pay-link AND the token has been revoked/expired. Without it the
            tradie would silently lose card-payment capability. */}
        {invoice?.squarePaymentLinkId && squareDisconnectedReason ? (
          <SquareReconnectBanner
            reason={squareDisconnectedReason}
            contextMessage="Card payments are paused"
          />
        ) : null}
        <PaymentSyncErrorBanner error={(invoice as any)?.paymentSyncError} />
        <DisputeBanner
          status={(invoice as any)?.disputeStatus}
          disputeId={(invoice as any)?.disputeId}
        />
        {/* Status Section */}
        <TouchableOpacity onPress={() => setStatusSheetVisible(true)} activeOpacity={0.7}>
        <Surface style={documentStyles.section}>
          <View style={documentStyles.sectionHeader}>
            <View style={documentStyles.sectionHeaderLeft}>
              <View style={[documentStyles.sectionIconCircle, { backgroundColor: colors.successBg }]}>
                <MaterialCommunityIcons name="flag-outline" size={18} color={colors.success} />
              </View>
              <Title style={documentStyles.sectionTitle}>Status</Title>
            </View>
            <View style={documentStyles.editButton}>
              <MaterialCommunityIcons name="pencil" size={16} color={colors.primary} />
            </View>
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
            {invoice.xeroSyncStatus === 'synced' && (
              <Chip
                style={[styles.statusChip, { backgroundColor: colors.successBg }]}
                textStyle={[styles.statusChipText, { color: colors.success }]}
                icon={() => <MaterialCommunityIcons name="cloud-check" size={14} color={colors.success} />}
              >
                Xero
              </Chip>
            )}
            {invoice.xeroSyncStatus === 'error' && (
              <Chip
                style={[styles.statusChip, { backgroundColor: colors.errorBg }]}
                textStyle={styles.statusChipText}
                icon={() => <MaterialCommunityIcons name="cloud-alert" size={14} color={colors.error} />}
              >
                Xero Error
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
        </TouchableOpacity>

        <CustomerSection
          customerName={isEditing ? invoice.customerName : (resolvedCustomer?.customerName || invoice.customerName)}
          customerEmail={isEditing ? invoice.customerEmail : (resolvedCustomer?.customerEmail || invoice.customerEmail)}
          customerPhone={isEditing ? invoice.customerPhone : (resolvedCustomer?.customerPhone || invoice.customerPhone)}
          jobAddress={isEditing ? invoice.jobAddress : (resolvedCustomer?.jobAddress || invoice.jobAddress)}
          website={resolvedCustomer?.website}
          isEditing={isEditing}
          onFieldChange={(field, value) => handleFieldChange(field as keyof Invoice, value)}
          showActions
        />

        {/* Dates Section */}
        <Surface style={documentStyles.section}>
          <View style={documentStyles.sectionHeader}>
            <View style={documentStyles.sectionHeaderLeft}>
              <View style={[documentStyles.sectionIconCircle, { backgroundColor: colors.warningBg }]}>
                <MaterialCommunityIcons name="file-document-outline" size={18} color={colors.secondary} />
              </View>
              <Title style={documentStyles.sectionTitle}>Invoice Details</Title>
            </View>
            <TouchableOpacity
              style={documentStyles.editButton}
              onPress={() => {
                if (isEditing) {
                  handleSave();
                } else {
                  setIsEditing(true);
                }
              }}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={isEditing ? 'check' : 'pencil'}
                size={16}
                color={colors.primary}
              />
            </TouchableOpacity>
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
          isEditing={isEditingJob}
          onJobChange={(job) => handleFieldChange('job', job)}
          onEdit={() => setIsEditingJob(!isEditingJob)}
        />

        <MaterialsSection
          materials={invoice.materials}
          materialsSubtotal={invoice.materialsSubtotal}
          onEdit={() => handleEditSection('materials')}
          emptyMessage="No materials - Labor only"
          markupPercent={invoice.markup}
          rollMarkupIntoMaterials={invoice.showMarkup !== true && invoice.markup > 0}
        />

        <LaborSection
          laborHours={invoice.laborHours}
          laborRate={invoice.laborRate}
          laborTotal={invoice.laborTotal}
          laborUnit={invoice.laborUnit}
          sections={invoice.sections}
          showLaborHours={businessSettings?.showLaborHours}
          onEdit={() => handleEditSection('labor')}
          laborMarkupPercent={invoice.laborMarkup ?? invoice.markup}
          rollMarkupIntoLabor={invoice.showMarkup !== true && (invoice.laborMarkup ?? invoice.markup) > 0}
          laborExtraHours={invoice.laborExtraHours}
        />

        <TotalsSection
          subtotal={invoice.subtotal}
          markup={invoice.markup}
          markupAmount={invoice.markupAmount}
          gst={invoice.gst}
          total={invoice.total}
          hideZeroMarkup
          hideMarkup={invoice.showMarkup !== true}
          paidAmount={invoice.paidAmount}
          balanceDue={amountDue}
          travelAdjustmentAmount={invoice.subtotal * ((invoice.travelAdjustment ?? 0) / 100)}
          travelAdjustmentPercent={invoice.travelAdjustment}
        />

        {/* Notes Section */}
        {(invoice.notes || isEditing) && (
          <Surface style={documentStyles.section}>
            <View style={documentStyles.sectionHeader}>
              <View style={documentStyles.sectionHeaderLeft}>
                <View style={[documentStyles.sectionIconCircle, { backgroundColor: colors.infoBg }]}>
                  <MaterialCommunityIcons name="note-text-outline" size={18} color={colors.info} />
                </View>
                <Title style={documentStyles.sectionTitle}>Notes</Title>
              </View>
            </View>
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
            <View style={documentStyles.sectionHeader}>
              <View style={documentStyles.sectionHeaderLeft}>
                <View style={[documentStyles.sectionIconCircle, { backgroundColor: colors.primaryBg }]}>
                  <MaterialCommunityIcons name="cash-check" size={18} color={colors.primary} />
                </View>
                <Title style={documentStyles.sectionTitle}>Payment History</Title>
              </View>
            </View>
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
            {compactLabels ? 'Record' : 'Record Payment'}
          </Button>
        )}
        {amountDue > 0 && invoice.status !== 'cancelled' && squareConnected && (
          <Button
            mode="contained"
            onPress={() => setTakePaymentVisible(true)}
            style={styles.button}
            contentStyle={styles.buttonContent}
            icon="credit-card-scan"
            buttonColor={colors.primary}
          >
            {compactLabels ? 'Pay' : 'Take Payment'}
          </Button>
        )}
        <SendInvoiceButton
          invoice={invoice}
          businessSettings={businessSettings}
          buttonStyle={styles.button}
        />
      </View>

      <TakePaymentSheet
        visible={takePaymentVisible}
        target={
          {
            kind: 'invoice',
            invoiceId: invoice.id,
            total: invoice.total,
            paidAmount: invoice.paidAmount || 0,
            jobName: invoice.job?.name,
            invoiceNumber: invoice.invoiceNumber,
            terms: (invoice as any)?.termsSnapshot || null,
          } as TakePaymentTarget
        }
        onDismiss={() => setTakePaymentVisible(false)}
        onError={(message) => {
          setTakePaymentVisible(false);
          setTakePaymentError(message);
        }}
      />

      <AlertModal
        visible={!!takePaymentError}
        onDismiss={() => setTakePaymentError(null)}
        type="error"
        title="Couldn't create pay link"
        message={takePaymentError || ''}
        primaryButtonText="OK"
        primaryButtonAction={() => setTakePaymentError(null)}
        showConfetti={false}
      />

      {/* Status Sheet */}
      <StatusSheet
        visible={statusSheetVisible}
        onDismiss={() => setStatusSheetVisible(false)}
        currentStatus={invoice.status}
        onSelect={handleStatusSelect}
        options={INVOICE_STATUS_OPTIONS}
      />
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
