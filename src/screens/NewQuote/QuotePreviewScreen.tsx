/**
 * Quote Preview Screen
 * Final review and export/share quote
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
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import * as Print from 'expo-print';
import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { generateQuotePDF } from '../../utils/pdfGenerator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuccessModal } from '../../components/SuccessModal';
import { SendQuoteButton } from '../../components/SendQuoteButton';

export function QuotePreviewScreen() {
  const navigation = useNavigation<any>();
  const { currentQuote, saveQuote, businessSettings } = useStore();
  const insets = useSafeAreaInsets();

  const [notes, setNotes] = useState(currentQuote?.notes || '');
  const [status, setStatus] = useState(currentQuote?.status || 'draft');
  const [quoteNumber, setQuoteNumber] = useState(currentQuote?.quoteNumber || '');
  const [isEditingNumber, setIsEditingNumber] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  if (!currentQuote) {
    return null;
  }

  const isNewQuote = !currentQuote.quoteNumber;

  const handleSave = async () => {
    try {
      setIsSaving(true);

      const updatedQuote = {
        ...currentQuote,
        notes,
        status,
        ...(quoteNumber ? { quoteNumber } : {}),
        updatedAt: new Date(),
      };

      await saveQuote(updatedQuote);

      // Show success modal
      setShowSuccessModal(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to save quote. Please try again.');
      setIsSaving(false);
    }
  };

  const handleSuccessModalDismiss = () => {
    setShowSuccessModal(false);
    setIsSaving(false);

    // Clear currentQuote from store
    useStore.setState({ currentQuote: null });

    // Navigate back to Dashboard by closing the modal
    // Get the root navigator (RootStack) and go back to Main
    navigation.getParent()?.goBack();
  };

  const handleViewPDF = async () => {
    setIsPdfLoading(true);
    try {
      const html = await generateQuotePDF(currentQuote, businessSettings);

      if (Platform.OS === 'web') {
        // On web, Print.printAsync prints the current page, not the HTML content.
        // Use a hidden iframe to print the generated PDF HTML instead.
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
              setTimeout(() => {
                document.body.removeChild(iframe);
              }, 1000);
            }, 250);
          };
        }
      } else {
        await Print.printAsync({ html });
      }
    } catch (error) {
      console.error('PDF preview error:', error);
    } finally {
      setIsPdfLoading(false);
    }
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

  return (
    <View style={styles.outerContainer}>
      <SuccessModal
        visible={showSuccessModal}
        onDismiss={handleSuccessModalDismiss}
        title="Quote Saved!"
        message="Your quote has been saved successfully and is ready to share with your customer."
        buttonText="Back to Dashboard"
        icon="check-circle"
        quote={currentQuote}
        businessSettings={businessSettings}
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
      {/* Quote Header */}
      <Surface style={styles.headerSection}>
        <View style={styles.headerRow}>
          <View style={styles.headerInfo}>
            {isEditingNumber ? (
              <TextInput
                value={quoteNumber}
                onChangeText={setQuoteNumber}
                onBlur={() => setIsEditingNumber(false)}
                onSubmitEditing={() => setIsEditingNumber(false)}
                placeholder="e.g. Q-001"
                placeholderTextColor="rgba(255,255,255,0.5)"
                autoFocus
                style={styles.quoteNumberInput}
                mode="flat"
                underlineColor="rgba(255,255,255,0.5)"
                activeUnderlineColor="#fff"
                textColor="#fff"
              />
            ) : (
              <TouchableOpacity
                onPress={() => setIsEditingNumber(true)}
                style={styles.quoteNumberTouchable}
                activeOpacity={0.7}
              >
                <Text style={styles.quoteNumber}>
                  {quoteNumber || (isNewQuote ? 'Auto-assigned' : 'Quote')}
                </Text>
                <MaterialCommunityIcons name="pencil" size={14} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            )}
            <Text style={styles.quoteDate}>
              {new Date(currentQuote.createdAt).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Text>
          </View>
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>{status.toUpperCase()}</Text>
          </View>
        </View>
      </Surface>

      {/* Quote Details Preview */}
      <TouchableOpacity onPress={handleEditCustomer} activeOpacity={0.7}>
        <Surface style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title style={styles.sectionTitle}>Customer</Title>
            <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
          </View>
          <Text style={styles.text}>{currentQuote.customerName}</Text>
          {currentQuote.customerEmail && <Text style={styles.subtext}>{currentQuote.customerEmail}</Text>}
          {currentQuote.customerPhone && <Text style={styles.subtext}>{currentQuote.customerPhone}</Text>}
          {currentQuote.jobAddress && <Text style={styles.subtext}>{currentQuote.jobAddress}</Text>}
        </Surface>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleEditJob} activeOpacity={0.7}>
        <Surface style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title style={styles.sectionTitle}>Job</Title>
            <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
          </View>
          <Text style={styles.text}>{currentQuote.job.name}</Text>
          <Text style={styles.subtext}>{currentQuote.job.description}</Text>
        </Surface>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleEditMaterials} activeOpacity={0.7}>
        <Surface style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title style={styles.sectionTitle}>Materials ({currentQuote.materials.length})</Title>
            <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
          </View>
        {currentQuote.materials.length === 0 ? (
          <Text style={styles.subtext}>No materials required - Labor only</Text>
        ) : (
          currentQuote.materials.map((material) => (
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
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.materialsSubtotal)}</Text>
        </View>
        </Surface>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleEditLabor} activeOpacity={0.7}>
        <Surface style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title style={styles.sectionTitle}>Labor</Title>
            <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
          </View>
        <View style={styles.summaryRow}>
          <Text style={styles.text}>
            {businessSettings?.showLaborHours
              ? `${currentQuote.laborHours} hours @ ${formatCurrency(currentQuote.laborRate)}/hr`
              : 'Labor'}
          </Text>
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.laborTotal)}</Text>
        </View>
        </Surface>
      </TouchableOpacity>

      <Surface style={styles.totalSection}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.subtotal)}</Text>
        </View>
        {currentQuote.markup > 0 && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Markup ({currentQuote.markup}%)</Text>
            <Text style={styles.summaryValue}>{formatCurrency(currentQuote.markupAmount)}</Text>
          </View>
        )}
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>GST (10%)</Text>
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.gst)}</Text>
        </View>
        <Divider style={styles.divider} />
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalValue}>{formatCurrency(currentQuote.total)}</Text>
        </View>
      </Surface>

      <Surface style={styles.section}>
        <Title style={styles.sectionTitle}>Status</Title>
        <SegmentedButtons
          value={status}
          onValueChange={setStatus}
          buttons={isNewQuote
            ? [
                { value: 'draft', label: 'Draft' },
                { value: 'sent', label: 'Sent' },
              ]
            : [
                { value: 'draft', label: 'Draft' },
                { value: 'sent', label: 'Sent' },
                { value: 'accepted', label: 'Accepted' },
                { value: 'rejected', label: 'Rejected' },
              ]
          }
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
          placeholder="Add any additional notes for this quote..."
          style={styles.notesInput}
        />
      </Surface>

      <Button
        mode="outlined"
        onPress={handleViewPDF}
        loading={isPdfLoading}
        disabled={isPdfLoading}
        icon="file-pdf-box"
        style={styles.viewPdfButton}
      >
        View PDF Preview
      </Button>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <SendQuoteButton
          quote={currentQuote}
          businessSettings={businessSettings}
          buttonMode="outlined"
          buttonLabel="Send"
          buttonIcon="send"
          buttonStyle={styles.bottomButtonHalf}
        />
        <Button
          mode="contained"
          onPress={handleSave}
          loading={isSaving}
          disabled={isSaving}
          icon="content-save"
          style={styles.bottomButtonHalf}
          contentStyle={styles.bottomButtonContent}
        >
          Save Quote
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' && {
      maxHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
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
      maxWidth: 800,
      marginHorizontal: 'auto' as any,
      width: '100%',
      paddingBottom: 16,
    }),
  },
  headerSection: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
    backgroundColor: colors.primary,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerInfo: {
    flex: 1,
  },
  quoteNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  quoteNumberTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quoteNumberInput: {
    backgroundColor: 'transparent',
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    paddingHorizontal: 0,
    marginBottom: -4,
    height: 36,
  },
  quoteDate: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  statusBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
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
  viewPdfButton: {
    marginBottom: 16,
  },
  bottomBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...(Platform.OS === 'web' && {
      maxWidth: 800,
      marginHorizontal: 'auto' as any,
      width: '100%',
      position: 'sticky' as any,
      bottom: 0,
      paddingBottom: 16,
    }),
  },
  bottomButtonHalf: {
    flex: 1,
  },
  bottomButtonContent: {
    paddingVertical: 8,
  },
});
