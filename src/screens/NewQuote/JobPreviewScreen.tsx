/**
 * Job Preview Screen
 *
 * End of the New Job wizard. Unified replacement for the old separate
 * QuotePreviewScreen + InvoicePreviewScreen — branches on doc type for
 * the invoice-only payment-terms block, auto-saves on mount with the
 * confetti celebration, and defers the "send as Quote / Invoice" choice
 * to SendSwitcher.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform, TouchableOpacity, Animated } from 'react-native';
import {
  Text,
  Button,
  Surface,
  Title,
  TextInput,
  Menu,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Print from 'expo-print';
import { useStore } from '../../store/useStore';
import { useDocumentMode } from '../../utils/documentMode';
import { colors } from '../../theme';
import { generateDocumentPDF } from '../../utils/pdfGenerator';
import { quoteToDocument, invoiceToDocument } from '../../types/documentAdapter';
import { calculateDueDate, formatPaymentTerms } from '../../utils/invoiceCalculator';
import type { PaymentTerms } from '../../types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SendTypePill } from '../../components/SendSwitcher';
import { SendDocumentButton } from '../../components/SendDocumentButton';
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
import { useTourRefs } from '../../components/tour/useTourRefs';
import { ScreenTour } from '../../components/tour/ScreenTour';
import { notifyScreenComplete, notifySkipRequest } from '../../components/tour/UnifiedTourController';
import { PHASE_STEP_OFFSETS, UNIFIED_TOUR_TOTAL_STEPS } from '../../components/tour/tourFlow';

// Confetti piece definition (reused from AlertModal pattern)
interface ConfettiPiece {
  id: number;
  x: number;
  color: string;
  size: number;
  delay: number;
  duration: number;
}

const CONFETTI_COLORS = [colors.success, colors.secondary, colors.info, colors.primary];

const SUCCESS_MESSAGES: { title: string; subtitle: string }[] = [
  { title: "Bloody Ripper!", subtitle: "Job's locked and loaded" },
  { title: "Too Easy!", subtitle: "She's all saved, mate" },
  { title: "Beauty!", subtitle: "Job's good to go" },
  { title: "No Worries!", subtitle: "Saved and ready to send" },
  { title: "Strewth!", subtitle: "That one's a done deal" },
  { title: "Good as Gold!", subtitle: "Ready for the customer" },
  { title: "Nailed It!", subtitle: "Job saved, legend" },
  { title: "Sweet as!", subtitle: "All wrapped up, mate" },
  { title: "Bonzer!", subtitle: "Job's in the bag" },
  { title: "You Beauty!", subtitle: "Send it when you're ready" },
];

function createConfettiPieces(): ConfettiPiece[] {
  return Array.from({ length: 25 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    size: Math.random() * 6 + 4,
    delay: i * 50,
    duration: 2000 + Math.random() * 1000,
  }));
}

export function JobPreviewScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const mode = useDocumentMode();
  // `viewing: true` means we landed here from a price tap on an
  // existing job (JobCard / JobDetailHeader), not from finishing the
  // wizard. Suppresses the "Quote saved!" celebration + auto-save so
  // re-entering doesn't bump updatedAt or replay the success banner.
  const viewing = route.params?.viewing === true;
  const {
    currentQuote,
    currentInvoice,
    saveQuote,
    saveInvoice,
    updateInvoice,
    businessSettings,
    setCurrentQuote,
    setCurrentInvoice,
    nextQuoteNumber,
    nextInvoiceNumber,
    documents,
    quotes,
    invoices,
    unifiedTourActive,
    unifiedTourPhase,
  } = useStore();
  const insets = useSafeAreaInsets();

  // Tour refs
  const { registerRef } = useTourRefs();
  const editSectionsRef = useRef<View>(null);
  const sendButtonRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [tourActive, setTourActive] = useState(false);

  useEffect(() => {
    if (editSectionsRef.current) registerRef('editSections', editSectionsRef.current);
    if (sendButtonRef.current) registerRef('sendButton', sendButtonRef.current);
  });

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
  const [successMsg] = useState(() => SUCCESS_MESSAGES[Math.floor(Math.random() * SUCCESS_MESSAGES.length)]);

  // Confetti state & animations
  const [confetti] = useState<ConfettiPiece[]>(() => createConfettiPieces());
  const confettiAnims = useRef(
    confetti.map(() => ({
      translateY: new Animated.Value(-100),
      rotate: new Animated.Value(0),
      opacity: new Animated.Value(0),
    }))
  ).current;

  // Banner animations
  const bannerScale = useRef(new Animated.Value(0.3)).current;
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;

  // Auto-save on mount (skip during unified tour — dummy doc shouldn't
  // be saved — and skip when re-entering as a viewer from a price tap).
  useEffect(() => {
    if (!workingDoc) return;
    if (unifiedTourActive) return;
    if (viewing) return;

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

    // Animate confetti
    confetti.forEach((piece, index) => {
      const anim = confettiAnims[index];
      Animated.sequence([
        Animated.delay(piece.delay),
        Animated.parallel([
          Animated.timing(anim.translateY, {
            toValue: 500,
            duration: piece.duration,
            useNativeDriver: true,
          }),
          Animated.timing(anim.rotate, {
            toValue: (Math.random() - 0.5) * 720,
            duration: piece.duration,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(anim.opacity, {
              toValue: 0.9,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.delay(piece.duration * 0.5),
            Animated.timing(anim.opacity, {
              toValue: 0,
              duration: piece.duration * 0.3,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]).start();
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
          const updatedQuote = {
            ...currentQuote,
            notes,
            draftStep: undefined,
            ...(refNumber ? { quoteNumber: refNumber } : {}),
            updatedAt: new Date(),
          };
          await saveQuote(updatedQuote);
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
          await saveQuote({
            ...currentQuote,
            notes,
            draftStep: undefined,
            ...(refNumber ? { quoteNumber: refNumber } : {}),
            updatedAt: new Date(),
          });
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
  useEffect(() => {
    if (isEditingNumber) return;
    const liveNumber = liveDoc?.number;
    if (liveNumber && liveNumber !== refNumber) {
      setRefNumber(liveNumber);
    }
  }, [liveDoc?.number, isEditingNumber, refNumber]);

  const handleViewPDF = async () => {
    if (!liveDoc) return;
    setIsPdfLoading(true);
    try {
      const html = await generateDocumentPDF(liveDoc, businessSettings);

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
    } finally {
      setIsPdfLoading(false);
    }
  };

  if (!workingDoc) {
    return null;
  }

  return (
    <View style={styles.outerContainer}>
      <ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <WebContainer>
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
                    setPaymentTerms('due_on_receipt');
                    setPaymentTermsMenuVisible(false);
                  }}
                  title="Due on Receipt"
                />
                <Menu.Item
                  onPress={() => {
                    setPaymentTerms('net_7');
                    setPaymentTermsMenuVisible(false);
                  }}
                  title="Net 7 (7 days)"
                />
                <Menu.Item
                  onPress={() => {
                    setPaymentTerms('net_14');
                    setPaymentTermsMenuVisible(false);
                  }}
                  title="Net 14 (14 days)"
                />
                <Menu.Item
                  onPress={() => {
                    setPaymentTerms('net_30');
                    setPaymentTermsMenuVisible(false);
                  }}
                  title="Net 30 (30 days)"
                />
                <Menu.Item
                  onPress={() => {
                    setPaymentTerms('custom');
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
        </Surface>

        <View ref={editSectionsRef}>
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
        </WebContainer>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {/* Pill sits on its own row above the buttons so it's clearly
            the modifier for Send, not a sibling of Back. Right-aligned
            under the send column so the grouping is unambiguous. */}
        {liveDoc ? (
          <View style={styles.bottomPillRow}>
            <SendTypePill doc={liveDoc} />
          </View>
        ) : null}
        <View style={styles.bottomButtonsRow}>
          <Button
            mode="outlined"
            onPress={handleBackToDashboard}
            loading={isSaving}
            disabled={isSaving}
            icon="content-save-outline"
            style={styles.bottomButtonHalf}
            contentStyle={styles.bottomButtonContent}
          >
            Done
          </Button>
          <View ref={sendButtonRef} style={styles.bottomButtonHalf}>
            {liveDoc ? (
              <SendDocumentButton
                doc={liveDoc}
                businessSettings={businessSettings}
                buttonMode="contained"
                buttonLabel={liveDoc.type === 'invoice' ? 'Send Invoice' : 'Send Quote'}
                buttonIcon="send"
              />
            ) : null}
          </View>
        </View>
        {/* Take Payment — in-person capture path. Same shared sheet the
            ViewJob sticky bar uses: quote → deposit (or full), invoice
            → balance. Lets the tradie tap a card before the customer
            walks off. */}
        {liveDoc ? (
          <Button
            mode="outlined"
            icon="credit-card-outline"
            onPress={() => {
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
            style={styles.bottomButtonFull}
            contentStyle={styles.bottomButtonContent}
          >
            {liveDoc.type === 'invoice'
              ? 'Take Payment'
              : (liveDoc.depositAmount ?? 0) > 0
                ? 'Take Deposit'
                : 'Tap to Pay'}
          </Button>
        ) : null}
      </View>

      <TakePaymentSheet
        visible={!!takePaymentTarget}
        target={takePaymentTarget}
        onDismiss={() => setTakePaymentTarget(null)}
        onError={(message) => Alert.alert('Payment error', message)}
      />

      {/* Confetti overlay — rendered last so it's on top */}
      <View style={[StyleSheet.absoluteFill, styles.celebrationOverlay]} pointerEvents="none">
        {confetti.map((piece, index) => {
          const anim = confettiAnims[index];
          return (
            <Animated.View
              key={piece.id}
              style={[
                styles.confetti,
                {
                  left: `${piece.x}%` as any,
                  width: piece.size,
                  height: piece.size,
                  backgroundColor: piece.color,
                  opacity: anim.opacity,
                  transform: [
                    { translateY: anim.translateY },
                    {
                      rotate: anim.rotate.interpolate({
                        inputRange: [-360, 360],
                        outputRange: ['-360deg', '360deg'],
                      }),
                    },
                  ],
                },
              ]}
            />
          );
        })}

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

      {/* Screen Tour */}
      {unifiedTourActive && unifiedTourPhase === 'quotePreview' && <ScreenTour
        tourId="quotePreview"
        delay={1500}
        onActiveChange={setTourActive}
        scrollRef={scrollRef}
        scrollPositions={{ editSections: 0, sendButton: 0 }}
        unifiedMode={true}
        onScreenComplete={() => notifyScreenComplete('quotePreview')}
        onSkipRequest={notifySkipRequest}
        stepOffset={PHASE_STEP_OFFSETS.quotePreview}
        globalTotalSteps={UNIFIED_TOUR_TOTAL_STEPS}
      />}
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
  celebrationOverlay: {
    zIndex: 999,
  },
  confetti: {
    position: 'absolute',
    top: -100,
    borderRadius: 2,
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
  viewPdfButton: {
    marginBottom: 16,
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
        paddingBottom: 16,
        boxShadow: '0 -2px 12px rgba(0,0,0,0.2)',
      },
    }),
  },
  bottomPillRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingRight: 2,
  },
  bottomButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  bottomButtonHalf: {
    flex: 1,
  },
  bottomButtonFull: {
    marginTop: 8,
  },
  bottomButtonContent: {
    paddingVertical: 8,
  },
});
