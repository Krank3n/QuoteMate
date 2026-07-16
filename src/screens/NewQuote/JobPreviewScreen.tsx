/**
 * Job Preview Screen
 *
 * End of the New Job wizard. Unified replacement for the old separate
 * QuotePreviewScreen + InvoicePreviewScreen — branches on doc type for
 * the invoice-only payment-terms block, auto-saves on mount with a brief
 * "now send it" banner, and defers the "send as Quote / Invoice" choice
 * to SendSwitcher. No confetti here — the celebration fires on send
 * success, not save (Jul 2026 stall audit: rewarding the save stranded
 * finished quotes).
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform, TouchableOpacity, Animated, Pressable } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import {
  Text,
  Button,
  Surface,
  Title,
  TextInput,
  Menu,
  ActivityIndicator,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../../store/useStore';
import { useDocumentMode } from '../../utils/documentMode';
import { ensureSquareConnectedForPayment } from '../../utils/quoteDeliveryGuard';
import { colors } from '../../theme';
import { previewDocumentPDF } from '../../utils/pdfGenerator';
// until the user actually requests a PDF preview.
import { quoteToDocument, invoiceToDocument } from '../../types/documentAdapter';
import { calculateDueDate, formatPaymentTerms } from '../../utils/invoiceCalculator';
import type { PaymentTerms } from '../../types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SendTypePill } from '../../components/SendSwitcher';
import { SendDocumentButton } from '../../components/SendDocumentButton';
import { FooterButton } from '../../components/FooterButton';
import { DocumentSentBanner } from '../../components/DocumentSentBanner';
import { TakePaymentSheet, type TakePaymentTarget } from '../../components/TakePaymentSheet';
import { reconcileNextNumber } from '../../utils/nextNumber';
import { successTap } from '../../utils/haptics';
import { WebContainer } from '../../components/WebContainer';
import {
  CustomerSection,
  JobSection,
  MaterialsSection,
  LaborSection,
  TotalsSection,
  documentStyles,
} from '../../components/document';
import {
  InvoiceDisplaySettings,
  type InvoiceDisplaySettingsChange,
} from '../../components/InvoiceDisplaySettings';

// Success-banner copy lives in jobPreviewCopy.ts with a contract test:
// it must point at SENDING, never claim completion. No confetti here —
// the confetti celebration fires on actual send success (AlertModal in
// DocumentEmailPreviewModal), not on save. Jul 2026 stall audit: 36 users
// finished a sendable quote, got a "done deal" celebration, and never sent.
import { pickSuccessMessage } from './jobPreviewCopy';
import { buildPreviewQuoteSave } from './previewQuoteSave';

export function JobPreviewScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const mode = useDocumentMode();
  // `viewing: true` means we landed here from a price tap on an
  // existing job (JobCard / JobDetailHeader), not from finishing the
  // wizard. Suppresses the "Quote saved!" celebration + auto-save so
  // re-entering doesn't bump updatedAt or replay the success banner.
  const viewing = route.params?.viewing === true;
  const currentQuote = useStore((s) => s.currentQuote);
  const currentInvoice = useStore((s) => s.currentInvoice);
  const businessSettings = useStore((s) => s.businessSettings);
  const subscriptionStatus = useStore((s) => s.subscriptionStatus);
  // Match JobScopeCard's derivation so previewDocumentPDF gets the same
  // isPro flag and produces identical HTML — without this, the logo
  // (Pro-only) leaks into the PDF for free users and the Firebase
  // Storage URL stalls Android's print bridge.
  const isTrialActiveForPdf = !!(
    subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired
  );
  const isProForPdf = subscriptionStatus?.isPro || isTrialActiveForPdf;
  const nextQuoteNumber = useStore((s) => s.nextQuoteNumber);
  const nextInvoiceNumber = useStore((s) => s.nextInvoiceNumber);
  const documents = useStore((s) => s.documents);
  const quotes = useStore((s) => s.quotes);
  const invoices = useStore((s) => s.invoices);
  const saveQuote = useStore((s) => s.saveQuote);
  const saveInvoice = useStore((s) => s.saveInvoice);
  const updateQuote = useStore((s) => s.updateQuote);
  const updateInvoice = useStore((s) => s.updateInvoice);
  const setCurrentQuote = useStore((s) => s.setCurrentQuote);
  const setCurrentInvoice = useStore((s) => s.setCurrentInvoice);
  const insets = useSafeAreaInsets();

  // The wizard writes one or the other — prefer whichever is set. mode is the
  // tiebreaker for the route-declared intent.
  const isInvoiceMode = mode === 'invoice' && !!currentInvoice;
  const workingDoc = isInvoiceMode ? currentInvoice : currentQuote;

  const [notes, setNotes] = useState(workingDoc?.notes || '');
  const [takePaymentTarget, setTakePaymentTarget] = useState<TakePaymentTarget | null>(null);
  const savedNotesRef = useRef(workingDoc?.notes || '');
  const [refNumber, setRefNumber] = useState<string>(
    isInvoiceMode
      ? (currentInvoice?.invoiceNumber || '')
      : (currentQuote?.quoteNumber || ''),
  );
  const [isEditingNumber, setIsEditingNumber] = useState(false);

  // Payment terms — invoice-only state; inert for quote-mode.
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>(
    currentInvoice?.paymentTerms || 'net_14',
  );
  const [customDays, setCustomDays] = useState(
    currentInvoice?.customPaymentDays?.toString() || '',
  );
  const [paymentTermsMenuVisible, setPaymentTermsMenuVisible] = useState(false);
  const issueDate = currentInvoice?.issueDate || new Date();
  const dueDate = calculateDueDate(
    issueDate,
    paymentTerms,
    paymentTerms === 'custom' ? parseInt(customDays) || 0 : undefined,
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);

  // Predict the next ref number directly from the live quotes / invoices
  // arrays on every render. This sidesteps a race where the stale
  // AsyncStorage counter could show "Q-001" even after Firestore already
  // had Q-050 etc — see utils/nextNumber.ts for the reconciliation logic.
  // We pass the cached counter as a floor so tradies who manually bumped
  // it keep their ceiling.
  const predictedRefNumber = useMemo(() => {
    if (isInvoiceMode) {
      const n = reconcileNextNumber({
        items: invoices,
        field: (i) => i.invoiceNumber,
        prefix: 'INV',
        cached: nextInvoiceNumber,
      });
      return `INV-${String(n).padStart(3, '0')}`;
    }
    const n = reconcileNextNumber({
      items: quotes,
      field: (q) => q.quoteNumber,
      prefix: 'Q',
      cached: nextQuoteNumber,
    });
    return `Q-${String(n).padStart(3, '0')}`;
  }, [isInvoiceMode, quotes, invoices, nextQuoteNumber, nextInvoiceNumber]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMsg] = useState(pickSuccessMessage);

  // Banner animations
  const bannerScale = useRef(new Animated.Value(0.3)).current;
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;

  // Auto-save on mount (skip when re-entering as a viewer from a price tap).
  useEffect(() => {
    if (!workingDoc) return;
    if (viewing) return;

    // The banner must fire exactly once per document — the *first* time
    // this screen mounts after the wizard creates it. Re-entering via a
    // section "Edit" button pops back through the wizard then re-pushes
    // JobPreview, which is a fresh mount; without this guard the banner
    // would replay on every loop. Source of truth is whether the doc has
    // already been persisted into quotes/invoices.
    const alreadySaved = isInvoiceMode
      ? invoices.some((i) => i.id === currentInvoice?.id)
      : quotes.some((q) => q.id === currentQuote?.id);

    if (!alreadySaved) {
      // Start celebration immediately — don't wait for save
      setShowSuccess(true);
      successTap();

      // Animate banner in — backdrop + card in parallel for snappier feel
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(bannerScale, {
          toValue: 1,
          tension: 80,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.timing(bannerOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(checkScale, {
          toValue: 1,
          tension: 100,
          friction: 6,
          delay: 150,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Fade in subtitle after card appears
        Animated.timing(subtitleOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      });

      // Auto-dismiss banner
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(bannerOpacity, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(bannerScale, {
            toValue: 0.8,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(backdropOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
        ]).start(() => setShowSuccess(false));
      }, 2000);
    }

    // Save in the background — branch on mode so invoices go through
    // saveInvoice (which assigns invoiceNumbers) and quotes through
    // saveQuote (which assigns quoteNumbers). The mirror + adapter carry
    // everything into the unified documents collection either way.
    const autoSave = async () => {
      try {
        setIsSaving(true);

        if (isInvoiceMode && currentInvoice) {
          const updatedInvoice = {
            ...currentInvoice,
            notes,
            paymentTerms,
            customPaymentDays:
              paymentTerms === 'custom' ? parseInt(customDays) || 0 : undefined,
            dueDate,
            ...(refNumber ? { invoiceNumber: refNumber } : {}),
            updatedAt: new Date(),
          };
          await saveInvoice(updatedInvoice);
        } else if (currentQuote) {
          // Stamps draftStep 'JobPreview' — see buildPreviewQuoteSave for
          // why the marker must survive this save.
          await saveQuote(buildPreviewQuoteSave(currentQuote, notes, refNumber));
        }
        savedNotesRef.current = notes;
        setIsSaving(false);
      } catch (error) {
        setIsSaving(false);
        Alert.alert('Error', 'Failed to save job. Please try again.');
      }
    };

    autoSave();
  }, []); // Run once on mount

  const handleBackToDashboard = useCallback(async () => {
    // Re-save if notes changed since auto-save
    if (notes !== savedNotesRef.current && workingDoc) {
      try {
        if (isInvoiceMode && currentInvoice) {
          await saveInvoice({
            ...currentInvoice,
            notes,
            paymentTerms,
            customPaymentDays:
              paymentTerms === 'custom' ? parseInt(customDays) || 0 : undefined,
            dueDate,
            ...(refNumber ? { invoiceNumber: refNumber } : {}),
            updatedAt: new Date(),
          });
        } else if (currentQuote) {
          await saveQuote(buildPreviewQuoteSave(currentQuote, notes, refNumber));
        }
      } catch (error) {
        // Non-blocking — navigate anyway
      }
    }

    if (isInvoiceMode) setCurrentInvoice(null);
    else setCurrentQuote(null);
    navigation.getParent()?.goBack();
  }, [
    notes,
    workingDoc,
    isInvoiceMode,
    currentInvoice,
    currentQuote,
    refNumber,
    paymentTerms,
    customDays,
    dueDate,
    saveQuote,
    saveInvoice,
    setCurrentQuote,
    setCurrentInvoice,
    navigation,
  ]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={handleBackToDashboard}
          disabled={isSaving}
          style={styles.headerDoneButton}
        >
          <Text style={styles.headerDoneLabel}>Close</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, handleBackToDashboard, isSaving]);

  // Pull the live unified Document from the documents collection. Used for
  // the PDF preview + SendSwitcher so they reflect the latest canonical
  // state (e.g. after a convert-to-invoice). Falls back to an adapter
  // projection if the unified doc hasn't landed yet (first paint, or
  // offline).
  const liveDoc = useMemo(() => {
    const id = workingDoc?.id;
    if (!id) return null;
    const fromStore = documents.find((d) => d.id === id);
    if (fromStore) return fromStore;
    if (currentInvoice) return invoiceToDocument(currentInvoice);
    if (currentQuote) return quoteToDocument(currentQuote);
    return null;
  }, [workingDoc?.id, documents, currentInvoice, currentQuote]);

  // After a Quote → Invoice convert, liveDoc.type flips to 'invoice' and
  // liveDoc.number gets the new INV-NNN. The route param `mode` and the
  // initial refNumber state were captured at mount and don't follow, so
  // the badge would stay stuck on the old quote number / placeholder.
  // Treat liveDoc as the source of truth for both.
  const liveIsInvoice = liveDoc?.type === 'invoice' || isInvoiceMode;
  // Track the last liveDoc.number we synced into refNumber so we only react
  // to *external* changes (e.g. Quote → Invoice convert). Without this the
  // effect would also fire when the user types a custom number and blurs —
  // refNumber would drift from liveDoc.number and get reverted.
  const lastSyncedNumberRef = useRef<string | null>(null);
  useEffect(() => {
    if (isEditingNumber) return;
    const liveNumber = liveDoc?.number;
    if (!liveNumber) return;
    if (liveNumber !== lastSyncedNumberRef.current) {
      lastSyncedNumberRef.current = liveNumber;
      setRefNumber(liveNumber);
    }
  }, [liveDoc?.number, isEditingNumber]);

  const handleViewPDF = async () => {
    if (!liveDoc) return;
    setIsPdfLoading(true);
    try {
      // isPro mirrors JobScopeCard's derivation. Critical, not cosmetic:
      // when isPro is undefined the PDF gets the business logo (a Pro
      // feature) as a Firebase Storage <img src>, which stalls Android's
      // print bridge — Preview PDF hangs forever.
      await previewDocumentPDF(liveDoc, businessSettings, { isPro: isProForPdf });
    } catch (error: any) {
      Alert.alert('Could not open preview', error?.message || 'Please try again.');
    } finally {
      setIsPdfLoading(false);
    }
  };

  // Payment terms persist immediately so liveDoc (used by Preview PDF)
  // stays in sync with the dropdown. Without this the menu only nudged
  // local state and the PDF kept the previous dueDate.
  const handlePaymentTermsChange = useCallback(
    (nextTerms: PaymentTerms, nextCustomDays?: number) => {
      if (!currentInvoice) return;
      const days =
        nextTerms === 'custom'
          ? (nextCustomDays ?? (parseInt(customDays) || 0))
          : undefined;
      const newDueDate = calculateDueDate(issueDate, nextTerms, days);
      const next = {
        ...currentInvoice,
        paymentTerms: nextTerms,
        customPaymentDays: days,
        dueDate: newDueDate,
        updatedAt: new Date(),
      };
      setPaymentTerms(nextTerms);
      if (days !== undefined) setCustomDays(days.toString());
      updateInvoice(next);
      saveInvoice(next).catch(() => {});
    },
    [currentInvoice, customDays, issueDate, updateInvoice, saveInvoice],
  );

  // Display/deposit toggles persist immediately. Apply via the right
  // update*-then-save* pair so calculations stay in sync and the change
  // hits both AsyncStorage and Firestore.
  const handleDisplaySettingsChange = useCallback(
    (partial: InvoiceDisplaySettingsChange) => {
      if (isInvoiceMode && currentInvoice) {
        const next = { ...currentInvoice, ...partial, updatedAt: new Date() };
        updateInvoice(next);
        saveInvoice(next).catch(() => {});
      } else if (currentQuote) {
        const next = { ...currentQuote, ...partial, updatedAt: new Date() };
        updateQuote(next);
        saveQuote(next).catch(() => {});
      }
    },
    [
      isInvoiceMode,
      currentInvoice,
      currentQuote,
      updateInvoice,
      updateQuote,
      saveInvoice,
      saveQuote,
    ],
  );

  if (!workingDoc) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      style={styles.outerContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <WebContainer>
        {liveDoc ? (
          <View style={styles.topPillRow}>
            <SendTypePill doc={liveDoc} fullWidth />
          </View>
        ) : null}
        <DocumentSentBanner doc={liveDoc} />
        {/* Ref number + date (+ payment terms / due date for invoice mode) */}
        <Surface style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              {isEditingNumber ? (
                <TextInput
                  value={refNumber}
                  onChangeText={setRefNumber}
                  onBlur={() => setIsEditingNumber(false)}
                  onSubmitEditing={() => setIsEditingNumber(false)}
                  placeholder={liveIsInvoice ? 'e.g. INV-001' : 'e.g. Q-001'}
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
                  <View style={styles.quoteNumberBadge}>
                    <MaterialCommunityIcons
                      name={(liveIsInvoice ? 'receipt' : 'file-document-outline') as any}
                      size={14}
                      color={colors.primary}
                    />
                    <Text style={styles.quoteNumber}>
                      {refNumber || predictedRefNumber}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="pencil-outline" size={12} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.headerDateBadge}>
              <MaterialCommunityIcons name="calendar-outline" size={13} color={colors.textMuted} />
              <Text style={styles.quoteDate}>
                {new Date(workingDoc.createdAt).toLocaleDateString('en-AU', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </Text>
            </View>
          </View>

          {isInvoiceMode && currentInvoice ? (
            <View style={styles.paymentTermsBlock}>
              <Menu
                visible={paymentTermsMenuVisible}
                onDismiss={() => setPaymentTermsMenuVisible(false)}
                anchor={
                  <TouchableOpacity
                    style={styles.paymentTermsSelector}
                    onPress={() => setPaymentTermsMenuVisible(true)}
                  >
                    <View style={styles.paymentTermsRow}>
                      <MaterialCommunityIcons
                        name={'clock-outline' as any}
                        size={14}
                        color={colors.textMuted}
                      />
                      <Text style={styles.paymentTermsLabel}>Payment terms</Text>
                    </View>
                    <View style={styles.paymentTermsRow}>
                      <Text style={styles.paymentTermsValue}>
                        {formatPaymentTerms(
                          paymentTerms,
                          parseInt(customDays) || undefined,
                        )}
                      </Text>
                      <MaterialCommunityIcons
                        name="chevron-down"
                        size={16}
                        color={colors.primary}
                      />
                    </View>
                  </TouchableOpacity>
                }
              >
                <Menu.Item
                  onPress={() => {
                    handlePaymentTermsChange('due_on_receipt');
                    setPaymentTermsMenuVisible(false);
                  }}
                  title="Due on Receipt"
                />
                <Menu.Item
                  onPress={() => {
                    handlePaymentTermsChange('net_7');
                    setPaymentTermsMenuVisible(false);
                  }}
                  title="Net 7 (7 days)"
                />
                <Menu.Item
                  onPress={() => {
                    handlePaymentTermsChange('net_14');
                    setPaymentTermsMenuVisible(false);
                  }}
                  title="Net 14 (14 days)"
                />
                <Menu.Item
                  onPress={() => {
                    handlePaymentTermsChange('net_30');
                    setPaymentTermsMenuVisible(false);
                  }}
                  title="Net 30 (30 days)"
                />
                <Menu.Item
                  onPress={() => {
                    handlePaymentTermsChange('custom');
                    setPaymentTermsMenuVisible(false);
                  }}
                  title="Custom"
                />
              </Menu>

              {paymentTerms === 'custom' ? (
                <TextInput
                  label="Custom Days"
                  value={customDays}
                  onChangeText={(text) => {
                    setCustomDays(text);
                    handlePaymentTermsChange('custom', parseInt(text) || 0);
                  }}
                  mode="outlined"
                  keyboardType="number-pad"
                  style={styles.customDaysInput}
                  right={<TextInput.Affix text="days" />}
                />
              ) : null}

              <View style={styles.datesRow}>
                <Text style={styles.dateMeta}>
                  Issue: {new Date(issueDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                </Text>
                <Text style={[styles.dateMeta, styles.dueDateMeta]}>
                  Due: {dueDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              </View>
            </View>
          ) : null}

          <View style={styles.headerCardDivider} />

          <InvoiceDisplaySettings
            mode={liveIsInvoice ? 'invoice' : 'quote'}
            total={Number(workingDoc.total ?? 0)}
            showMarkup={
              workingDoc.showMarkup !== undefined
                ? workingDoc.showMarkup === true
                : businessSettings?.showMarkup === true
            }
            showMaterialCosts={
              workingDoc.showMaterialCosts !== undefined
                ? workingDoc.showMaterialCosts
                : businessSettings?.showMaterialCostsByDefault !== false
            }
            showLaborCosts={
              workingDoc.showLaborCosts !== undefined
                ? workingDoc.showLaborCosts
                : businessSettings?.showLaborCostsByDefault !== false
            }
            requireDeposit={(workingDoc as any).requireDeposit === true}
            depositPercentage={Number((workingDoc as any).depositPercentage ?? 0)}
            onChange={handleDisplaySettingsChange}
            variant="embedded"
          />
        </Surface>

        <View>
        <CustomerSection
          customerName={workingDoc.customerName}
          customerEmail={workingDoc.customerEmail}
          customerPhone={workingDoc.customerPhone}
          jobAddress={workingDoc.jobAddress}
          onEdit={() => navigation.navigate('CustomerDetails')}
        />
        </View>

        <JobSection
          job={workingDoc.job}
          onEdit={() => navigation.navigate('Details')}
        />

        <MaterialsSection
          materials={workingDoc.materials}
          materialsSubtotal={workingDoc.materialsSubtotal}
          onEdit={() => navigation.navigate('MaterialsList')}
          markupPercent={workingDoc.markup}
          rollMarkupIntoMaterials={workingDoc.showMarkup !== true && workingDoc.markup > 0}
        />

        <LaborSection
          laborHours={workingDoc.laborHours}
          laborRate={workingDoc.laborRate}
          laborTotal={workingDoc.laborTotal}
          laborUnit={workingDoc.laborUnit}
          sections={workingDoc.sections}
          showLaborHours={businessSettings?.showLaborHours}
          onEdit={() => navigation.navigate('LaborMarkup')}
          laborMarkupPercent={workingDoc.laborMarkup ?? workingDoc.markup}
          rollMarkupIntoLabor={
            workingDoc.showMarkup !== true &&
            (workingDoc.laborMarkup ?? workingDoc.markup) > 0
          }
          laborExtraHours={workingDoc.laborExtraHours}
        />

        <TotalsSection
          subtotal={workingDoc.subtotal}
          markup={workingDoc.markup}
          markupAmount={workingDoc.markupAmount}
          gst={workingDoc.gst}
          total={workingDoc.total}
          hideZeroMarkup
          hideMarkup={workingDoc.showMarkup !== true}
          travelAdjustmentAmount={
            workingDoc.subtotal * ((workingDoc.travelAdjustment ?? 0) / 100)
          }
          travelAdjustmentPercent={workingDoc.travelAdjustment}
          pricesIncludeGst={workingDoc.pricesIncludeGst === true}
          gstRegistered={workingDoc.gstRegistered}
        />

        <Surface style={documentStyles.section}>
          <View style={documentStyles.sectionHeader}>
            <View style={documentStyles.sectionHeaderLeft}>
              <View style={[documentStyles.sectionIconCircle, { backgroundColor: colors.infoBg }]}>
                <MaterialCommunityIcons name="note-text-outline" size={18} color={colors.info} />
              </View>
              <Title style={documentStyles.sectionTitle}>Notes (Optional)</Title>
            </View>
          </View>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            mode="outlined"
            multiline
            numberOfLines={4}
            placeholder="Add any additional notes for this job..."
            style={styles.notesInput}
          />
        </Surface>

        <Pressable
          onPress={handleViewPDF}
          disabled={isPdfLoading}
          style={({ pressed }) => [
            styles.previewButton,
            pressed && styles.previewButtonPressed,
            isPdfLoading && styles.previewButtonDisabled,
          ]}
        >
          {isPdfLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <MaterialCommunityIcons
              name={'file-eye-outline' as any}
              size={16}
              color={colors.primary}
            />
          )}
          <Text style={styles.previewButtonLabel}>Preview PDF</Text>
        </Pressable>
        </WebContainer>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.bottomButtonsRow}>
          {/* Take Payment — in-person capture path. Same shared sheet
              the ViewJob sticky bar uses: quote → deposit (or full),
              invoice → balance. Lets the tradie tap a card before the
              customer walks off.
              iOS gating: hidden until Tap to Pay is approved and a Square
              reader is available for App Review demo. */}
          {liveDoc && Platform.OS !== 'ios' ? (
            <View style={styles.bottomButtonHalfWrapper}>
              <FooterButton
                mode="outlined"
                icon="credit-card-outline"
                label={
                  liveDoc.type === 'invoice'
                    ? 'Take Payment'
                    : (liveDoc.depositAmount ?? 0) > 0
                      ? 'Take Deposit'
                      : 'Tap to Pay'
                }
                onPress={async () => {
                  if (!(await ensureSquareConnectedForPayment(navigation))) return;
                  if (liveDoc.type === 'invoice') {
                    setTakePaymentTarget({
                      kind: 'invoice',
                      invoiceId: liveDoc.id,
                      total: Number(liveDoc.total ?? 0),
                      paidAmount: Number(liveDoc.paidTotal ?? 0),
                      jobName: liveDoc.job?.name,
                      invoiceNumber: liveDoc.number,
                      terms: liveDoc.termsSnapshot ?? null,
                    });
                  } else {
                    setTakePaymentTarget({
                      kind: 'quote_deposit',
                      quoteId: liveDoc.id,
                      depositAmount: Number(liveDoc.depositAmount ?? 0),
                      depositPaid: Number(liveDoc.depositPaid ?? 0),
                      total: Number(liveDoc.total ?? 0),
                      jobName: liveDoc.job?.name,
                      terms: liveDoc.termsSnapshot ?? null,
                    });
                  }
                }}
                style={{ width: '100%' }}
              />
            </View>
          ) : null}
          <View style={styles.bottomButtonHalfWrapper}>
            {liveDoc ? (
              <SendDocumentButton
                doc={liveDoc}
                businessSettings={businessSettings}
                buttonMode="contained"
                buttonLabel={liveDoc.type === 'invoice' ? 'Send Invoice' : 'Send Quote'}
                buttonIcon="send"
                buttonStyle={styles.sendButtonShape}
              />
            ) : null}
          </View>
        </View>
      </View>

      <TakePaymentSheet
        visible={!!takePaymentTarget}
        target={takePaymentTarget}
        onDismiss={() => setTakePaymentTarget(null)}
        onError={(message) => Alert.alert('Payment error', message)}
      />

      {/* Banner overlay — rendered last so it's on top. Deliberately no
          confetti: the celebration belongs on send success, not save. */}
      <View style={[StyleSheet.absoluteFill, styles.celebrationOverlay]} pointerEvents="none">
        {/* Success banner overlay */}
        {showSuccess && (
          <>
            <Animated.View
              style={[
                styles.successBackdrop,
                { opacity: backdropOpacity },
              ]}
            />
            <Animated.View
              style={[
                styles.successBanner,
                {
                  opacity: bannerOpacity,
                  transform: [{ scale: bannerScale }],
                },
              ]}
            >
              <Animated.View
                style={[
                  styles.successCheckCircle,
                  { transform: [{ scale: checkScale }] },
                ]}
              >
                <MaterialCommunityIcons name="check" size={36} color={colors.white} />
              </Animated.View>
              <Text style={styles.successBannerText}>{successMsg.title}</Text>
              <Animated.Text style={[styles.successSubtext, { opacity: subtitleOpacity }]}>
                {successMsg.subtitle}
              </Animated.Text>
            </Animated.View>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
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
  celebrationOverlay: {
    zIndex: 999,
  },
  successBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  successBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCheckCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    ...Platform.select({
      android: { elevation: 8 },
      ios: {
        shadowColor: colors.success,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
      web: { boxShadow: `0 4px 20px ${colors.success}66` },
    }),
  },
  successBannerText: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.white,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  successSubtext: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginTop: 6,
  },
  headerCard: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  headerCardDivider: {
    height: 1,
    backgroundColor: colors.border,
    opacity: 0.6,
    marginTop: 14,
    marginBottom: 2,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quoteNumberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 8,
  },
  quoteNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  quoteNumberTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quoteNumberInput: {
    backgroundColor: 'transparent',
    fontSize: 14,
    paddingHorizontal: 0,
    height: 32,
    width: 120,
  },
  headerDateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  quoteDate: {
    fontSize: 13,
    color: colors.textMuted,
  },
  notesInput: {
    textAlignVertical: 'top',
    paddingTop: 8,
  },
  paymentTermsBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  paymentTermsSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  paymentTermsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  paymentTermsLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  paymentTermsValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  customDaysInput: {
    marginTop: 4,
  },
  datesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  dateMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  dueDateMeta: {
    color: colors.text,
    fontWeight: '600',
  },
  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.primaryBg,
    borderWidth: 1,
    borderColor: colors.primary + '33',
    marginBottom: 16,
  },
  previewButtonPressed: {
    opacity: 0.8,
  },
  previewButtonDisabled: {
    opacity: 0.55,
  },
  previewButtonLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  bottomBar: {
    flexDirection: 'column',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
      },
      android: { elevation: 8 },
      web: {
        position: 'sticky' as any,
        bottom: 0,
        paddingBottom: 12,
        boxShadow: '0 -2px 12px rgba(0,0,0,0.2)',
        alignItems: 'center',
      },
    }),
  },
  topPillRow: {
    marginBottom: 12,
    alignItems: 'stretch',
  },
  bottomButtonsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
    gap: 10,
    ...(Platform.OS === 'web' && {
      maxWidth: 800,
    }),
  },
  bottomButtonHalfWrapper: {
    flex: 1,
  },
  sendButtonShape: {
    width: '100%',
    margin: 0,
    borderRadius: 12,
  },
  headerDoneButton: {
    marginRight: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  headerDoneLabel: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
