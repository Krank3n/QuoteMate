/**
 * View Quote Screen
 * Full screen view for viewing and managing saved quotes
 */

import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import {
  Text,
  Button,
  Surface,
  Title,
  TextInput,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import * as Print from 'expo-print';
import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { generateQuotePDF } from '../utils/pdfGenerator';
import { SendQuoteButton } from '../components/SendQuoteButton';
import { AlertModal } from '../components/AlertModal';
import { TakePaymentSheet, TakePaymentTarget } from '../components/TakePaymentSheet';
import { SquareReconnectBanner } from '../components/SquareReconnectBanner';
import { PaymentSyncErrorBanner, DisputeBanner } from '../components/PaymentAlertBanners';
import * as squareService from '../services/squareService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebContainer } from '../components/WebContainer';
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

export function ViewQuoteScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const quoteId = route.params?.quoteId;

  const { quotes, currentQuote, businessSettings, saveQuote, setCurrentQuote, createInvoiceFromQuote, saveInvoice, nextQuoteNumber } = useStore();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const compactLabels = windowWidth < 400;

  // displayQuote is derived directly from the store so edits made on
  // MaterialsListScreen / LaborMarkupScreen via saveDraft show up the moment
  // the store updates (~100ms), instead of waiting for a focus effect +
  // InteractionManager handle that could stay open for several seconds and
  // froze the materials card for ~10s after returning from MaterialsList.
  const displayQuote = useMemo(
    () => quotes.find((q) => q.id === quoteId) || null,
    [quotes, quoteId]
  );

  const [showConvertModal, setShowConvertModal] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isEditingNumber, setIsEditingNumber] = useState(false);
  const [quoteNumber, setQuoteNumber] = useState('');
  const [squareConnected, setSquareConnected] = useState<boolean | null>(null);
  const [squareDisconnectedReason, setSquareDisconnectedReason] = useState<string | null>(null);
  const [showConnectSquareModal, setShowConnectSquareModal] = useState(false);
  const [takePaymentVisible, setTakePaymentVisible] = useState(false);
  const [takePaymentError, setTakePaymentError] = useState<string | null>(null);

  React.useEffect(() => {
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

  // Clear the in-progress edit sentinel when we re-focus this screen after
  // editing materials/labor. This MUST be in a focus effect (not a plain
  // useEffect) because handleEditSection calls setCurrentQuote(quote) right
  // before navigating to MaterialsList — clearing it on render would null
  // out the quote the edit screen needs and the edit screen would mount
  // blank. By gating on focus, we only clear AFTER the user has come back.
  // The MaterialsList unsaved-changes guard already persisted via saveDraft,
  // so there is nothing to flush here.
  useFocusEffect(
    React.useCallback(() => {
      if (currentQuote && currentQuote.id === quoteId) {
        setCurrentQuote(null);
      }
    }, [currentQuote, quoteId, setCurrentQuote])
  );

  // Sync quoteNumber when displayQuote loads/changes
  React.useEffect(() => {
    if (displayQuote?.quoteNumber !== undefined) {
      setQuoteNumber(displayQuote.quoteNumber || '');
    }
  }, [displayQuote?.quoteNumber]);

  const handleQuoteNumberSave = async () => {
    setIsEditingNumber(false);
    if (!displayQuote) return;
    if (quoteNumber !== (displayQuote.quoteNumber || '')) {
      const updated = { ...displayQuote, quoteNumber, updatedAt: new Date() };
      // saveQuote updates the `quotes` array in the store; our memo above
      // re-derives displayQuote from that, so no manual local update needed.
      await saveQuote(updated);
    }
  };

  if (!displayQuote) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const quote = displayQuote;
  const resolvedCustomer = useResolvedCustomer(displayQuote);

  const handleEditSection = (section: 'customer' | 'job' | 'materials' | 'labor') => {
    setCurrentQuote(quote);
    const screenMap = {
      customer: 'CustomerDetails',
      job: 'JobDetails',
      materials: 'MaterialsList',
      labor: 'LaborMarkup',
    };
    navigation.navigate('NewQuote', { screen: screenMap[section], params: { editing: true } });
  };

  const handleConvertToInvoice = () => {
    setShowConvertModal(true);
  };

  const handleConfirmConvert = async () => {
    setIsConverting(true);
    try {
      const invoice = await createInvoiceFromQuote(quote);
      // If the quote was already invoiced, createInvoiceFromQuote returned
      // the existing invoice — saveInvoice is still safe (it merges) but a
      // no-op-ish write is fine and keeps the success path uniform.
      await saveInvoice(invoice);
      setShowConvertModal(false);
      navigation.navigate('ViewInvoice' as never, { invoiceId: invoice.id } as never);
    } catch (error) {
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
        onBackPress={() => navigation.goBack()}
        rightIcon="file-pdf-box"
        onRightPress={handleViewPDF}
        rightDisabled={isPdfLoading}
      />

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
      >
        <WebContainer>
        {/* Surface revoked-Square state for quotes that rely on a deposit
            pay-link, so the tradie can reconnect before the customer tries
            to pay and hits a dead link. */}
        {(quote as any).depositPaymentLinkId && squareDisconnectedReason ? (
          <SquareReconnectBanner
            reason={squareDisconnectedReason}
            contextMessage="Deposit link is paused"
          />
        ) : null}
        <PaymentSyncErrorBanner error={(quote as any)?.paymentSyncError} />
        <DisputeBanner
          status={(quote as any)?.disputeStatus}
          disputeId={(quote as any)?.disputeId}
        />
        {/* Editable Quote Number */}
        <View style={styles.quoteNumberRow}>
          {isEditingNumber ? (
            <TextInput
              value={quoteNumber}
              onChangeText={setQuoteNumber}
              onBlur={handleQuoteNumberSave}
              onSubmitEditing={handleQuoteNumberSave}
              placeholder="e.g. Q-001"
              autoFocus
              style={styles.quoteNumberInput}
              mode="flat"
              dense
            />
          ) : (
            <TouchableOpacity
              onPress={() => setIsEditingNumber(true)}
              style={styles.quoteNumberTouchable}
              activeOpacity={0.7}
            >
              <Text style={styles.quoteNumberLabel}>Quote #</Text>
              <Text style={styles.quoteNumber}>
                {quoteNumber || quote.quoteNumber || `Q-${String(nextQuoteNumber).padStart(3, '0')}`}
              </Text>
              <MaterialCommunityIcons name="pencil-outline" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <CustomerSection
          customerName={resolvedCustomer?.customerName || quote.customerName}
          customerEmail={resolvedCustomer?.customerEmail || quote.customerEmail}
          customerPhone={resolvedCustomer?.customerPhone || quote.customerPhone}
          jobAddress={resolvedCustomer?.jobAddress || quote.jobAddress}
          website={resolvedCustomer?.website}
          onEdit={() => handleEditSection('customer')}
          showActions
        />

        <JobSection
          job={quote.job}
          onEdit={() => handleEditSection('job')}
        />

        <MaterialsSection
          materials={quote.materials}
          materialsSubtotal={quote.materialsSubtotal}
          onEdit={() => handleEditSection('materials')}
          markupPercent={quote.markup}
          rollMarkupIntoMaterials={quote.showMarkup !== true && quote.markup > 0}
        />

        <LaborSection
          laborHours={quote.laborHours}
          laborRate={quote.laborRate}
          laborTotal={quote.laborTotal}
          laborUnit={quote.laborUnit}
          sections={quote.sections}
          showLaborHours={businessSettings?.showLaborHours}
          onEdit={() => handleEditSection('labor')}
          laborMarkupPercent={quote.laborMarkup ?? quote.markup}
          rollMarkupIntoLabor={quote.showMarkup !== true && (quote.laborMarkup ?? quote.markup) > 0}
          laborExtraHours={quote.laborExtraHours}
        />

        <TotalsSection
          subtotal={quote.subtotal}
          markup={quote.markup}
          markupAmount={quote.markupAmount}
          gst={quote.gst}
          total={quote.total}
          hideZeroMarkup
          hideMarkup={quote.showMarkup !== true}
          travelAdjustmentAmount={quote.subtotal * ((quote.travelAdjustment ?? 0) / 100)}
          travelAdjustmentPercent={quote.travelAdjustment}
        />

        {quote.notes && (
          <Surface style={documentStyles.section}>
            <Title style={documentStyles.sectionTitle}>Notes</Title>
            <Text style={documentStyles.text}>{quote.notes}</Text>
          </Surface>
        )}
        </WebContainer>
      </ScrollView>

      {/* Fixed bottom section with solid background */}
      <View style={[styles.solidBackground, { height: 60 + insets.bottom }]} />

      <View
        style={[
          styles.actions,
          { paddingBottom: Math.max(insets.bottom, 16) }
        ]}
      >
        {(() => {
          const depositPaid = Number((quote as any).depositPaid) || 0;
          if (depositPaid >= quote.total) return null;
          return (
            <Button
              mode="contained"
              onPress={() => {
                if (squareConnected === false) {
                  setShowConnectSquareModal(true);
                } else {
                  setTakePaymentVisible(true);
                }
              }}
              style={styles.outlinedButton}
              contentStyle={styles.buttonContent}
              icon="credit-card-scan"
              buttonColor={colors.primary}
            >
              {compactLabels ? 'Pay' : 'Take Payment'}
            </Button>
          );
        })()}
        {canConvertToInvoice ? (
          <>
            <Button
              mode="outlined"
              onPress={handleConvertToInvoice}
              style={styles.outlinedButton}
              contentStyle={styles.buttonContent}
              labelStyle={styles.outlinedButtonLabel}
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

      <TakePaymentSheet
        visible={takePaymentVisible}
        target={
          {
            kind: 'quote_deposit',
            quoteId: quote.id,
            depositAmount: Number((quote as any).depositAmount) || 0,
            depositPaid: Number((quote as any).depositPaid) || 0,
            total: Number(quote.total) || 0,
            jobName: quote.job?.name,
            terms: (quote as any)?.termsSnapshot || null,
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
        title="Couldn't create deposit link"
        message={takePaymentError || ''}
        primaryButtonText="OK"
        primaryButtonAction={() => setTakePaymentError(null)}
        showConfetti={false}
      />

      <AlertModal
        visible={showConnectSquareModal}
        onDismiss={() => setShowConnectSquareModal(false)}
        type="info"
        icon="credit-card-outline"
        title="Connect Square"
        message="Connect your Square account to accept card payments on-site."
        primaryButtonText="Connect Square"
        primaryButtonAction={() => {
          setShowConnectSquareModal(false);
          navigation.navigate('SquareIntegration' as never);
        }}
        secondaryButtonText="Not now"
        secondaryButtonAction={() => setShowConnectSquareModal(false)}
        showConfetti={false}
      />
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
  quoteNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  quoteNumberTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quoteNumberLabel: {
    fontSize: 14,
    color: colors.textMuted,
    marginRight: 4,
  },
  quoteNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginRight: 6,
  },
  quoteNumberInput: {
    backgroundColor: 'transparent',
    fontSize: 14,
    paddingHorizontal: 0,
    height: 32,
    width: 120,
  },
  solidBackground: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
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
  },
  outlinedButton: {
    flex: 1,
    margin: 0,
    borderWidth: 2,
    borderColor: colors.primary,
    justifyContent: 'center',
    height: 48,
  },
  buttonContent: {
    height: 48,
  },
  outlinedButtonLabel: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
    marginVertical: 0,
    marginHorizontal: 0,
  },
});
