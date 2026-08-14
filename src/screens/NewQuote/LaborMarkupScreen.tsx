/**
 * Labor & Markup Screen
 * Set labor hours, rates, and markup percentage
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, Platform, TouchableOpacity, Pressable, TextInput as RNTextInput, Switch } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import {
  Text,
  TextInput,
  Surface,
  Divider,
} from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useStore } from '../../store/useStore';
import { GridBackground } from '../../components/GridBackground';
import { useCurrentDocument, useDocumentMode, usePersistDocument, getPreviewScreenName } from '../../utils/documentMode';
import { LaborUnit } from '../../types';

import { makeStyles, useThemeColors } from '../../theme';
import {
  hoursForDisplay,
  hoursFromDisplay,
  rateForDisplay,
  hourlyRateFromDisplay,
} from '../../../shared/document/labourUnits';
import { hydrateLabourEditor, applyLabourEditor } from '../../utils/labourEditor';
import { formatCurrency, calculateQuote } from '../../utils/quoteCalculator';
import { estimateFuelCost, DEFAULT_FUEL_PRICE } from '../../utils/travelCalculator';
import { QuoteSentBanner } from '../../components/QuoteSentBanner';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';

export function LaborMarkupScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isEditFromPreview = route.params?.editing === true;
  const mode = useDocumentMode();
  const { document: currentDocument, update: updateDocument } = useCurrentDocument();
  const persistDocument = usePersistDocument();
  const businessSettings = useStore((s) => s.businessSettings);

  // For compatibility, alias to currentQuote (used throughout this file)
  const currentQuote = currentDocument;
  const updateQuote = updateDocument;

  // Get the appropriate preview screen based on mode
  const previewScreenName = getPreviewScreenName(mode);

  // All three of these hold DISPLAY-space values, in whatever `laborUnit` is
  // currently showing. Canonical hours / $-per-hour are derived on save via
  // hoursFromDisplay + hourlyRateFromDisplay, never accumulated in state.
  const [laborHours, setLaborHours] = useState('');
  const [laborRate, setLaborRate] = useState('');
  const [laborUnit, setLaborUnit] = useState<LaborUnit>('hours');
  // Per-section displayed totals (= section.laborHours × multiplier, converted
  // to the display unit), keyed by section.id. The user edits these directly
  // via per-section steppers. The estimated-total input above the Labour Total
  // mirrors sumSections + extra, where extra = (input value − sumSections) is
  // derived and persisted as quote.laborExtraHours on save.
  const [sectionTotalHoursMap, setSectionTotalHoursMap] = useState<Record<string, string>>({});
  const [markup, setMarkup] = useState('');
  const [laborMarkup, setLaborMarkup] = useState('');
  const [travelAdjustment, setTravelAdjustment] = useState('0');
  const [travelDismissed, setTravelDismissed] = useState(false);
  const [lastTravelValue, setLastTravelValue] = useState('0');
  // Read, never written: "What the customer sees" on the preview screen is
  // now the single control for document detail, and it supersedes this. The
  // value is carried through untouched so an existing document keeps
  // rendering the way its author left it.
  const [showLaborBreakdown, setShowLaborBreakdown] = useState(true);
  const [warningDialogVisible, setWarningDialogVisible] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');

  // Tracks what has already been hydrated into local state. We intentionally
  // do NOT re-hydrate on every currentQuote change — the LaborMarkupScreen
  // stays mounted in the React Navigation stack while the user dives into
  // MaterialsListScreen to edit prices, and re-firing this effect on each
  // price tweak would stomp edits the user has in progress.
  //
  // The key includes the section IDs, so adding or removing a section over in
  // the materials screen DOES re-hydrate. Without that, the per-section map
  // here would not know about the new section and the save below would treat
  // its hours as a negative "extra" buffer — cancelling out the labour the
  // user just added. Price tweaks don't change the key, so in-progress edits
  // still survive.
  const hydratedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentQuote) return;
    const hydrationKey = `${currentQuote.id}::${(currentQuote.sections || []).map((s) => s.id).join(',')}`;
    if (hydratedKeyRef.current === hydrationKey) return;
    hydratedKeyRef.current = hydrationKey;

    // Days vs hours is purely how we render. Because the displayed rate is
    // always derived from the canonical hourly rate rather than from whatever
    // was last on screen, re-hydrating is idempotent: entering this screen ten
    // times cannot move the price. See labourEditor.test.ts.
    const editorState = hydrateLabourEditor(currentQuote);
    setLaborUnit(editorState.displayUnit);
    setLaborHours(editorState.totalInput);
    setLaborRate(editorState.rateInput);
    if (currentQuote.sections && currentQuote.sections.length > 0) {
      setSectionTotalHoursMap(editorState.sectionTotals);
    }

    setMarkup(currentQuote.markup.toString());
    const lm = currentQuote.laborMarkup ?? currentQuote.markup ?? 0;
    setLaborMarkup(lm.toString());
    setShowLaborBreakdown(currentQuote.showLaborBreakdown !== false);
    const ta = (currentQuote.travelAdjustment || 0).toString();
    setTravelAdjustment(ta);
    setLastTravelValue(ta);
  }, [currentQuote]);

  // Re-render the same labour in the other unit. Every value goes back to
  // canonical hours / $-per-hour and out again, so the toggle is a pure
  // change of presentation — the price the customer sees never moves.
  const handleToggleUnit = (newUnit: LaborUnit) => {
    if (newUnit === laborUnit) return;
    const currentValue = parseFloat(laborHours) || 0;
    const currentRate = parseFloat(laborRate) || 0;
    const reDisplay = (v: number) => hoursForDisplay(hoursFromDisplay(v, laborUnit), newUnit);

    setLaborHours(currentValue > 0 ? (Math.round(reDisplay(currentValue) * 10) / 10).toString() : '');
    setLaborRate(
      currentRate > 0
        ? String(rateForDisplay(hourlyRateFromDisplay(currentRate, laborUnit), newUnit))
        : '',
    );

    // Convert per-section displayed totals so they stay in the new unit.
    setSectionTotalHoursMap((prev) => {
      const next: Record<string, string> = {};
      for (const [id, val] of Object.entries(prev)) {
        const num = parseFloat(val) || 0;
        next[id] = num > 0 ? (Math.round(reDisplay(num) * 10) / 10).toString() : '';
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

  /**
   * Turn the display-space editor state back into a canonical document:
   * quantities in hours, rate in $/hour, `laborUnit: 'hours'`, and the days
   * preference recorded separately in `labourDisplayUnit`.
   *
   * Every exit from this screen (gesture-back, Save, Next) goes through here,
   * so there is no path that writes labour in one shape and another path that
   * reads it in a different one.
   */
  const buildCanonicalUpdate = React.useCallback(() => {
    if (!currentQuote) return null;

    const patch = applyLabourEditor(currentQuote, {
      displayUnit: laborUnit,
      totalInput: laborHours,
      rateInput: laborRate,
      sectionTotals: sectionTotalHoursMap,
    });

    const markupPercent = parseFloat(markup) || 0;
    const laborMarkupPercent = parseFloat(laborMarkup) || 0;
    const travelPct = travelDismissed ? 0 : (parseFloat(travelAdjustment) || 0);

    const calculation = calculateQuote(
      currentQuote.materials,
      patch.laborRate,
      patch.laborHours,
      markupPercent,
      travelPct,
      patch.sections ?? currentQuote.sections,
      laborMarkupPercent,
      patch.laborExtraHours,
      currentQuote.pricesIncludeGst === true,
      currentQuote.gstRegistered !== false,
    );

    return {
      update: {
        ...currentQuote,
        ...patch,
        markup: markupPercent,
        laborMarkup: laborMarkupPercent,
        showLaborBreakdown,
        travelAdjustment: travelPct,
        laborTotal: calculation.laborTotal,
        materialsSubtotal: calculation.materialsSubtotal,
        subtotal: calculation.subtotal,
        markupAmount: calculation.markupAmount,
        gst: calculation.gst,
        total: calculation.total,
      },
      calculation,
      travelPct,
      markupPercent,
      laborMarkupPercent,
    };
  }, [currentQuote, laborHours, laborRate, laborUnit, sectionTotalHoursMap, markup, laborMarkup, showLaborBreakdown, travelAdjustment, travelDismissed]);

  // Save changes when navigating back
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      // Save labor and calculated values before leaving. Both updateQuote
      // (sync, in-memory) and saveDraft (persists) are needed — gesture-back
      // without saveDraft would leave the edit only in currentQuote and risk
      // losing it to a stale snapshot or app quit.
      const built = buildCanonicalUpdate();
      if (!built) return;
      updateQuote(built.update);
      persistDocument(built.update);
    });

    return unsubscribe;
  }, [navigation, buildCanonicalUpdate, updateQuote, persistDocument]);

  if (!currentQuote) {
    return null;
  }

  // Live totals for the screen. The editor state is display-space, so the
  // canonical builder is the single place that converts back to hours — the
  // preview below and every save path read from the same object, which is
  // what stops the displayed price and the saved price from diverging.
  const hasSectionsMode = !!(currentQuote.sections && currentQuote.sections.length > 0);
  const rate = parseFloat(laborRate) || 0;
  const totalHoursInput = parseFloat(laborHours) || 0;
  const built = buildCanonicalUpdate()!;
  const canonicalUpdate = built.update;
  const calculation = built.calculation;
  const travelPct = built.travelPct;

  // Extra buffer, expressed in the unit on screen so the label matches the
  // inputs the user is looking at.
  const extraHoursDerived = Math.round(
    hoursForDisplay(canonicalUpdate.laborExtraHours ?? 0, laborUnit) * 10,
  ) / 10;

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
    const updatedQuote = canonicalUpdate;
    if (!updatedQuote) return;
    updateQuote(updatedQuote);
    persistDocument(updatedQuote);
    navigation.goBack();
  };

  const handleNext = () => {
    // In sections mode, the real labour total is calculation.laborTotal (summed
    // from sections), not hours × rate at top level. Validate against the real
    // total instead so a sectioned quote with non-zero per-section labour
    // doesn't trip the "Zero Labor Cost" warning.
    const zeroLabour = hasSectionsMode
      ? calculation.laborTotal === 0
      : (totalHoursInput === 0 || rate === 0);
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
    if (!canonicalUpdate) return;
    const updatedQuote = {
      ...canonicalUpdate,
      draftStep: previewScreenName,
    };

    updateQuote(updatedQuote);
    persistDocument(updatedQuote);
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
        <QuoteSentBanner quote={currentQuote} />
        {/* Labor Section */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionLine} />
          <Text style={styles.sectionHeaderTitle}>LABOUR</Text>
          <View style={styles.sectionLine} />
        </View>

        <View style={styles.section}>
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
            <Text style={{ fontSize: 11, color: themeColors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Distribution across {currentQuote.sections.length} sections
            </Text>
            {currentQuote.sections.map((s) => {
              const sectionTotalHours = parseFloat(sectionTotalHoursMap[s.id] ?? '0') || 0;
              // Read the dollars from the same object the save writes, rather
              // than re-deriving them from the rate box: a section carrying its
              // own rate (a template applied at a different price) would
              // otherwise show a figure the save never produces.
              const sectionDollars =
                canonicalUpdate.sections?.find((x) => x.id === s.id)?.laborTotal
                ?? sectionTotalHours * rate;
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
                  <Text style={{ fontSize: 13, color: themeColors.text, flex: 1 }} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <TouchableOpacity
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      backgroundColor: themeColors.accentSubtle,
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
                      color={canDecrement ? themeColors.accent : themeColors.textMuted}
                    />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 12, color: themeColors.textMuted, minWidth: 56, textAlign: 'center' }}>
                    {sectionTotalHours.toFixed(1)} {unitLabel}
                  </Text>
                  <TouchableOpacity
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      backgroundColor: themeColors.accentSubtle,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: 4,
                      marginRight: 8,
                    }}
                    onPress={() => handleStepSection(s.id, stepperIncrement)}
                  >
                    <MaterialCommunityIcons name="plus" size={16} color={themeColors.accentText} />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 13, color: themeColors.text, fontWeight: '600', minWidth: 70, textAlign: 'right' }}>
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
              color: extraHoursDerived > 0 ? themeColors.accent : themeColors.warning,
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
              backgroundColor: themeColors.accentSubtle,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onPress={() => handleStepHours(-stepperIncrement)}
            disabled={(parseFloat(laborHours) || 0) <= 0}
          >
            <MaterialCommunityIcons
              name="minus"
              size={22}
              color={(parseFloat(laborHours) || 0) <= 0 ? themeColors.textMuted : themeColors.accent}
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
              backgroundColor: themeColors.accentSubtle,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onPress={() => handleStepHours(stepperIncrement)}
          >
            <MaterialCommunityIcons name="plus" size={22} color={themeColors.accentText} />
          </TouchableOpacity>
        </View>

        {/* Labour Total */}
        <Surface style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Labour Total</Text>
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

      <View style={styles.section}>
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
      </View>

      {/* Travel Adjustment Section */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionLine} />
        <Text style={styles.sectionHeaderTitle}>TRAVEL ADJUSTMENT</Text>
        <View style={styles.sectionLine} />
      </View>

      {estimatedDistance !== undefined ? (
        <View style={styles.section}>
          {!travelDismissed ? (
            <>
              <Surface style={styles.travelCard}>
                <View style={styles.travelCardTop}>
                  <View style={styles.travelCardIcon}>
                    <MaterialCommunityIcons name="map-marker-distance" size={20} color={themeColors.accentText} />
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
              <View style={styles.travelButtonsRow}>
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
                      <MaterialCommunityIcons name="minus" size={16} color={themeColors.text} />
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
                      <MaterialCommunityIcons name="plus" size={16} color={themeColors.text} />
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
                  <MaterialCommunityIcons name="close" size={14} color={themeColors.error} />
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
                <MaterialCommunityIcons name="restore" size={14} color={themeColors.accentText} />
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
                <MaterialCommunityIcons name="map-marker-plus" size={18} color={themeColors.accentText} />
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
                <MaterialCommunityIcons name="map-marker-plus" size={18} color={themeColors.accentText} />
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
                <MaterialCommunityIcons name="map-marker-alert" size={18} color={themeColors.accentText} />
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

      {/* Summary */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionLine} />
        <Text style={styles.sectionHeaderTitle}>{mode === 'invoice' ? 'INVOICE SUMMARY' : 'QUOTE SUMMARY'}</Text>
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

        {currentQuote.gstRegistered !== false && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              {currentQuote.pricesIncludeGst === true ? 'Includes GST' : 'GST (10%)'}
            </Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(calculation.gst)}
            </Text>
          </View>
        )}

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
    </>
  );

  // On web, return ScrollView directly. On mobile, wrap with KeyboardAvoidingView
  if (Platform.OS === 'web') {
    return scrollContent;
  }

  return (
    // keyboard-controller's KeyboardAvoidingView handles Android properly —
    // the RN built-in needed behavior=undefined to avoid layout glitches on
    // Android, which made it a no-op there (keyboard overlapped inputs).
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <GridBackground />
      {scrollContent}
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((t) => ({
  outerContainer: {
    flex: 1,
    backgroundColor: t.colors.bg,
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
    backgroundColor: t.colors.border,
  },
  sectionHeaderTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.textMuted,
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
    backgroundColor: t.colors.surfaceRaised,
  },
  calculationLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  calculationValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: t.colors.money,
  },
  summarySection: {
    margin: 20,
    padding: 20,
    borderRadius: 8,
    elevation: 3,
    backgroundColor: t.colors.surfaceRaised,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 14,
    color: t.colors.textSecondary,
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
    color: t.colors.money,
  },
  travelCard: {
    borderRadius: 8,
    padding: 14,
    backgroundColor: t.colors.surfaceRaised,
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
    backgroundColor: t.colors.moneySubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  travelDistance: {
    fontSize: 15,
    fontWeight: '500',
    color: t.colors.text,
  },
  travelPercent: {
    fontSize: 18,
    fontWeight: 'bold',
    color: t.colors.accentText,
  },
  travelFuelText: {
    fontSize: 12,
    color: t.colors.textMuted,
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
    backgroundColor: t.colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  travelStepperBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  travelStepperBtnPressed: {
    backgroundColor: t.colors.surfaceOverlay,
    transform: [{ scale: 0.9 }],
  },
  travelStepperInput: {
    fontSize: 15,
    fontWeight: '600',
    color: t.colors.text,
    minWidth: 36,
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: t.colors.border,
  },
  travelStepperUnit: {
    fontSize: 13,
    color: t.colors.textMuted,
    marginLeft: 8,
  },
  travelDismissBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: t.colors.errorSubtle,
  },
  travelDismissText: {
    fontSize: 13,
    fontWeight: '500',
    color: t.colors.error,
  },
  travelDismissedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  travelDismissedText: {
    fontSize: 14,
    color: t.colors.textSecondary,
  },
  travelUndoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: t.colors.moneySubtle,
  },
  travelUndoText: {
    fontSize: 13,
    fontWeight: '500',
    color: t.colors.accentText,
  },
  travelHintText: {
    fontSize: 13,
    color: t.colors.textSecondary,
    fontStyle: 'italic',
  },
  travelCtaText: {
    fontSize: 14,
    color: t.colors.textSecondary,
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
    borderColor: t.colors.accent,
    backgroundColor: t.colors.surfaceRaised,
  },
  travelCtaButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.accentText,
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
    color: t.colors.text,
  },
  showMarkupSubtitle: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  // Hours/Days toggle
  unitToggleRow: {
    flexDirection: 'row',
    marginBottom: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
    overflow: 'hidden',
  },
  unitToggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: t.colors.surfaceRaised,
  },
  unitToggleBtnActive: {
    backgroundColor: t.colors.accent,
  },
  unitToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
  unitToggleTextActive: {
    color: t.colors.onAccent,
  },
}));
