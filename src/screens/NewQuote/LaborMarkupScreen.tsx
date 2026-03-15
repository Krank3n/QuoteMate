/**
 * Labor & Markup Screen
 * Set labor hours, rates, and markup percentage
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity, Pressable, TextInput as RNTextInput } from 'react-native';
import {
  Text,
  TextInput,
  Surface,
  Divider,
} from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useStore } from '../../store/useStore';
import { useCurrentDocument, useDocumentMode, getPreviewScreenName } from '../../utils/documentMode';

import { colors } from '../../theme';
import { formatCurrency, calculateQuote } from '../../utils/quoteCalculator';
import { estimateFuelCost, DEFAULT_FUEL_PRICE } from '../../utils/travelCalculator';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import { useTourRefs } from '../../components/tour/useTourRefs';
import { ScreenTour } from '../../components/tour/ScreenTour';

export function LaborMarkupScreen() {
  const navigation = useNavigation<any>();
  const mode = useDocumentMode();
  const { document: currentDocument, update: updateDocument } = useCurrentDocument();
  const { saveDraft, businessSettings } = useStore();

  // For compatibility, alias to currentQuote (used throughout this file)
  const currentQuote = currentDocument;
  const updateQuote = updateDocument;

  // Get the appropriate preview screen based on mode
  const previewScreenName = getPreviewScreenName(mode);

  // Tour refs
  const { registerRef } = useTourRefs();
  const travelSectionRef = useRef<View>(null);
  const travelAdjustRef = useRef<View>(null);
  const laborSectionRef = useRef<View>(null);
  const markupSectionRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [tourActive, setTourActive] = useState(false);

  useEffect(() => {
    if (travelSectionRef.current) registerRef('travelSection', travelSectionRef.current);
    if (travelAdjustRef.current) registerRef('travelAdjust', travelAdjustRef.current);
    if (laborSectionRef.current) registerRef('laborSection', laborSectionRef.current);
    if (markupSectionRef.current) registerRef('markupSection', markupSectionRef.current);
  });

  const [laborHours, setLaborHours] = useState('');
  const [laborRate, setLaborRate] = useState('');
  const [markup, setMarkup] = useState('');
  const [travelAdjustment, setTravelAdjustment] = useState('0');
  const [travelDismissed, setTravelDismissed] = useState(false);
  const [lastTravelValue, setLastTravelValue] = useState('0');
  const [warningDialogVisible, setWarningDialogVisible] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');

  useEffect(() => {
    if (currentQuote) {
      setLaborHours(currentQuote.laborHours.toString());
      setLaborRate(currentQuote.laborRate.toString());
      setMarkup(currentQuote.markup.toString());
      const ta = (currentQuote.travelAdjustment || 0).toString();
      setTravelAdjustment(ta);
      setLastTravelValue(ta);
    }
  }, [currentQuote]);

  // Save changes when navigating back
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      if (!currentQuote) return;

      const hours = parseFloat(laborHours) || 0;
      const rate = parseFloat(laborRate) || 0;
      const markupPercent = parseFloat(markup) || 0;
      const travelPct = travelDismissed ? 0 : (parseFloat(travelAdjustment) || 0);

      const calculation = calculateQuote(
        currentQuote.materials,
        rate,
        hours,
        markupPercent,
        travelPct
      );

      // Save labor and calculated values before leaving
      const updatedQuote = {
        ...currentQuote,
        laborHours: hours,
        laborRate: rate,
        markup: markupPercent,
        travelAdjustment: travelPct,
        laborTotal: calculation.laborTotal,
        materialsSubtotal: calculation.materialsSubtotal,
        subtotal: calculation.subtotal,
        markupAmount: calculation.markupAmount,
        gst: calculation.gst,
        total: calculation.total,
      };
      updateQuote(updatedQuote);
    });

    return unsubscribe;
  }, [navigation, currentQuote, laborHours, laborRate, markup, travelAdjustment, travelDismissed, updateQuote]);

  if (!currentQuote) {
    return null;
  }

  // Calculate totals in real-time
  const hours = parseFloat(laborHours) || 0;
  const rate = parseFloat(laborRate) || 0;
  const markupPercent = parseFloat(markup) || 0;
  const travelPct = travelDismissed ? 0 : (parseFloat(travelAdjustment) || 0);

  const calculation = calculateQuote(
    currentQuote.materials,
    rate,
    hours,
    markupPercent,
    travelPct
  );

  const estimatedDistance = currentQuote.estimatedDistance;
  const fuelCost = estimatedDistance ? estimateFuelCost(estimatedDistance) : 0;
  const hasBusinessAddress = !!businessSettings?.address;
  const hasJobAddress = !!currentQuote.jobAddress;
  const geocodeFailed = !!currentQuote.travelGeocodeFailed;

  const handleNext = () => {
    // Validate labor hours and rate
    if (hours === 0 || rate === 0) {
      const docType = mode === 'invoice' ? 'invoice' : 'quote';
      setWarningMessage(
        `Labor hours or rate is set to $0. This means no labor cost will be included in the ${docType}.\n\nDo you want to continue?`
      );
      setWarningDialogVisible(true);
      return;
    }

    proceedToPreview();
  };

  const proceedToPreview = () => {
    // Update quote with labor details
    const updatedQuote = {
      ...currentQuote,
      laborHours: hours,
      laborRate: rate,
      markup: markupPercent,
      travelAdjustment: travelPct,
      laborTotal: calculation.laborTotal,
      materialsSubtotal: calculation.materialsSubtotal,
      subtotal: calculation.subtotal,
      markupAmount: calculation.markupAmount,
      gst: calculation.gst,
      total: calculation.total,
      draftStep: previewScreenName,
    };

    updateQuote(updatedQuote);
    saveDraft(updatedQuote);
    setWarningDialogVisible(false);
    navigation.navigate(previewScreenName);
  };

  const scrollContent = (
    <>
      <AlertModal
        visible={warningDialogVisible}
        onDismiss={() => setWarningDialogVisible(false)}
        type="warning"
        title="Zero Labor Cost"
        message={warningMessage}
        primaryButtonText="Continue"
        primaryButtonAction={proceedToPreview}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setWarningDialogVisible(false)}
        showConfetti={false}
      />
      <View style={styles.outerContainer}>
        <ScrollView
          ref={scrollRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
        <WebContainer>
        {/* Labor Section */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionLine} />
          <Text style={styles.sectionHeaderTitle}>LABOUR</Text>
          <View style={styles.sectionLine} />
        </View>

        <View ref={laborSectionRef} style={styles.section}>
        <TextInput
          label="Estimated Hours"
          value={laborHours}
          onChangeText={setLaborHours}
          mode="outlined"
          keyboardType="decimal-pad"
          right={<TextInput.Affix text="hrs" />}
          style={styles.input}
        />

        <TextInput
          label="Hourly Rate"
          value={laborRate}
          onChangeText={setLaborRate}
          mode="outlined"
          keyboardType="decimal-pad"
          left={<TextInput.Affix text="$" />}
          right={<TextInput.Affix text="/hr" />}
          style={styles.input}
        />

        <Surface style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Labor Total</Text>
          <Text style={styles.calculationValue}>
            {formatCurrency(calculation.laborTotal)}
          </Text>
        </Surface>
      </View>

      {/* Markup Section */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionLine} />
        <Text style={styles.sectionHeaderTitle}>MARKUP</Text>
        <View style={styles.sectionLine} />
      </View>

      <View ref={markupSectionRef} style={styles.section}>
        <TextInput
          label="Markup Percentage"
          value={markup}
          onChangeText={setMarkup}
          mode="outlined"
          keyboardType="decimal-pad"
          right={<TextInput.Affix text="%" />}
          style={styles.input}
        />

        <Surface style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Markup Amount</Text>
          <Text style={styles.calculationValue}>
            {formatCurrency(calculation.markupAmount)}
          </Text>
        </Surface>
      </View>

      {/* Travel Adjustment Section */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionLine} />
        <Text style={styles.sectionHeaderTitle}>TRAVEL ADJUSTMENT</Text>
        <View style={styles.sectionLine} />
      </View>

      {estimatedDistance !== undefined ? (
        <View ref={travelSectionRef} style={styles.section}>
          {!travelDismissed ? (
            <>
              <Surface style={styles.travelCard}>
                <View style={styles.travelCardTop}>
                  <View style={styles.travelCardIcon}>
                    <MaterialCommunityIcons name="map-marker-distance" size={20} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.travelDistance}>~{estimatedDistance}km from your business</Text>
                    <Text style={styles.travelFuelText}>
                      Fuel ~${DEFAULT_FUEL_PRICE.toFixed(2)}/L · ~{formatCurrency(fuelCost)} round trip
                    </Text>
                  </View>
                  <Text style={styles.travelPercent}>+{travelPct}%</Text>
                </View>
              </Surface>
              <View ref={travelAdjustRef} style={styles.travelButtonsRow}>
                <View style={styles.travelStepperRow}>
                  <View style={styles.travelStepper}>
                    <Pressable
                      style={({ pressed }) => [styles.travelStepperBtn, pressed && styles.travelStepperBtnPressed]}
                      onPress={() => {
                        const current = parseFloat(travelAdjustment) || 0;
                        const newVal = Math.max(0, current - 1).toString();
                        setTravelAdjustment(newVal);
                        setLastTravelValue(newVal);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialCommunityIcons name="minus" size={16} color={colors.text} />
                    </Pressable>
                    <RNTextInput
                      style={styles.travelStepperInput}
                      key={`travel-${travelAdjustment}`}
                      defaultValue={String(travelPct)}
                      onEndEditing={(e) => {
                        const val = Math.max(0, parseInt(e.nativeEvent.text) || 0).toString();
                        setTravelAdjustment(val);
                        setLastTravelValue(val);
                      }}
                      keyboardType="number-pad"
                      selectTextOnFocus
                      returnKeyType="done"
                    />
                    <Pressable
                      style={({ pressed }) => [styles.travelStepperBtn, pressed && styles.travelStepperBtnPressed]}
                      onPress={() => {
                        const current = parseFloat(travelAdjustment) || 0;
                        const newVal = (current + 1).toString();
                        setTravelAdjustment(newVal);
                        setLastTravelValue(newVal);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialCommunityIcons name="plus" size={16} color={colors.text} />
                    </Pressable>
                  </View>
                  <Text style={styles.travelStepperUnit}>%</Text>
                </View>
                <TouchableOpacity
                  style={styles.travelDismissBtn}
                  onPress={() => {
                    setTravelDismissed(true);
                  }}
                >
                  <MaterialCommunityIcons name="close" size={14} color="#ef4444" />
                  <Text style={styles.travelDismissText}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.travelDismissedRow}>
              <Text style={styles.travelDismissedText}>Travel adjustment dismissed</Text>
              <TouchableOpacity
                style={styles.travelUndoBtn}
                onPress={() => {
                  setTravelDismissed(false);
                  setTravelAdjustment(lastTravelValue);
                }}
              >
                <MaterialCommunityIcons name="restore" size={14} color={colors.primary} />
                <Text style={styles.travelUndoText}>Restore</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.section}>
          {!hasBusinessAddress ? (
            <>
              <Text style={styles.travelCtaText}>
                Can't calculate travel if we don't know where you're coming from, legend!
              </Text>
              <TouchableOpacity
                style={styles.travelCtaButton}
                onPress={() => navigation.navigate('BusinessProfile')}
              >
                <MaterialCommunityIcons name="map-marker-plus" size={18} color={colors.primary} />
                <Text style={styles.travelCtaButtonText}>Set your business address</Text>
              </TouchableOpacity>
            </>
          ) : !hasJobAddress ? (
            <>
              <Text style={styles.travelCtaText}>
                Where's the job at, mate? Chuck in the address so we can sort out your travel costs.
              </Text>
              <TouchableOpacity
                style={styles.travelCtaButton}
                onPress={() => navigation.navigate('CustomerDetails')}
              >
                <MaterialCommunityIcons name="map-marker-plus" size={18} color={colors.primary} />
                <Text style={styles.travelCtaButtonText}>Add the job address</Text>
              </TouchableOpacity>
            </>
          ) : geocodeFailed ? (
            <>
              <Text style={styles.travelCtaText}>
                Couldn't quite find that address, mate. Double-check the spelling and give it another crack.
              </Text>
              <TouchableOpacity
                style={styles.travelCtaButton}
                onPress={() => navigation.navigate('CustomerDetails')}
              >
                <MaterialCommunityIcons name="map-marker-alert" size={18} color={colors.primary} />
                <Text style={styles.travelCtaButtonText}>Fix the address</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.travelCtaText}>
              Hang tight — calculating the distance...
            </Text>
          )}
        </View>
      )}

      {/* Quote Summary */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionLine} />
        <Text style={styles.sectionHeaderTitle}>QUOTE SUMMARY</Text>
        <View style={styles.sectionLine} />
      </View>

      <Surface style={styles.summarySection}>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Materials</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(calculation.materialsSubtotal)}
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Labor</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(calculation.laborTotal)}
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(calculation.subtotal)}
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Markup ({markupPercent}%)</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(calculation.markupAmount)}
          </Text>
        </View>

        {travelPct > 0 && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Travel Adjustment ({travelPct}%)</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(calculation.travelAdjustmentAmount)}
            </Text>
          </View>
        )}

        <Divider style={styles.divider} />

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal (Inc. Markup)</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(calculation.subtotal + calculation.markupAmount + calculation.travelAdjustmentAmount)}
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>GST (10%)</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(calculation.gst)}
          </Text>
        </View>

        <Divider style={styles.divider} />

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalValue}>
            {formatCurrency(calculation.total)}
          </Text>
        </View>
      </Surface>
        </WebContainer>
        </ScrollView>

        <FixedBottomButton
          label={mode === 'invoice' ? "Next: Preview Invoice" : "Next: Preview Quote"}
          onPress={handleNext}
        />
      </View>

      {/* Screen Tour */}
      <ScreenTour
        tourId="laborMarkup"
        onActiveChange={setTourActive}
        scrollRef={scrollRef}
        scrollPositions={{ travelSection: 0, laborSection: 0, markupSection: 300, travelAdjust: 200 }}
      />
    </>
  );

  // On web, return ScrollView directly. On mobile, wrap with KeyboardAvoidingView
  if (Platform.OS === 'web') {
    return scrollContent;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {scrollContent}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' && {
      display: 'flex' as any,
      flexDirection: 'column' as any,
      height: '100vh' as any,
      overflow: 'hidden' as any,
    }),
  },
  scrollView: {
    flex: 1,
    ...(Platform.OS === 'web' && {
      overflow: 'auto' as any,
      flexShrink: 1,
    }),
  },
  scrollContent: {
    paddingBottom: 140,
    marginBottom: 20,
    overflow: 'scroll' as any ,
    flexGrow: 1,
    ...(Platform.OS === 'web' && {
      height: '0px' as any,
    }),
  },
  section: {
    padding: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 4,
    gap: 10,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  sectionHeaderTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  input: {
    marginBottom: 20,
  },
  calculationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 8,
    marginTop: 12,
    backgroundColor: colors.surface,
  },
  calculationLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  calculationValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
  },
  summarySection: {
    margin: 20,
    padding: 20,
    borderRadius: 8,
    elevation: 3,
    backgroundColor: colors.surface,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 14,
    color: colors.onSurface,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    marginVertical: 12,
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
  travelCard: {
    borderRadius: 8,
    padding: 14,
    backgroundColor: colors.surface,
    marginBottom: 12,
  },
  travelCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  travelCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  travelDistance: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  travelPercent: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
  },
  travelFuelText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  travelButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  travelStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  travelStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  travelStepperBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  travelStepperBtnPressed: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    transform: [{ scale: 0.9 }],
  },
  travelStepperInput: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    minWidth: 36,
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  travelStepperUnit: {
    fontSize: 13,
    color: colors.textMuted,
    marginLeft: 8,
  },
  travelDismissBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  travelDismissText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#ef4444',
  },
  travelDismissedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  travelDismissedText: {
    fontSize: 14,
    color: colors.onSurface,
  },
  travelUndoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  travelUndoText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.primary,
  },
  travelHintText: {
    fontSize: 13,
    color: colors.onSurface,
    fontStyle: 'italic',
  },
  travelCtaText: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 12,
    lineHeight: 20,
  },
  travelCtaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  travelCtaButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
});
