/**
 * Labor & Markup Screen
 * Set labor hours, rates, and markup percentage
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Surface,
  Title,
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
  const laborSectionRef = useRef<View>(null);
  const markupSectionRef = useRef<View>(null);

  useEffect(() => {
    if (travelSectionRef.current) registerRef('travelSection', travelSectionRef.current);
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
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
        <WebContainer>
        {/* Travel Adjustment Section */}
        {estimatedDistance !== undefined ? (
          <View ref={travelSectionRef} style={styles.section}>
            {!travelDismissed ? (
              <>
                <Title style={styles.sectionTitle}>Travel Adjustment</Title>
                <View style={styles.travelInfoRow}>
                  <Text style={styles.travelDistance}>~{estimatedDistance}km from your business</Text>
                  <Text style={styles.travelPercent}>+{travelPct}%</Text>
                </View>
                <Text style={styles.travelFuelText}>
                  Fuel ~${DEFAULT_FUEL_PRICE.toFixed(2)}/L · ~${formatCurrency(fuelCost)} round trip
                </Text>
                <View style={styles.travelButtonsRow}>
                  <TouchableOpacity
                    style={styles.travelButton}
                    onPress={() => {
                      const current = parseFloat(travelAdjustment) || 0;
                      const newVal = Math.max(0, current - 1).toString();
                      setTravelAdjustment(newVal);
                      setLastTravelValue(newVal);
                    }}
                  >
                    <MaterialCommunityIcons name="minus" size={20} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.travelButton}
                    onPress={() => {
                      const current = parseFloat(travelAdjustment) || 0;
                      const newVal = (current + 1).toString();
                      setTravelAdjustment(newVal);
                      setLastTravelValue(newVal);
                    }}
                  >
                    <MaterialCommunityIcons name="plus" size={20} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.travelButton}
                    onPress={() => {
                      setTravelDismissed(true);
                    }}
                  >
                    <MaterialCommunityIcons name="close" size={20} color={colors.onSurface} />
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={styles.travelDismissedRow}>
                <Text style={styles.travelDismissedText}>Travel adjustment dismissed</Text>
                <TouchableOpacity
                  onPress={() => {
                    setTravelDismissed(false);
                    setTravelAdjustment(lastTravelValue);
                  }}
                >
                  <Text style={styles.travelUndoText}>Undo</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          (!hasBusinessAddress || !hasJobAddress) && (
            <View style={styles.section}>
              <Text style={styles.travelHintText}>
                {!hasBusinessAddress
                  ? 'Set your business address in Settings to enable travel adjustment'
                  : 'Add a job address to enable travel adjustment'}
              </Text>
            </View>
          )
        )}

        <Divider />

        <View ref={laborSectionRef} style={styles.section}>
        <Title style={styles.sectionTitle}>Labor</Title>

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

      <Divider />

      <View ref={markupSectionRef} style={styles.section}>
        <Title style={styles.sectionTitle}>Markup</Title>

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

      <Divider />

      {/* Quote Summary */}
      <Surface style={styles.summarySection}>
        <Title style={styles.sectionTitle}>Quote Summary</Title>

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
      <ScreenTour tourId="laborMarkup" />
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
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
  travelInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  travelDistance: {
    fontSize: 14,
    color: colors.onSurface,
  },
  travelPercent: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.primary,
  },
  travelFuelText: {
    fontSize: 12,
    color: colors.onSurface,
    marginBottom: 12,
  },
  travelButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  travelButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.onSurface,
    justifyContent: 'center',
    alignItems: 'center',
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
  travelUndoText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  travelHintText: {
    fontSize: 13,
    color: colors.onSurface,
    fontStyle: 'italic',
  },
});
