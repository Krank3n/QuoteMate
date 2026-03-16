/**
 * Quote Preview Screen
 * Final review and export/share quote
 * Auto-saves on mount with inline confetti celebration
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform, TouchableOpacity, Animated } from 'react-native';
import {
  Text,
  Button,
  Surface,
  Title,
  TextInput,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import * as Print from 'expo-print';
import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { generateQuotePDF } from '../../utils/pdfGenerator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SendQuoteButton } from '../../components/SendQuoteButton';
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
  { title: "Bloody Ripper!", subtitle: "Quote's locked and loaded" },
  { title: "Too Easy!", subtitle: "She's all saved, mate" },
  { title: "Beauty!", subtitle: "Quote's good to go" },
  { title: "No Worries!", subtitle: "Saved and ready to send" },
  { title: "Strewth!", subtitle: "That quote's a done deal" },
  { title: "Good as Gold!", subtitle: "Ready for the customer" },
  { title: "Nailed It!", subtitle: "Quote saved, legend" },
  { title: "Sweet as!", subtitle: "All wrapped up, mate" },
  { title: "Bonzer!", subtitle: "Quote's in the bag" },
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

export function QuotePreviewScreen() {
  const navigation = useNavigation<any>();
  const { currentQuote, saveQuote, businessSettings, setCurrentQuote, nextQuoteNumber, unifiedTourActive, unifiedTourPhase } = useStore();
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

  const [notes, setNotes] = useState(currentQuote?.notes || '');
  const savedNotesRef = useRef(currentQuote?.notes || '');
  const status = currentQuote?.status || 'draft';
  const [quoteNumber, setQuoteNumber] = useState(currentQuote?.quoteNumber || '');
  const [isEditingNumber, setIsEditingNumber] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
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

  // Auto-save on mount (skip during unified tour — dummy quote shouldn't be saved)
  useEffect(() => {
    if (!currentQuote) return;
    if (unifiedTourActive) return;

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

    // Save in the background
    const autoSave = async () => {
      try {
        setIsSaving(true);

        const updatedQuote = {
          ...currentQuote,
          notes,
          status,
          draftStep: null,
          ...(quoteNumber ? { quoteNumber } : {}),
          updatedAt: new Date(),
        };

        await saveQuote(updatedQuote);
        savedNotesRef.current = notes;
        setIsSaving(false);
      } catch (error) {
        setIsSaving(false);
        Alert.alert('Error', 'Failed to save quote. Please try again.');
      }
    };

    autoSave();
  }, []); // Run once on mount

  const handleBackToDashboard = useCallback(async () => {
    // Re-save if notes changed since auto-save
    if (notes !== savedNotesRef.current && currentQuote) {
      try {
        const updatedQuote = {
          ...currentQuote,
          notes,
          status,
          draftStep: null,
          ...(quoteNumber ? { quoteNumber } : {}),
          updatedAt: new Date(),
        };
        await saveQuote(updatedQuote);
      } catch (error) {
        // Non-blocking — navigate anyway
        console.error('Failed to save notes on exit:', error);
      }
    }

    setCurrentQuote(null);
    navigation.getParent()?.goBack();
  }, [notes, currentQuote, quoteNumber, status, saveQuote, setCurrentQuote, navigation]);

  const handleViewPDF = async () => {
    setIsPdfLoading(true);
    try {
      const html = await generateQuotePDF(currentQuote!, businessSettings);

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

  if (!currentQuote) {
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
        {/* Quote Number & Date */}
        <Surface style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              {isEditingNumber ? (
                <TextInput
                  value={quoteNumber}
                  onChangeText={setQuoteNumber}
                  onBlur={() => setIsEditingNumber(false)}
                  onSubmitEditing={() => setIsEditingNumber(false)}
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
                  <View style={styles.quoteNumberBadge}>
                    <MaterialCommunityIcons name="file-document-outline" size={14} color={colors.primary} />
                    <Text style={styles.quoteNumber}>
                      {quoteNumber || `Q-${String(nextQuoteNumber).padStart(3, '0')}`}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="pencil-outline" size={12} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.headerDateBadge}>
              <MaterialCommunityIcons name="calendar-outline" size={13} color={colors.textMuted} />
              <Text style={styles.quoteDate}>
                {new Date(currentQuote.createdAt).toLocaleDateString('en-AU', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </Text>
            </View>
          </View>
        </Surface>

        <View ref={editSectionsRef}>
        <CustomerSection
          customerName={currentQuote.customerName}
          customerEmail={currentQuote.customerEmail}
          customerPhone={currentQuote.customerPhone}
          jobAddress={currentQuote.jobAddress}
          onEdit={() => navigation.navigate('CustomerDetails')}
        />
        </View>

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
        </WebContainer>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Button
          mode="outlined"
          onPress={handleBackToDashboard}
          loading={isSaving}
          disabled={isSaving}
          icon="view-dashboard"
          style={styles.bottomButtonHalf}
          contentStyle={styles.bottomButtonContent}
        >
          Back to Dashboard
        </Button>
        <View ref={sendButtonRef} style={styles.bottomButtonHalf}>
          <SendQuoteButton
            quote={currentQuote}
            businessSettings={businessSettings}
            buttonMode="contained"
            buttonLabel="Send"
            buttonIcon="send"
          />
        </View>
      </View>

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
  viewPdfButton: {
    marginBottom: 16,
  },
  bottomBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 12,
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
  bottomButtonHalf: {
    flex: 1,
  },
  bottomButtonContent: {
    paddingVertical: 8,
  },
});
