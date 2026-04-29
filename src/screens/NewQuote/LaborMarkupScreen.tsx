/**
 * Labor & Markup Screen
 * Set labor hours, rates, and markup percentage
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity, Pressable, TextInput as RNTextInput, Switch } from 'react-native';
import {
  Text,
  TextInput,
  Surface,
  Divider,
} from 'react-native-paper';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useStore } from '../../store/useStore';
import { useCurrentDocument, useDocumentMode, getPreviewScreenName } from '../../utils/documentMode';
import { LaborUnit } from '../../types';

import { colors } from '../../theme';
import { formatCurrency, calculateQuote } from '../../utils/quoteCalculator';
import { estimateFuelCost, DEFAULT_FUEL_PRICE } from '../../utils/travelCalculator';
import { checkSquareConnection } from '../../services/squareService';
import { QuoteSentBanner } from '../../components/QuoteSentBanner';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import { useTourRefs } from '../../components/tour/useTourRefs';
import { ScreenTour } from '../../components/tour/ScreenTour';
import { notifyScreenComplete, notifySkipRequest } from '../../components/tour/UnifiedTourController';
import { PHASE_STEP_OFFSETS, UNIFIED_TOUR_TOTAL_STEPS } from '../../components/tour/tourFlow';

export function LaborMarkupScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isEditFromPreview = route.params?.editing === true;
  const mode = useDocumentMode();
  const { document: currentDocument, update: updateDocument } = useCurrentDocument();
  const { saveDraft, businessSettings, unifiedTourActive, unifiedTourPhase } = useStore();

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

  // Deposit collection goes through Square — gate the toggle on connection.
  // Re-checked on every focus so returning from the Connect Square CTA flips
  // the toggle's availability without needing a reload.
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      checkSquareConnection()
        .then((res) => {
          if (cancelled) return;
          setSquareConnected(!!res.connected);
          if (!res.connected) setRequireDeposit(false);
        })
        .catch(() => {
          if (!cancelled) {
            setSquareConnected(false);
            setRequireDeposit(false);
          }
        });
      return () => { cancelled = true; };
    }, []),
  );

  const [laborHours, setLaborHours] = useState('');
  const [laborRate, setLaborRate] = useState('');
  const [laborUnit, setLaborUnit] = useState<LaborUnit>('hours');
  // Per-section displayed total hours (= section.laborHours × multiplier),
  // keyed by section.id. The user edits these directly via per-section steppers.
  // The estimated-total input above the Labour Total mirrors sumSections + extra,
  // where extra = (input value − sumSections) is derived and persisted as
  // quote.laborExtraHours on save.
  const [sectionTotalHoursMap, setSectionTotalHoursMap] = useState<Record<string, string>>({});
  const [markup, setMarkup] = useState('');
  const [laborMarkup, setLaborMarkup] = useState('');
  const [travelAdjustment, setTravelAdjustment] = useState('0');
  const [travelDismissed, setTravelDismissed] = useState(false);
  const [lastTravelValue, setLastTravelValue] = useState('0');
  const [showMarkup, setShowMarkup] = useState(false);
  const [showLaborBreakdown, setShowLaborBreakdown] = useState(true);
  const [depositPercentage, setDepositPercentage] = useState('');
  const [requireDeposit, setRequireDeposit] = useState(false);
  const [squareConnected, setSquareConnected] = useState<boolean | null>(null);
  const [warningDialogVisible, setWarningDialogVisible] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');

  const HOURS_PER_DAY = 8;

  useEffect(() => {
    if (currentQuote) {
      const hasSections = !!(currentQuote.sections && currentQuote.sections.length > 0);

      // Compute the section totals (in stored units — usually hours) and the
      // overall labour total = sum + laborExtraHours. The extra preserves any
      // buffer the user added on top of the per-section labour.
      let sectionsSumStored = 0;
      let totalHoursStored: number;
      let rateForInput: number;
      const sectionMap: Record<string, string> = {};

      if (hasSections && currentQuote.sections) {
        for (const s of currentQuote.sections) {
          const sectionTotal = (s.laborHours || 0) * (s.multiplier || 1);
          sectionsSumStored += sectionTotal;
          sectionMap[s.id] = sectionTotal.toString();
        }
        const firstNonZeroRate = currentQuote.sections.find((s) => (s.laborRate || 0) > 0)?.laborRate;
        rateForInput = firstNonZeroRate || currentQuote.laborRate || 0;
        totalHoursStored = sectionsSumStored + (currentQuote.laborExtraHours || 0);
      } else {
        totalHoursStored = currentQuote.laborHours;
        rateForInput = currentQuote.laborRate;
      }

      // Auto-default to days when the total is 6+ hours of work. Fires on
      // every load so legacy/sectioned quotes get the better default. The
      // section map gets converted to days too so the per-section steppers
      // are in the same unit as the input.
      if (totalHoursStored >= 6) {
        setLaborUnit('days');
        setLaborHours((Math.round((totalHoursStored / HOURS_PER_DAY) * 10) / 10).toString());
        setLaborRate((rateForInput * HOURS_PER_DAY).toString());
        if (hasSections) {
          const daysMap: Record<string, string> = {};
          for (const [id, val] of Object.entries(sectionMap)) {
            const num = parseFloat(val) || 0;
            daysMap[id] = (Math.round((num / HOURS_PER_DAY) * 10) / 10).toString();
          }
          setSectionTotalHoursMap(daysMap);
        }
      } else {
        setLaborUnit(currentQuote.laborUnit || 'hours');
        setLaborHours((Math.round(totalHoursStored * 10) / 10).toString());
        setLaborRate(rateForInput.toString());
        if (hasSections) {
          const tidyMap: Record<string, string> = {};
          for (const [id, val] of Object.entries(sectionMap)) {
            const num = parseFloat(val) || 0;
            tidyMap[id] = (Math.round(num * 10) / 10).toString();
          }
          setSectionTotalHoursMap(tidyMap);
        }
      }

      setMarkup(currentQuote.markup.toString());
      const lm = currentQuote.laborMarkup ?? currentQuote.markup ?? 0;
      setLaborMarkup(lm.toString());
      setShowMarkup(currentQuote.showMarkup === true);
      setShowLaborBreakdown(currentQuote.showLaborBreakdown !== false);
      const dp = currentQuote.depositPercentage ?? businessSettings?.defaultDepositPercentage ?? 0;
      setDepositPercentage(dp ? dp.toString() : '30');
      // Require-deposit toggle: quote-level override if set, otherwise business
      // default. Undefined on the quote means "inherit" — distinct from
      // explicit false. Once Square status is known, we'll force-off below if
      // disconnected so we never save requireDeposit=true without Square.
      const rd = currentQuote.requireDeposit !== undefined
        ? currentQuote.requireDeposit
        : (businessSettings?.requireDepositByDefault === true);
      setRequireDeposit(rd);
      const ta = (currentQuote.travelAdjustment || 0).toString();
      setTravelAdjustment(ta);
      setLastTravelValue(ta);
    }
  }, [currentQuote]);

  // Convert values when toggling between hours/days
  const handleToggleUnit = (newUnit: LaborUnit) => {
    if (newUnit === laborUnit) return;
    const currentValue = parseFloat(laborHours) || 0;
    const currentRate = parseFloat(laborRate) || 0;
    const factor = newUnit === 'days' ? 1 / HOURS_PER_DAY : HOURS_PER_DAY;
    const rateFactor = newUnit === 'days' ? HOURS_PER_DAY : 1 / HOURS_PER_DAY;

    setLaborHours(currentValue > 0 ? (Math.round(currentValue * factor * 10) / 10).toString() : '');
    setLaborRate(currentRate > 0 ? (currentRate * rateFactor).toString() : '');

    // Convert per-section displayed totals so they stay in the new unit.
    setSectionTotalHoursMap((prev) => {
      const next: Record<string, string> = {};
      for (const [id, val] of Object.entries(prev)) {
        const num = parseFloat(val) || 0;
        next[id] = num > 0 ? (Math.round(num * factor * 10) / 10).toString() : '';
      }
      return next;
    });

    setLaborUnit(newUnit);
  };

  // Stepper handlers — bumps the total labour up or down. Sensible defaults:
  // hours mode = ±1 hour per tap, days mode = ±0.5 days per tap.
  const stepperIncrement = laborUnit === 'days' ? 0.5 : 1;
  const handleStepHours = (delta: number) => {
    const current = parseFloat(laborHours) || 0;
    const next = Math.max(0, current + delta);
    setLaborHours((Math.round(next * 10) / 10).toString());
  };

  // Per-section stepper — adjusts a single section's displayed total hours
  // and bumps the global input by the same delta so the "extra" stays the
  // same (i.e. the per-section change flows through to the total).
  const handleStepSection = (sectionId: string, delta: number) => {
    const currentSection = parseFloat(sectionTotalHoursMap[sectionId] ?? '0') || 0;
    const newSection = currentSection + delta;
    if (newSection < 0) return;

    setSectionTotalHoursMap((prev) => ({
      ...prev,
      [sectionId]: (Math.round(newSection * 10) / 10).toString(),
    }));

    const currentTotal = parseFloat(laborHours) || 0;
    const newTotal = Math.max(0, currentTotal + delta);
    setLaborHours((Math.round(newTotal * 10) / 10).toString());
  };

  // Save changes when navigating back
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      if (!currentQuote) return;

      const hasSections = !!(currentQuote.sections && currentQuote.sections.length > 0);
      const rate = parseFloat(laborRate) || 0;
      const unit = laborUnit;
      const hours = parseFloat(laborHours) || 0;

      // Build updated sections from the per-section state. Round per-unit
      // laborHours to 2dp on save so persisted data is reasonable, and
      // recompute laborTotal so it stays consistent with the rounded value.
      let sectionsSumLocal = 0;
      const editedSectionsLocal = hasSections && currentQuote.sections
        ? currentQuote.sections.map((s) => {
            const sectionTotalDisplayed = parseFloat(sectionTotalHoursMap[s.id] ?? '0') || 0;
            sectionsSumLocal += sectionTotalDisplayed;
            const mul = s.multiplier || 1;
            const perUnitHoursRounded = mul > 0
              ? Math.round((sectionTotalDisplayed / mul) * 100) / 100
              : 0;
            return {
              ...s,
              laborHours: perUnitHoursRounded,
              laborHoursTotal: Math.round(perUnitHoursRounded * mul * 100) / 100,
              laborRate: rate,
              laborUnit: unit,
              laborTotal: Math.round(perUnitHoursRounded * rate * mul * 100) / 100,
            };
          })
        : undefined;

      // Extra is the buffer between the user-entered total and the section sum.
      const extraHoursLocal = hasSections
        ? Math.round((hours - sectionsSumLocal) * 10) / 10
        : 0;

      const markupPercent = parseFloat(markup) || 0;
      const laborMarkupPercent = parseFloat(laborMarkup) || 0;
      const travelPct = travelDismissed ? 0 : (parseFloat(travelAdjustment) || 0);

      const calculation = calculateQuote(
        currentQuote.materials,
        rate,
        hours,
        markupPercent,
        travelPct,
        editedSectionsLocal ?? currentQuote.sections,
        laborMarkupPercent,
        extraHoursLocal
      );

      // Save labor and calculated values before leaving. Both updateQuote
      // (sync, in-memory) and saveDraft (persists) are needed — gesture-back
      // without saveDraft would leave the edit only in currentQuote and risk
      // losing it to a stale snapshot or app quit.
      const updatedQuote = {
        ...currentQuote,
        ...(editedSectionsLocal ? { sections: editedSectionsLocal } : {}),
        laborHours: hours,
        laborRate: rate,
        laborUnit: unit,
        laborExtraHours: extraHoursLocal,
        markup: markupPercent,
        laborMarkup: laborMarkupPercent,
        showMarkup,
        showLaborBreakdown,
        travelAdjustment: travelPct,
        laborTotal: calculation.laborTotal,
        materialsSubtotal: calculation.materialsSubtotal,
        subtotal: calculation.subtotal,
        markupAmount: calculation.markupAmount,
        gst: calculation.gst,
        total: calculation.total,
        requireDeposit,
        depositPercentage: Math.max(0, Math.min(100, parseFloat(depositPercentage) || 0)),
        depositAmount: (() => {
          if (!requireDeposit) return 0;
          const pct = Math.max(0, Math.min(100, parseFloat(depositPercentage) || 0));
          return pct > 0 ? Math.round(calculation.total * (pct / 100) * 100) / 100 : 0;
        })(),
      };
      updateQuote(updatedQuote);
      saveDraft(updatedQuote);
    });

    return unsubscribe;
  }, [navigation, currentQuote, laborHours, laborRate, laborUnit, sectionTotalHoursMap, markup, laborMarkup, showMarkup, showLaborBreakdown, travelAdjustment, travelDismissed, depositPercentage, requireDeposit, updateQuote, saveDraft]);

  if (!currentQuote) {
    return null;
  }

  // Calculate totals in real-time. In sections mode the user edits each
  // section's total hours via per-section steppers; the input above the
  // Labour Total mirrors sumSections + extra. Extra is derived from the
  // input value − sumSections and persisted as quote.laborExtraHours.
  const hasSectionsMode = !!(currentQuote.sections && currentQuote.sections.length > 0);
  const rate = parseFloat(laborRate) || 0;
  const effectiveLaborUnit = laborUnit;
  const totalHoursInput = parseFloat(laborHours) || 0;

  // Build edited sections from the per-section state. laborHours per unit is
  // derived from displayedTotal / multiplier — kept precise for accurate calc.
  const editedSections = hasSectionsMode && currentQuote.sections
    ? currentQuote.sections.map((s) => {
        const sectionTotalHours = parseFloat(sectionTotalHoursMap[s.id] ?? '0') || 0;
        const mul = s.multiplier || 1;
        const perUnitHours = mul > 0 ? sectionTotalHours / mul : 0;
        return {
          ...s,
          laborHours: perUnitHours,
          laborHoursTotal: Math.round(perUnitHours * mul * 100) / 100,
          laborRate: rate,
          laborUnit: effectiveLaborUnit,
          laborTotal: perUnitHours * rate * mul,
        };
      })
    : undefined;

  // Sum of section displayed totals (in current unit) and the derived extra.
  const sectionsSumDisplayed = editedSections
    ? editedSections.reduce((sum, s) => sum + s.laborHours * (s.multiplier || 1), 0)
    : 0;
  const extraHoursDerived = hasSectionsMode
    ? Math.round((totalHoursInput - sectionsSumDisplayed) * 10) / 10
    : 0;

  // Top-level hours mirror the input value for legacy consumers.
  const hours = totalHoursInput;

  const markupPercent = parseFloat(markup) || 0;
  const laborMarkupPercent = parseFloat(laborMarkup) || 0;
  const travelPct = travelDismissed ? 0 : (parseFloat(travelAdjustment) || 0);

  const calculation = calculateQuote(
    currentQuote.materials,
    rate,
    hours,
    markupPercent,
    travelPct,
    editedSections ?? currentQuote.sections,
    laborMarkupPercent,
    extraHoursDerived
  );

  // Helper: unit labels
  const unitLabel = laborUnit === 'days' ? 'days' : 'hrs';
  const unitRateLabel = laborUnit === 'days' ? '/day' : '/hr';
  const unitInputLabel = laborUnit === 'days' ? 'Estimated Days' : 'Estimated Hours';

  const estimatedDistance = currentQuote.estimatedDistance;
  const fuelCost = estimatedDistance ? estimateFuelCost(estimatedDistance) : 0;
  const hasBusinessAddress = !!businessSettings?.address;
  const hasJobAddress = !!currentQuote.jobAddress;
  const geocodeFailed = !!currentQuote.travelGeocodeFailed;

  const handleSaveAndReturn = () => {
    if (!currentQuote) return;
    const updatedQuote = {
      ...currentQuote,
      ...(editedSections ? { sections: editedSections } : {}),
      laborHours: hours,
      laborRate: rate,
      laborUnit: effectiveLaborUnit,
      laborExtraHours: extraHoursDerived,
      markup: markupPercent,
      laborMarkup: laborMarkupPercent,
      showMarkup,
      showLaborBreakdown,
      travelAdjustment: travelPct,
      laborTotal: calculation.laborTotal,
      materialsSubtotal: calculation.materialsSubtotal,
      subtotal: calculation.subtotal,
      markupAmount: calculation.markupAmount,
      gst: calculation.gst,
      total: calculation.total,
    };
    updateQuote(updatedQuote);
    saveDraft(updatedQuote);
    navigation.goBack();
  };

  const handleNext = () => {
    // In sections mode, the real labour total is calculation.laborTotal (summed
    // from sections), not hours × rate at top level. Validate against the real
    // total instead so a sectioned quote with non-zero per-section labour
    // doesn't trip the "Zero Labor Cost" warning.
    const zeroLabour = hasSectionsMode
      ? calculation.laborTotal === 0
      : (hours === 0 || rate === 0);
    if (zeroLabour) {
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
      ...(editedSections ? { sections: editedSections } : {}),
      laborHours: hours,
      laborRate: rate,
      laborUnit: effectiveLaborUnit,
      laborExtraHours: extraHoursDerived,
      markup: markupPercent,
      laborMarkup: laborMarkupPercent,
      showMarkup,
      showLaborBreakdown,
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
        <QuoteSentBanner quote={currentQuote} />
        {/* Labor Section */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionLine} />
          <Text style={styles.sectionHeaderTitle}>LABOUR</Text>
          <View style={styles.sectionLine} />
        </View>

        <View ref={laborSectionRef} style={styles.section}>
        {/* Hours/Days Toggle */}
        <View style={styles.unitToggleRow}>
          <TouchableOpacity
            style={[styles.unitToggleBtn, laborUnit === 'hours' && styles.unitToggleBtnActive]}
            onPress={() => handleToggleUnit('hours')}
          >
            <Text style={[styles.unitToggleText, laborUnit === 'hours' && styles.unitToggleTextActive]}>Hours</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.unitToggleBtn, laborUnit === 'days' && styles.unitToggleBtnActive]}
            onPress={() => handleToggleUnit('days')}
          >
            <Text style={[styles.unitToggleText, laborUnit === 'days' && styles.unitToggleTextActive]}>Days</Text>
          </TouchableOpacity>
        </View>

        {/* Rate input */}
        <TextInput
          label={laborUnit === 'days' ? 'Daily Rate' : 'Hourly Rate'}
          value={laborRate}
          onChangeText={setLaborRate}
          mode="outlined"
          keyboardType="decimal-pad"
          left={<TextInput.Affix text="$" />}
          right={<TextInput.Affix text={unitRateLabel} />}
          style={styles.input}
        />

        {/* Sections breakdown — each row has small ± steppers that adjust
            the section's displayed total hours. Pressing ± also bumps the
            global input by the same amount so "extra" stays the same. */}
        {hasSectionsMode && currentQuote.sections && currentQuote.sections.length > 0 && (
          <View style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Distribution across {currentQuote.sections.length} sections
            </Text>
            {currentQuote.sections.map((s) => {
              const sectionTotalHours = parseFloat(sectionTotalHoursMap[s.id] ?? '0') || 0;
              const sectionDollars = sectionTotalHours * rate;
              const canDecrement = sectionTotalHours > 0;
              return (
                <View
                  key={s.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ fontSize: 13, color: colors.text, flex: 1 }} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <TouchableOpacity
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      backgroundColor: colors.primary + '15',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 4,
                    }}
                    onPress={() => handleStepSection(s.id, -stepperIncrement)}
                    disabled={!canDecrement}
                  >
                    <MaterialCommunityIcons
                      name="minus"
                      size={16}
                      color={canDecrement ? colors.primary : colors.textMuted}
                    />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 12, color: colors.textMuted, minWidth: 56, textAlign: 'center' }}>
                    {sectionTotalHours.toFixed(1)} {unitLabel}
                  </Text>
                  <TouchableOpacity
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      backgroundColor: colors.primary + '15',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: 4,
                      marginRight: 8,
                    }}
                    onPress={() => handleStepSection(s.id, stepperIncrement)}
                  >
                    <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 13, color: colors.text, fontWeight: '600', minWidth: 70, textAlign: 'right' }}>
                    {formatCurrency(sectionDollars)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Extra/minus label — only shown when there's a non-zero buffer
            between the user's estimated total and the section sum. Editing
            the input below directly adjusts this. */}
        {hasSectionsMode && extraHoursDerived !== 0 && (
          <Text
            style={{
              fontSize: 12,
              color: extraHoursDerived > 0 ? colors.primary : colors.warning,
              marginBottom: 8,
              fontWeight: '600',
            }}
          >
            {extraHoursDerived > 0 ? 'Extra' : 'Adjustment'}: {extraHoursDerived > 0 ? '+' : ''}
            {extraHoursDerived.toFixed(1)} {unitLabel}
          </Text>
        )}

        {/* Hours input with stepper buttons — sits right above the total. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <TouchableOpacity
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              backgroundColor: colors.primary + '15',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onPress={() => handleStepHours(-stepperIncrement)}
            disabled={(parseFloat(laborHours) || 0) <= 0}
          >
            <MaterialCommunityIcons
              name="minus"
              size={22}
              color={(parseFloat(laborHours) || 0) <= 0 ? colors.textMuted : colors.primary}
            />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <TextInput
              label={unitInputLabel}
              value={laborHours}
              onChangeText={setLaborHours}
              mode="outlined"
              keyboardType="decimal-pad"
              right={<TextInput.Affix text={unitLabel} />}
              style={{ marginBottom: 0 }}
            />
          </View>
          <TouchableOpacity
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              backgroundColor: colors.primary + '15',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onPress={() => handleStepHours(stepperIncrement)}
          >
            <MaterialCommunityIcons name="plus" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Labour Total */}
        <Surface style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Labour Total</Text>
          <Text style={styles.calculationValue}>
            {formatCurrency(calculation.laborTotal)}
          </Text>
        </Surface>

        {hasSectionsMode && (
          <View style={styles.showMarkupToggle}>
            <View style={{ flex: 1 }}>
              <Text style={styles.showMarkupTitle}>Show labour breakdown on PDFs</Text>
              <Text style={styles.showMarkupSubtitle}>
                When off, only the labour total appears on the document — per-section rows are hidden
              </Text>
            </View>
            <Switch
              value={showLaborBreakdown}
              onValueChange={setShowLaborBreakdown}
              trackColor={{ false: '#D1D5DB', true: colors.primary + '60' }}
              thumbColor={showLaborBreakdown ? colors.primary : '#F3F4F6'}
            />
          </View>
        )}
      </View>

      {/* Markup Section */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionLine} />
        <Text style={styles.sectionHeaderTitle}>MARKUP</Text>
        <View style={styles.sectionLine} />
      </View>

      <View ref={markupSectionRef} style={styles.section}>
        <TextInput
          label="Material Markup"
          value={markup}
          onChangeText={setMarkup}
          mode="outlined"
          keyboardType="decimal-pad"
          right={<TextInput.Affix text="%" />}
          style={styles.input}
        />

        <TextInput
          label="Labour Markup"
          value={laborMarkup}
          onChangeText={setLaborMarkup}
          mode="outlined"
          keyboardType="decimal-pad"
          right={<TextInput.Affix text="%" />}
          style={styles.input}
        />

        <Surface style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Total Markup</Text>
          <Text style={styles.calculationValue}>
            {formatCurrency(calculation.markupAmount)}
          </Text>
        </Surface>

        <View style={styles.showMarkupToggle}>
          <View style={{ flex: 1 }}>
            <Text style={styles.showMarkupTitle}>Show markup on quote</Text>
            <Text style={styles.showMarkupSubtitle}>
              When off, markup is included in the total but not shown as a separate line to the customer
            </Text>
          </View>
          <Switch
            value={showMarkup}
            onValueChange={setShowMarkup}
            trackColor={{ false: '#D1D5DB', true: colors.primary + '60' }}
            thumbColor={showMarkup ? colors.primary : '#F3F4F6'}
          />
        </View>
      </View>

      {/* Deposit Section */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionLine} />
        <Text style={styles.sectionHeaderTitle}>DEPOSIT</Text>
        <View style={styles.sectionLine} />
      </View>

      <View style={styles.section}>
        <View style={styles.showMarkupToggle}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.showMarkupTitle, squareConnected === false && { color: colors.textSecondary }]}>Require deposit on acceptance</Text>
            <Text style={styles.showMarkupSubtitle}>
              {squareConnected === false
                ? 'Connect Square to collect deposits from customers when they accept.'
                : "Customer pays a deposit via Square to lock in the job. Remainder is invoiced when work's done."}
            </Text>
          </View>
          <Switch
            value={requireDeposit && squareConnected !== false}
            onValueChange={setRequireDeposit}
            trackColor={{ false: '#D1D5DB', true: colors.primary + '60' }}
            thumbColor={requireDeposit ? colors.primary : '#F3F4F6'}
            disabled={squareConnected !== true}
          />
        </View>

        {squareConnected === false && (
          <TouchableOpacity
            onPress={() => navigation.navigate('SquareIntegration' as never)}
            style={{
              alignSelf: 'flex-start',
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: colors.primary,
              marginTop: 8,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>Connect Square</Text>
          </TouchableOpacity>
        )}

        {requireDeposit && squareConnected === true && (
          <>
            <TextInput
              label="Deposit"
              value={depositPercentage}
              onChangeText={setDepositPercentage}
              mode="outlined"
              keyboardType="decimal-pad"
              placeholder="30"
              right={<TextInput.Affix text="%" />}
              style={styles.input}
            />
            {(() => {
              const pct = Math.max(0, Math.min(100, parseFloat(depositPercentage) || 0));
              if (pct <= 0) return null;
              const amount = Math.round(calculation.total * (pct / 100) * 100) / 100;
              return (
                <Surface style={styles.calculationRow}>
                  <Text style={styles.calculationLabel}>Deposit due on acceptance</Text>
                  <Text style={styles.calculationValue}>{formatCurrency(amount)}</Text>
                </Surface>
              );
            })()}
          </>
        )}
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
          <Text style={styles.summaryLabel}>Markup</Text>
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
          label={isEditFromPreview ? 'Save' : (mode === 'invoice' ? "Next: Preview Invoice" : "Next: Preview Quote")}
          onPress={isEditFromPreview ? handleSaveAndReturn : handleNext}
          disableKeyboardSticky
        />
      </View>

      {/* Screen Tour */}
      {unifiedTourActive && unifiedTourPhase === 'laborMarkup' && (
        <ScreenTour
          tourId="laborMarkup"
          onActiveChange={setTourActive}
          scrollRef={scrollRef}
          scrollPositions={{ laborSection: 0, markupSection: 300 }}
          unifiedMode={true}
          onScreenComplete={() => notifyScreenComplete('laborMarkup')}
          onSkipRequest={notifySkipRequest}
          stepOffset={PHASE_STEP_OFFSETS.laborMarkup}
          globalTotalSteps={UNIFIED_TOUR_TOTAL_STEPS}
        />
      )}
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
  showMarkupToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 12,
  },
  showMarkupTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  showMarkupSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  // Hours/Days toggle
  unitToggleRow: {
    flexDirection: 'row',
    marginBottom: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  unitToggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  unitToggleBtnActive: {
    backgroundColor: colors.primary,
  },
  unitToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  unitToggleTextActive: {
    color: '#FFFFFF',
  },
});
