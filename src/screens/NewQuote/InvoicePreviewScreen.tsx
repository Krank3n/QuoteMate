/**
 * Invoice Preview Screen
 * Final review screen for invoice creation with payment terms
 */

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform, TouchableOpacity } from 'react-native';
import {
  Text,
  Button,
  Surface,
  Title,
  Divider,
  TextInput,
  SegmentedButtons,
  Menu,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { MaterialsSection } from '../../components/document/MaterialsSection';
import { calculateDueDate, formatPaymentTerms } from '../../utils/invoiceCalculator';
import { SuccessModal } from '../../components/SuccessModal';
import { SendInvoiceButton } from '../../components/SendInvoiceButton';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { PaymentTerms, InvoiceStatus } from '../../types';

export function InvoicePreviewScreen() {
  const navigation = useNavigation<any>();
  const { currentInvoice, saveInvoice, businessSettings, updateInvoice } = useStore();

  const [notes, setNotes] = useState(currentInvoice?.notes || '');
  const [status, setStatus] = useState<InvoiceStatus>(currentInvoice?.status || 'draft');
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>(currentInvoice?.paymentTerms || 'net_14');
  const [customDays, setCustomDays] = useState(currentInvoice?.customPaymentDays?.toString() || '');
  const [paymentTermsMenuVisible, setPaymentTermsMenuVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  if (!currentInvoice) {
    return null;
  }

  // Calculate due date based on payment terms
  const issueDate = currentInvoice.issueDate || new Date();
  const dueDate = calculateDueDate(
    issueDate,
    paymentTerms,
    paymentTerms === 'custom' ? parseInt(customDays) || 0 : undefined
  );

  const handleSave = async () => {
    try {
      setIsSaving(true);

      const updatedInvoice = {
        ...currentInvoice,
        notes,
        status,
        paymentTerms,
        customPaymentDays: paymentTerms === 'custom' ? parseInt(customDays) || 0 : undefined,
        dueDate,
        updatedAt: new Date(),
      };

      await saveInvoice(updatedInvoice);
      setShowSuccessModal(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to save invoice. Please try again.');
      setIsSaving(false);
    }
  };

  const handleSuccessModalDismiss = () => {
    setShowSuccessModal(false);
    setIsSaving(false);

    // Clear currentInvoice from store
    useStore.setState({ currentInvoice: null });

    // Navigate back to main tabs
    navigation.getParent()?.goBack();
  };

  const handleEditCustomer = () => {
    navigation.navigate('CustomerDetails');
  };

  const handleEditJob = () => {
    navigation.navigate('JobDetails');
  };

  const handleEditMaterials = () => {
    navigation.navigate('MaterialsList');
  };

  const handleEditLabor = () => {
    navigation.navigate('LaborMarkup');
  };

  const handlePaymentTermsChange = (terms: PaymentTerms) => {
    setPaymentTerms(terms);
    setPaymentTermsMenuVisible(false);

    // Update current invoice with new due date
    const newDueDate = calculateDueDate(
      issueDate,
      terms,
      terms === 'custom' ? parseInt(customDays) || 0 : undefined
    );

    updateInvoice({
      ...currentInvoice,
      paymentTerms: terms,
      dueDate: newDueDate,
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <View style={styles.outerContainer}>
      <SuccessModal
        visible={showSuccessModal}
        onDismiss={handleSuccessModalDismiss}
        title="Invoice Saved!"
        message="Your invoice has been saved successfully and is ready to send to your customer."
        buttonText="Back to Invoices"
        icon="check-circle"
        secondaryActionComponent={
          currentInvoice && businessSettings ? (
            <SendInvoiceButton
              invoice={currentInvoice}
              businessSettings={businessSettings}
              buttonMode="outlined"
              buttonStyle={{ width: '100%', paddingVertical: 6, borderColor: colors.primary }}
            />
          ) : undefined
        }
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Invoice Details Preview */}
        <TouchableOpacity onPress={handleEditCustomer} activeOpacity={0.7}>
          <Surface style={styles.section}>
            <View style={styles.sectionHeader}>
              <Title style={styles.sectionTitle}>Customer</Title>
              <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
            </View>
            <Text style={styles.text}>{currentInvoice.customerName}</Text>
            {currentInvoice.customerEmail && <Text style={styles.subtext}>{currentInvoice.customerEmail}</Text>}
            {currentInvoice.customerPhone && <Text style={styles.subtext}>{currentInvoice.customerPhone}</Text>}
            {currentInvoice.jobAddress && <Text style={styles.subtext}>{currentInvoice.jobAddress}</Text>}
          </Surface>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleEditJob} activeOpacity={0.7}>
          <Surface style={styles.section}>
            <View style={styles.sectionHeader}>
              <Title style={styles.sectionTitle}>Job</Title>
              <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
            </View>
            <Text style={styles.text}>{currentInvoice.job.name}</Text>
            <Text style={styles.subtext}>{currentInvoice.job.description}</Text>
          </Surface>
        </TouchableOpacity>

        <MaterialsSection
          materials={currentInvoice.materials}
          materialsSubtotal={currentInvoice.materialsSubtotal}
          onEdit={handleEditMaterials}
          markupPercent={currentInvoice.markup}
          rollMarkupIntoMaterials={currentInvoice.showMarkup !== true && currentInvoice.markup > 0}
        />

        <TouchableOpacity onPress={handleEditLabor} activeOpacity={0.7}>
          <Surface style={styles.section}>
            <View style={styles.sectionHeader}>
              <Title style={styles.sectionTitle}>Labor</Title>
              <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
            </View>
            {currentInvoice.sections && currentInvoice.sections.length > 0 ? (
              <>
                {currentInvoice.sections.map((section) => {
                  const sUnit = section.laborUnit || 'hours';
                  const sLabel = sUnit === 'days' ? 'days' : 'hours';
                  const sRate = sUnit === 'days' ? '/day' : '/hr';
                  return (
                    <View key={section.id} style={styles.summaryRow}>
                      <Text style={styles.text}>
                        {businessSettings?.showLaborHours
                          ? `${section.name}: ${section.laborHours} ${sLabel} @ ${formatCurrency(section.laborRate)}${sRate}`
                          : section.name}
                      </Text>
                      <Text style={styles.summaryValue}>{formatCurrency(section.laborTotal)}</Text>
                    </View>
                  );
                })}
                <View style={styles.summaryRow}>
                  <Text style={[styles.text, { fontWeight: '600' }]}>Labor Total</Text>
                  <Text style={[styles.summaryValue, { fontWeight: '700' }]}>{formatCurrency(currentInvoice.laborTotal)}</Text>
                </View>
              </>
            ) : (
              <View style={styles.summaryRow}>
                <Text style={styles.text}>
                  {businessSettings?.showLaborHours
                    ? `${currentInvoice.laborHours} ${(currentInvoice.laborUnit || 'hours') === 'days' ? 'days' : 'hours'} @ ${formatCurrency(currentInvoice.laborRate)}${(currentInvoice.laborUnit || 'hours') === 'days' ? '/day' : '/hr'}`
                    : 'Labor'}
                </Text>
                <Text style={styles.summaryValue}>{formatCurrency(currentInvoice.laborTotal)}</Text>
              </View>
            )}
          </Surface>
        </TouchableOpacity>

        {/* Invoice-specific: Payment Terms */}
        <Surface style={styles.section}>
          <Title style={styles.sectionTitle}>Payment Terms</Title>

          <View style={styles.paymentTermsRow}>
            <Menu
              visible={paymentTermsMenuVisible}
              onDismiss={() => setPaymentTermsMenuVisible(false)}
              anchor={
                <TouchableOpacity
                  style={styles.paymentTermsSelector}
                  onPress={() => setPaymentTermsMenuVisible(true)}
                >
                  <Text style={styles.paymentTermsText}>
                    {formatPaymentTerms(paymentTerms, parseInt(customDays) || undefined)}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color={colors.primary} />
                </TouchableOpacity>
              }
            >
              <Menu.Item onPress={() => handlePaymentTermsChange('due_on_receipt')} title="Due on Receipt" />
              <Menu.Item onPress={() => handlePaymentTermsChange('net_7')} title="Net 7 (7 days)" />
              <Menu.Item onPress={() => handlePaymentTermsChange('net_14')} title="Net 14 (14 days)" />
              <Menu.Item onPress={() => handlePaymentTermsChange('net_30')} title="Net 30 (30 days)" />
              <Menu.Item onPress={() => handlePaymentTermsChange('custom')} title="Custom" />
            </Menu>
          </View>

          {paymentTerms === 'custom' && (
            <TextInput
              label="Custom Days"
              value={customDays}
              onChangeText={(text) => {
                setCustomDays(text);
                const days = parseInt(text) || 0;
                const newDueDate = calculateDueDate(issueDate, 'custom', days);
                updateInvoice({
                  ...currentInvoice,
                  customPaymentDays: days,
                  dueDate: newDueDate,
                });
              }}
              mode="outlined"
              keyboardType="number-pad"
              style={styles.customDaysInput}
              right={<TextInput.Affix text="days" />}
            />
          )}

          <View style={styles.dateRow}>
            <View style={styles.dateItem}>
              <Text style={styles.dateLabel}>Issue Date</Text>
              <Text style={styles.dateValue}>{formatDate(issueDate)}</Text>
            </View>
            <View style={styles.dateItem}>
              <Text style={styles.dateLabel}>Due Date</Text>
              <Text style={[styles.dateValue, styles.dueDateValue]}>{formatDate(dueDate)}</Text>
            </View>
          </View>
        </Surface>

        <Surface style={styles.totalSection}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>{formatCurrency(currentInvoice.subtotal)}</Text>
          </View>
          {currentInvoice.showMarkup === true && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Markup ({currentInvoice.markup}%)</Text>
            <Text style={styles.summaryValue}>{formatCurrency(currentInvoice.markupAmount)}</Text>
          </View>
          )}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>GST (10%)</Text>
            <Text style={styles.summaryValue}>{formatCurrency(currentInvoice.gst)}</Text>
          </View>
          <Divider style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>{formatCurrency(currentInvoice.total)}</Text>
          </View>
        </Surface>

        <Surface style={styles.section}>
          <Title style={styles.sectionTitle}>Status</Title>
          <SegmentedButtons
            value={status}
            onValueChange={(value) => setStatus(value as InvoiceStatus)}
            buttons={[
              { value: 'draft', label: 'Draft' },
              { value: 'sent', label: 'Sent' },
            ]}
          />
        </Surface>

        <Surface style={styles.section}>
          <Title style={styles.sectionTitle}>Notes (Optional)</Title>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            mode="outlined"
            multiline
            numberOfLines={4}
            placeholder="Add any additional notes for this invoice..."
            style={styles.notesInput}
          />
        </Surface>
      </ScrollView>

      <FixedBottomButton
        label="Save Invoice"
        onPress={handleSave}
        loading={isSaving}
        disabled={isSaving}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' && {
      maxHeight: '100vh' as any,
      display: 'flex' as any,
      flexDirection: 'column' as any,
    }),
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 140,
    ...(Platform.OS === 'web' && {
      paddingBottom: 16,
    }),
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
    margin: 0,
    marginBottom: 12,
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
  notesInput: {
    textAlignVertical: 'top',
    paddingTop: 8,
  },
  paymentTermsRow: {
    marginBottom: 16,
  },
  paymentTermsSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  paymentTermsText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  customDaysInput: {
    marginBottom: 16,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dateItem: {
    flex: 1,
    padding: 12,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  dateLabel: {
    fontSize: 12,
    color: colors.onSurface,
    marginBottom: 4,
  },
  dateValue: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  dueDateValue: {
    color: colors.primary,
  },
});
