/**
 * View Quote Screen
 * Full screen view for viewing and managing saved quotes
 */

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import {
  Text,
  Button,
  Surface,
  Title,
} from 'react-native-paper';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import * as Print from 'expo-print';
import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { generateQuotePDF } from '../utils/pdfGenerator';
import { SendQuoteButton } from '../components/SendQuoteButton';
import { AlertModal } from '../components/AlertModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DocumentHeader,
  CustomerSection,
  JobSection,
  MaterialsSection,
  LaborSection,
  TotalsSection,
  documentStyles,
} from '../components/document';

export function ViewQuoteScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const quoteId = route.params?.quoteId;

  const { quotes, currentQuote, businessSettings, saveQuote, setCurrentQuote, createInvoiceFromQuote, saveInvoice } = useStore();
  const insets = useSafeAreaInsets();

  const [displayQuote, setDisplayQuote] = useState(null);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);

  // Refresh quote data when screen comes into focus
  // Auto-save if there are pending changes in currentQuote
  useFocusEffect(
    React.useCallback(() => {
      const savedQuote = quotes.find(q => q.id === quoteId);

      // If currentQuote matches this quote ID, auto-save the changes
      if (currentQuote && currentQuote.id === quoteId) {
        const updatedQuote = {
          ...currentQuote,
          updatedAt: new Date(),
        };
        saveQuote(updatedQuote);
        setDisplayQuote(updatedQuote);
        // Clear currentQuote after saving
        setCurrentQuote(null);
      } else if (savedQuote) {
        setDisplayQuote(savedQuote);
      }
    }, [quotes, currentQuote, quoteId, saveQuote, setCurrentQuote])
  );

  if (!displayQuote) {
    return (
      <View style={styles.container}>
        <Text>Quote not found</Text>
      </View>
    );
  }

  const quote = displayQuote;

  const handleEditSection = (section: 'customer' | 'job' | 'materials' | 'labor') => {
    setCurrentQuote(quote);
    const screenMap = {
      customer: 'CustomerDetails',
      job: 'JobDetails',
      materials: 'MaterialsList',
      labor: 'LaborMarkup',
    };
    navigation.navigate('NewQuote', { screen: screenMap[section] });
  };

  const handleConvertToInvoice = () => {
    setShowConvertModal(true);
  };

  const handleConfirmConvert = async () => {
    setIsConverting(true);
    try {
      const invoice = createInvoiceFromQuote(quote);
      await saveInvoice(invoice);
      setShowConvertModal(false);
      navigation.navigate('ViewInvoice' as never, { invoiceId: invoice.id } as never);
    } catch (error) {
      console.error('Failed to convert to invoice:', error);
    } finally {
      setIsConverting(false);
    }
  };

  const handleViewPDF = async () => {
    setIsPdfLoading(true);
    try {
      const html = await generateQuotePDF(quote, businessSettings);
      await Print.printAsync({ html });
    } catch (error) {
      console.error('PDF preview error:', error);
    } finally {
      setIsPdfLoading(false);
    }
  };

  // Show convert button for accepted or sent quotes
  const canConvertToInvoice = quote.status === 'accepted' || quote.status === 'sent' || quote.status === 'completed';

  return (
    <View style={styles.container}>
      <AlertModal
        visible={showConvertModal}
        onDismiss={() => setShowConvertModal(false)}
        type="info"
        icon="file-replace"
        title="Convert to Invoice"
        message={`Create an invoice from this quote for ${quote.customerName}?`}
        showConfetti={false}
        primaryButtonText="Convert"
        primaryButtonAction={handleConfirmConvert}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setShowConvertModal(false)}
        secondaryButtonLoading={isConverting}
      />

      <DocumentHeader
        title="Quote Preview"
        subtitle={displayQuote?.quoteNumber}
        onBackPress={() => navigation.goBack()}
        rightIcon="file-pdf-box"
        onRightPress={handleViewPDF}
        rightDisabled={isPdfLoading}
      />

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
      >
        <CustomerSection
          customerName={quote.customerName}
          customerEmail={quote.customerEmail}
          customerPhone={quote.customerPhone}
          jobAddress={quote.jobAddress}
          onEdit={() => handleEditSection('customer')}
        />

        <JobSection
          job={quote.job}
          onEdit={() => handleEditSection('job')}
        />

        <MaterialsSection
          materials={quote.materials}
          materialsSubtotal={quote.materialsSubtotal}
          onEdit={() => handleEditSection('materials')}
        />

        <LaborSection
          laborHours={quote.laborHours}
          laborRate={quote.laborRate}
          laborTotal={quote.laborTotal}
          showLaborHours={businessSettings?.showLaborHours}
          onEdit={() => handleEditSection('labor')}
        />

        <TotalsSection
          subtotal={quote.subtotal}
          markup={quote.markup}
          markupAmount={quote.markupAmount}
          gst={quote.gst}
          total={quote.total}
        />

        {quote.notes && (
          <Surface style={documentStyles.section}>
            <Title style={documentStyles.sectionTitle}>Notes</Title>
            <Text style={documentStyles.text}>{quote.notes}</Text>
          </Surface>
        )}
      </ScrollView>

      {/* Fixed bottom section with solid background */}
      {Platform.OS !== 'ios' && <View style={styles.solidBackground} />}

      <View
        style={[
          styles.actions,
          Platform.OS !== 'ios' && { marginBottom: Math.max(insets.bottom, 16) }
        ]}
      >
        {canConvertToInvoice ? (
          <>
            <Button
              mode="outlined"
              onPress={handleConvertToInvoice}
              style={styles.outlinedButton}
              contentStyle={styles.buttonContent}
              labelStyle={styles.outlinedButtonLabel}
              icon="file-replace"
            >
              Convert to Invoice
            </Button>
            <SendQuoteButton
              quote={quote}
              businessSettings={businessSettings}
              buttonStyle={styles.sendButton}
            />
          </>
        ) : (
          <>
            <Button
              mode="outlined"
              onPress={() => navigation.goBack()}
              style={styles.outlinedButton}
              contentStyle={styles.buttonContent}
              labelStyle={styles.outlinedButtonLabel}
            >
              Close
            </Button>
            <SendQuoteButton
              quote={quote}
              businessSettings={businessSettings}
              buttonStyle={styles.sendButton}
            />
          </>
        )}
      </View>
    </View>
  );
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
  sendButton: {
    flex: 1,
    margin: 0,
    borderRadius: 24,
  },
  outlinedButton: {
    flex: 1,
    margin: 0,
    borderColor: colors.primary,
    borderWidth: 1.5,
    borderRadius: 24,
  },
  buttonContent: {
    height: 48,
    alignItems: 'center',
  },
  outlinedButtonLabel: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '600',
    marginVertical: 0,
    lineHeight: 20,
  },
});
