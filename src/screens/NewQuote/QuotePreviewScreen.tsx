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
  TextInput,
  SegmentedButtons,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import * as Print from 'expo-print';
import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { generateQuotePDF } from '../../utils/pdfGenerator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuccessModal } from '../../components/SuccessModal';
import { SendQuoteButton } from '../../components/SendQuoteButton';
import {
  CustomerSection,
  JobSection,
  MaterialsSection,
  LaborSection,
  TotalsSection,
  documentStyles,
} from '../../components/document';

export function QuotePreviewScreen() {
  const navigation = useNavigation<any>();
  const { currentQuote, saveQuote, businessSettings, setCurrentQuote } = useStore();
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
      setShowSuccessModal(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to save quote. Please try again.');
      setIsSaving(false);
    }
  };

  const handleSuccessModalDismiss = () => {
    setShowSuccessModal(false);
    setIsSaving(false);
    setCurrentQuote(null);
    navigation.getParent()?.goBack();
  };

  const handleViewPDF = async () => {
    setIsPdfLoading(true);
    try {
      const html = await generateQuotePDF(currentQuote, businessSettings);

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

        <CustomerSection
          customerName={currentQuote.customerName}
          customerEmail={currentQuote.customerEmail}
          customerPhone={currentQuote.customerPhone}
          jobAddress={currentQuote.jobAddress}
          onEdit={() => navigation.navigate('CustomerDetails')}
        />

        <JobSection
          job={currentQuote.job}
          onEdit={() => navigation.navigate('JobDetails')}
        />

        <MaterialsSection
          materials={currentQuote.materials}
          materialsSubtotal={currentQuote.materialsSubtotal}
          onEdit={() => navigation.navigate('MaterialsList')}
        />

        <LaborSection
          laborHours={currentQuote.laborHours}
          laborRate={currentQuote.laborRate}
          laborTotal={currentQuote.laborTotal}
          showLaborHours={businessSettings?.showLaborHours}
          onEdit={() => navigation.navigate('LaborMarkup')}
        />

        <TotalsSection
          subtotal={currentQuote.subtotal}
          markup={currentQuote.markup}
          markupAmount={currentQuote.markupAmount}
          gst={currentQuote.gst}
          total={currentQuote.total}
          hideZeroMarkup
        />

        <Surface style={documentStyles.section}>
          <Title style={documentStyles.sectionTitle}>Status</Title>
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

        <Surface style={documentStyles.section}>
          <Title style={documentStyles.sectionTitle}>Notes (Optional)</Title>
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
