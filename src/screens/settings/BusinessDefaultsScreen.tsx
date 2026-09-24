/**
 * Rates & GST Settings Screen (route: BusinessDefaults)
 *
 * How you price: default labour rate, markups, travel markup and the GST
 * mode. (Mate's auto-start mic moved to the Mate tab header.) Lifted out of BusinessProfileScreen so "who you are" stays separate
 * from "how you price". Everything that shapes the customer's document
 * (display, deposits, follow-ups, T&Cs, extra section) moved to
 * QuotesInvoicesScreen in Sep 2026 — this screen had grown to seven unrelated
 * cards. Route name kept so existing links keep working.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View } from 'react-native';
// Under edge-to-edge Android no longer resizes the window for the keyboard, so
// a form screen with a plain ScrollView leaves its fields behind it — and RN's
// own KeyboardAvoidingView is a no-op there too. This one shrinks the scroll
// area AND scrolls the focused field into view, which a bare
// KeyboardAvoidingView does not. Same shape as CustomerDetailsScreen. See
// components/keyboardAvoidance.guard.test.ts.
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  Text,
  TextInput,
  Surface,
  Title,
  Switch,
  SegmentedButtons,
} from 'react-native-paper';

import type { BusinessSettings } from '../../types';
import { useStore } from '../../store/useStore';
import { makeStyles, useThemeColors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { AlertModal } from '../../components/AlertModal';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { defaultAuTradieTerms, isUnmodifiedStarterTerms } from '../../../shared/pdf/terms/defaultAuTradie';
import { resolveGstMode, GstMode } from '../../../shared/document';
import { GridBackground } from '../../components/GridBackground';

const GST_MODE_DESCRIPTIONS: Record<GstMode, string> = {
  exclusive: 'Prices you enter are ex-GST. The quote adds 10% GST to the total.',
  inclusive: 'Prices you enter are inc-GST. The quote shows GST as a 1/11 disclosure.',
  none: 'For businesses not registered for GST. No GST is added or shown — quotes and invoices carry a "No GST has been charged" note.',
};

export function BusinessDefaultsScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const { businessSettings, setBusinessSettings } = useStore();

  const [laborRate, setLaborRate] = useState('85');
  // Edited on this visit — saving it makes the rate theirs (labourRateIsTheirs).
  const laborRateTouchedRef = useRef(false);
  const [markup, setMarkup] = useState('30');
  const [laborMarkup, setLaborMarkup] = useState('20');
  const [transportMarkupEnabled, setTransportMarkupEnabled] = useState(true);
  const [gstMode, setGstMode] = useState<GstMode>('exclusive');
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);

  useEffect(() => {
    if (!businessSettings) return;
    const lr = businessSettings.defaultLaborRate?.toString() || '85';
    const mk = businessSettings.defaultMarkup?.toString() || '30';
    const lm = (businessSettings.defaultLaborMarkup ?? businessSettings.defaultMarkup ?? 30).toString();
    const tm = businessSettings.transportMarkupEnabled !== false;
    const gm = resolveGstMode(businessSettings);

    setLaborRate(lr);
    setMarkup(mk);
    setLaborMarkup(lm);
    setTransportMarkupEnabled(tm);
    setGstMode(gm);
    setInitialSnapshot(JSON.stringify({ lr, mk, lm, tm, gm }));
  }, [businessSettings]);

  const isDirty = React.useMemo(() => {
    if (!initialSnapshot) return false;
    const current = JSON.stringify({
      lr: laborRate,
      mk: markup,
      lm: laborMarkup,
      tm: transportMarkupEnabled,
      gm: gstMode,
    });
    return current !== initialSnapshot;
  }, [
    laborRate, markup, laborMarkup, transportMarkupEnabled, gstMode,
    initialSnapshot,
  ]);

  const { unsavedModalProps } = useUnsavedChangesGuard({
    isDirty,
    onSave: async () => {
      const ok = await handleSave({ silent: true });
      return ok;
    },
  });

  const handleSave = async (opts?: { silent?: boolean }): Promise<boolean> => {
    try {
      setIsLoading(true);
      // Strip the retired card-surcharge flag so a save from this build never
      // writes a stale `true` back for an older installed build to act on.
      const { surchargePaymentFees: _retiredSurcharge, ...currentSettings } =
        businessSettings! as BusinessSettings & { surchargePaymentFees?: boolean };
      // The T&Cs live on Quotes & Invoices now, but the starter template
      // still carries a GST line — keep it in step with a GST change unless
      // the tradie has hand-edited the wording.
      const storedTerms = currentSettings.termsAndConditions ?? '';
      const syncStarterTerms =
        gstMode !== resolveGstMode(currentSettings) && isUnmodifiedStarterTerms(storedTerms);
      await setBusinessSettings({
        ...currentSettings,
        defaultLaborRate: parseFloat(laborRate) || 85,
        ...(laborRateTouchedRef.current || currentSettings.laborRateConfirmed ? { laborRateConfirmed: true } : {}),
        defaultMarkup: parseFloat(markup) || 30,
        defaultLaborMarkup: parseFloat(laborMarkup) || 0,
        transportMarkupEnabled,
        pricesIncludeGst: gstMode === 'inclusive',
        gstRegistered: gstMode !== 'none',
        ...(syncStarterTerms
          ? { termsAndConditions: defaultAuTradieTerms(gstMode), termsUpdatedAt: new Date().toISOString() }
          : {}),
      });
      // The store update triggers the hydration useEffect to re-derive form
      // state from the new businessSettings and refresh initialSnapshot.
      // Setting a second snapshot here would capture pre-normalization values
      // (e.g. '30.00' vs the re-derived '30') and leave isDirty true.
      if (!opts?.silent) setShowSuccessModal(true);
      return true;
    } catch {
      setShowErrorModal(true);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <GridBackground />
      <KeyboardAwareScrollView
        // Breathing room between the focused field and the keyboard top.
        bottomOffset={24}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <WebContainer>
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Default Rates</Title>
            <Text style={styles.helperText}>
              Applied to new quotes. Can be overridden per quote.
            </Text>

            <TextInput
              label="Hourly Labour Rate"
              value={laborRate}
              onChangeText={(text) => {
                laborRateTouchedRef.current = true;
                setLaborRate(text);
              }}
              mode="outlined"
              style={styles.input}
              keyboardType="decimal-pad"
              left={<TextInput.Affix text="$" />}
              right={<TextInput.Affix text="/hr" />}
            />

            <TextInput
              label="Material Markup"
              value={markup}
              onChangeText={setMarkup}
              mode="outlined"
              style={styles.input}
              keyboardType="decimal-pad"
              right={<TextInput.Affix text="%" />}
            />

            <TextInput
              label="Labour Markup"
              value={laborMarkup}
              onChangeText={setLaborMarkup}
              mode="outlined"
              style={styles.input}
              keyboardType="decimal-pad"
              right={<TextInput.Affix text="%" />}
            />

            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <Text style={styles.toggleTitle}>Transport / Logistics Markup</Text>
                <Text style={styles.toggleDescription}>
                  Auto-calculate travel markup based on job distance.
                </Text>
              </View>
              <Switch
                value={transportMarkupEnabled}
                onValueChange={setTransportMarkupEnabled}
                color={themeColors.accentText}
              />
            </View>

            <View style={styles.gstModeSection}>
              <Text style={styles.toggleTitle}>GST on quotes &amp; invoices</Text>
              <SegmentedButtons
                value={gstMode}
                onValueChange={(next) => setGstMode(next as GstMode)}
                buttons={[
                  { value: 'exclusive', label: 'Add 10%' },
                  { value: 'inclusive', label: 'Included' },
                  { value: 'none', label: 'Not registered' },
                ]}
                style={styles.gstModeButtons}
              />
              <Text style={styles.toggleDescription}>
                {GST_MODE_DESCRIPTIONS[gstMode]}
              </Text>
            </View>
          </Surface>

        </WebContainer>
      </KeyboardAwareScrollView>

      <FixedBottomButton
        label="Save"
        onPress={() => handleSave()}
        loading={isLoading}
        disabled={isLoading || !isDirty}
      />

      <AlertModal
        visible={showSuccessModal}
        type="success"
        title="Saved"
        message="Your rates and GST settings have been updated."
        onDismiss={() => setShowSuccessModal(false)}
      />
      <AlertModal
        visible={showErrorModal}
        type="error"
        title="Error"
        message="Couldn't save your settings. Please try again."
        onDismiss={() => setShowErrorModal(false)}
      />
      <AlertModal {...unsavedModalProps} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.colors.bg },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: t.colors.surfaceRaised,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: t.colors.text,
    marginBottom: 4,
  },
  helperText: {
    fontSize: 13,
    color: t.colors.textMuted,
    marginBottom: 12,
  },
  input: {
    marginBottom: 12,
    backgroundColor: t.colors.surfaceRaised,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  toggleLabel: { flex: 1, marginRight: 12 },
  gstModeSection: { paddingVertical: 10 },
  gstModeButtons: { marginTop: 8, marginBottom: 6 },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: t.colors.text,
  },
  toggleDescription: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
  },
}));
