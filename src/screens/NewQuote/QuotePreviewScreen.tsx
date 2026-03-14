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
  const { currentQuote, saveQuote, businessSettings, setCurrentQuote, nextQuoteNumber } = useStore();
  const insets = useSafeAreaInsets();

  const [notes, setNotes] = useState(currentQuote?.notes || '');
  const savedNotesRef = useRef(currentQuote?.notes || '');
  const status = currentQuote?.status || 'draft';
  const [quoteNumber, setQuoteNumber] = useState(currentQuote?.quoteNumber || '');
  const [isEditingNumber, setIsEditingNumber] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

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
  const bannerScale = useRef(new Animated.Value(0)).current;
  const bannerOpacity = useRef(new Animated.Value(0)).current;

  // Auto-save on mount
  useEffect(() => {
    if (!currentQuote) return;

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
        setShowSuccess(true);
        successTap();

        // Animate banner in
        Animated.parallel([
          Animated.spring(bannerScale, {
            toValue: 1,
            tension: 120,
            friction: 8,
            useNativeDriver: true,
          }),
          Animated.timing(bannerOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start();

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

        // Auto-dismiss banner after 3 seconds
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
          ]).start(() => setShowSuccess(false));
        }, 3000);
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
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <WebContainer>
        {/* Quote Number & Date */}
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
                <Text style={styles.quoteNumberLabel}>Quote #</Text>
                <Text style={styles.quoteNumber}>
                  {quoteNumber || `Q-${String(nextQuoteNumber).padStart(3, '0')}`}
                </Text>
                <MaterialCommunityIcons name="pencil-outline" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.quoteDate}>
            {new Date(currentQuote.createdAt).toLocaleDateString('en-AU', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </Text>
        </View>

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
        </WebContainer>
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
          onPress={handleBackToDashboard}
          loading={isSaving}
          disabled={isSaving}
          icon="view-dashboard"
          style={styles.bottomButtonHalf}
          contentStyle={styles.bottomButtonContent}
        >
          Back to Dashboard
        </Button>
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
          <Animated.View
            style={[
              styles.successBanner,
              {
                opacity: bannerOpacity,
                transform: [{ scale: bannerScale }],
              },
            ]}
          >
            <MaterialCommunityIcons name="check-circle" size={24} color={colors.success} />
            <Text style={styles.successBannerText}>Quote Complete!</Text>
          </Animated.View>
        )}
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
  successBanner: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successBg,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    gap: 8,
    ...Platform.select({
      android: { elevation: 6 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      web: { boxShadow: '0 2px 12px rgba(0,0,0,0.3)' },
    }),
  },
  successBannerText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.success,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  headerLeft: {
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
  quoteDate: {
    fontSize: 14,
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
    paddingTop: 12,
    gap: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...(Platform.OS === 'web' && {
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
