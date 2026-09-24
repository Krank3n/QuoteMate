/**
 * Quotes & Invoices Settings Screen
 *
 * Everything that shapes the document the customer receives, in one place:
 * the template style, what money they see, deposits, follow-ups, the T&Cs and
 * the extra section. Split out of Business Defaults (Sep 2026), which had
 * grown to seven unrelated cards — the test for living here is "does it change
 * what my customer gets?". Pricing inputs (rate, markups, GST) stay on the
 * Rates & GST screen (BusinessDefaultsScreen).
 *
 * Same settings/business fields as before; only the screen moved, so older
 * installed builds keep reading and writing them unchanged.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Alert, TouchableOpacity } from 'react-native';
// Same keyboard handling as the other settings forms — see
// components/keyboardAvoidance.guard.test.ts.
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  Text,
  TextInput,
  Surface,
  Title,
  Button,
  Switch,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

import type { BusinessSettings } from '../../types';
import { useStore } from '../../store/useStore';
import { makeStyles, useThemeColors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { AlertModal } from '../../components/AlertModal';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { checkSquareConnection } from '../../services/squareService';
import { resolveAutoCustomerFollowUp } from '../../../shared/document/autoFollowUp';
import { defaultAuTradieTerms, hashTerms } from '../../../shared/pdf/terms/defaultAuTradie';
import { EXTRA_SECTION_TITLE_MAX, EXTRA_SECTION_BODY_MAX } from '../../../shared/pdf/extraSection';
import { PDF_TEMPLATES } from '../../../shared/pdf';
import {
  resolveGstMode,
  resolvePriceDetail,
  legacyFlagsFor,
  priceDetailBlurb,
  showsPerLineMoney,
  PRICE_DETAIL_OPTIONS,
  type PriceDetail,
} from '../../../shared/document';
import { PillToggle } from '../../components/PillToggle';
import { GridBackground } from '../../components/GridBackground';

export function QuotesInvoicesScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const { businessSettings, setBusinessSettings } = useStore();

  const [showMarkup, setShowMarkup] = useState(false);
  const [priceDetail, setPriceDetail] = useState<PriceDetail>('itemised');
  const [showLaborHours, setShowLaborHours] = useState(false);
  const [defaultDepositPercentage, setDefaultDepositPercentage] = useState('0');
  const [requireDepositByDefault, setRequireDepositByDefault] = useState(false);
  const [autoCustomerFollowUp, setAutoCustomerFollowUp] = useState(true);
  const [termsAndConditions, setTermsAndConditions] = useState('');
  const [extraSectionTitle, setExtraSectionTitle] = useState('');
  const [extraSectionBody, setExtraSectionBody] = useState('');
  // Collapsed to one button until there's something to show — same shape as
  // the T&Cs card, so an unused section doesn't cost two empty fields.
  const [extraSectionOpen, setExtraSectionOpen] = useState(false);

  const [squareConnected, setSquareConnected] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);

  const laborHoursApplicable = showsPerLineMoney(priceDetail);
  // GST is set on Rates & GST; the starter terms follow it.
  const gstMode = resolveGstMode(businessSettings ?? {});
  const templateId = businessSettings?.pdfTemplate || 'professional';
  const templateName = PDF_TEMPLATES.find((t) => t.id === templateId)?.name ?? 'Professional';

  useEffect(() => {
    if (!businessSettings) return;
    const sm = businessSettings.showMarkup === true;
    // Resolved, never read raw — an account that only ever set the legacy
    // pair migrates on read with no backfill.
    const pd = resolvePriceDetail(null, businessSettings);
    const slh = businessSettings.showLaborHours === true;
    const dp = (businessSettings.defaultDepositPercentage ?? 0).toString();
    const rd = businessSettings.requireDepositByDefault === true;
    const acf = resolveAutoCustomerFollowUp(businessSettings.autoCustomerFollowUpEnabled);
    const tc = businessSettings.termsAndConditions ?? '';
    const est = businessSettings.extraSectionTitle ?? '';
    const esb = businessSettings.extraSectionBody ?? '';

    setShowMarkup(sm);
    setPriceDetail(pd);
    setShowLaborHours(slh);
    setDefaultDepositPercentage(dp);
    setRequireDepositByDefault(rd);
    setAutoCustomerFollowUp(acf);
    setTermsAndConditions(tc);
    setExtraSectionTitle(est);
    setExtraSectionBody(esb);
    setExtraSectionOpen(!!esb.trim());

    setInitialSnapshot(JSON.stringify({ sm, pd, slh, dp, rd, acf, tc, est, esb }));
  }, [businessSettings]);

  // Re-check on focus so the deposit toggle unlocks the moment
  // the tradie connects Square from an adjacent screen.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      checkSquareConnection()
        .then((res) => { if (!cancelled) setSquareConnected(!!res.connected); })
        .catch(() => { if (!cancelled) setSquareConnected(false); });
      return () => { cancelled = true; };
    }, []),
  );

  const isDirty = React.useMemo(() => {
    if (!initialSnapshot) return false;
    const current = JSON.stringify({
      sm: showMarkup,
      pd: priceDetail,
      slh: showLaborHours,
      dp: defaultDepositPercentage,
      rd: requireDepositByDefault,
      acf: autoCustomerFollowUp,
      tc: termsAndConditions,
      est: extraSectionTitle,
      esb: extraSectionBody,
    });
    return current !== initialSnapshot;
  }, [
    showMarkup, priceDetail, showLaborHours, defaultDepositPercentage, requireDepositByDefault,
    autoCustomerFollowUp, termsAndConditions, extraSectionTitle, extraSectionBody,
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
      await setBusinessSettings({
        ...currentSettings,
        showMarkup,
        defaultPriceDetail: priceDetail,
        showLaborHours,
        // Dual-written for one release so an older installed build reading
        // the legacy pair still renders documents the way this screen says.
        // Remove with legacyFlagsFor() in shared/document/priceDetail.ts.
        showMaterialCostsByDefault: legacyFlagsFor(priceDetail).showMaterialCosts,
        showLaborCostsByDefault: legacyFlagsFor(priceDetail).showLaborCosts,
        defaultDepositPercentage: Math.max(0, Math.min(100, parseFloat(defaultDepositPercentage) || 0)),
        requireDepositByDefault,
        autoCustomerFollowUpEnabled: autoCustomerFollowUp,
        termsAndConditions: termsAndConditions.trim() || undefined,
        termsUpdatedAt:
          termsAndConditions !== (businessSettings?.termsAndConditions ?? '')
            ? new Date().toISOString()
            : businessSettings?.termsUpdatedAt,
        // A title with no body prints nothing, so don't keep a stray title.
        extraSectionTitle: (extraSectionBody.trim() && extraSectionTitle.trim()) || undefined,
        extraSectionBody: extraSectionBody.trim() || undefined,
      });
      // The store update triggers the hydration useEffect to re-derive form
      // state and refresh initialSnapshot.
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
          {/* The template gallery is five large previews — it stays its own
              screen, one tap away, rather than a long scroll above the rest. */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => navigation.navigate('PDFTemplate' as never)}
            accessibilityRole="button"
            accessibilityLabel={`Template style: ${templateName}. Change`}
          >
            <Surface style={[styles.card, styles.templateRow]}>
              <MaterialCommunityIcons name="file-document-outline" size={22} color={themeColors.accentText} />
              <View style={styles.templateText}>
                <Text style={styles.toggleTitle}>Template style</Text>
                <Text style={styles.toggleDescription}>{templateName}</Text>
              </View>
              <Text style={styles.changeText}>Change</Text>
              <MaterialCommunityIcons name="chevron-right" size={22} color={themeColors.textMuted} />
            </Surface>
          </TouchableOpacity>

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>What the Customer Sees</Title>
            <Text style={styles.helperText}>
              Defaults for customer-facing quotes and invoices. Each document can override these.
            </Text>

            {/* One control, mirroring the per-document one on the preview
                screen. Two switches whose four combinations meant three
                things — and which couldn't express "scope only" at all. */}
            <View style={styles.toggleLabel}>
              <Text style={styles.toggleTitle}>Price detail</Text>
              <Text style={styles.toggleDescription}>{priceDetailBlurb(priceDetail)}</Text>
            </View>
            <PillToggle
              value={priceDetail}
              onChange={setPriceDetail}
              options={PRICE_DETAIL_OPTIONS}
              fullWidth
              style={{ marginTop: 10 }}
            />

            <View style={[styles.toggleRow, { marginTop: 16 }]}>
              <View style={styles.toggleLabel}>
                <Text style={styles.toggleTitle}>Show Markup</Text>
                <Text style={styles.toggleDescription}>
                  When off, markup is rolled into the line totals instead of showing as a separate line to the customer.
                </Text>
              </View>
              <Switch
                value={showMarkup}
                onValueChange={setShowMarkup}
                color={themeColors.accentText}
              />
            </View>

            {/* Only meaningful when per-line money is shown: the PDF builder
                gates "(30 hours @ $85/hr)" on the detail mode above, so the
                switch is disabled, not hidden, when that mode hides it. */}
            <View style={[styles.toggleRow, !laborHoursApplicable && styles.toggleRowDisabled]}>
              <View style={styles.toggleLabel}>
                <Text style={styles.toggleTitle}>Show Labour Hours</Text>
                <Text style={styles.toggleDescription}>
                  {laborHoursApplicable
                    ? 'Show the hours and hourly rate next to the labour total, not just the total.'
                    : 'Hours and rate only show when the customer sees line prices.'}
                </Text>
              </View>
              <Switch
                testID="show-labour-hours"
                value={showLaborHours}
                onValueChange={setShowLaborHours}
                disabled={!laborHoursApplicable}
                color={themeColors.accentText}
              />
            </View>
          </Surface>

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Deposits (Square)</Title>
            <Text style={styles.helperText}>
              {squareConnected === false
                ? 'Connect Square to accept card payments and deposits.'
                : 'Powered by Square. Can be overridden per quote.'}
            </Text>

            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <Text style={[styles.toggleTitle, squareConnected === false && { color: themeColors.textMuted }]}>
                  Require Deposit by Default
                </Text>
                <Text style={styles.toggleDescription}>
                  Customers are asked to pay a deposit when accepting.
                </Text>
              </View>
              <Switch
                value={requireDepositByDefault && squareConnected !== false}
                onValueChange={setRequireDepositByDefault}
                color={themeColors.accentText}
                disabled={squareConnected !== true}
              />
            </View>

            {squareConnected === false && (
              <TouchableOpacity
                onPress={() => navigation.navigate('SquareIntegration' as never)}
                style={styles.connectSquareButton}
              >
                <Text style={styles.connectSquareText}>Connect Square</Text>
              </TouchableOpacity>
            )}

            {requireDepositByDefault && squareConnected === true && (
              <TextInput
                label="Default Deposit"
                value={defaultDepositPercentage}
                onChangeText={setDefaultDepositPercentage}
                mode="outlined"
                style={styles.input}
                keyboardType="decimal-pad"
                right={<TextInput.Affix text="%" />}
                placeholder="30"
              />
            )}
          </Surface>

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Customer Follow-Ups</Title>
            <Text style={styles.helperText}>
              Automatically chase customers who haven&rsquo;t accepted yet.
            </Text>

            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <Text style={styles.toggleTitle}>Auto follow-up customers</Text>
                <Text style={styles.toggleDescription}>
                  Chases quotes and invoices for you, under your business name. Quotes at 2 and 7 days after sending; invoices at 3 and 10 days past due. Two reminders each, and they stop the moment the customer accepts, declines or pays.
                </Text>
              </View>
              <Switch
                value={autoCustomerFollowUp}
                onValueChange={setAutoCustomerFollowUp}
                color={themeColors.accentText}
              />
            </View>
          </Surface>

          <Surface style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Title style={styles.sectionTitle}>Terms &amp; Conditions</Title>
              <Text style={[styles.helperText, { marginLeft: 'auto', fontStyle: 'italic' }]}>
                Optional
              </Text>
            </View>
            <Text style={styles.helperText}>
              {termsAndConditions
                ? 'Shown on the quote/invoice PDF and in the payment email. Customers accept them when they pay.'
                : 'Add short terms to set expectations (deposits, payment, warranty). Leave blank if you don’t need them.'}
            </Text>

            {termsAndConditions ? (
              <>
                <TextInput
                  value={termsAndConditions}
                  onChangeText={setTermsAndConditions}
                  mode="outlined"
                  style={[styles.input, { minHeight: 180 }]}
                  multiline
                  numberOfLines={10}
                  placeholder="Your terms and conditions…"
                />
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Button
                    mode="text"
                    compact
                    onPress={() => {
                      Alert.alert(
                        'Remove terms?',
                        'Your quotes and invoices will stop showing a Terms & Conditions section. You can add them back any time.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => setTermsAndConditions('') },
                        ],
                      );
                    }}
                  >
                    Remove
                  </Button>
                  <Button
                    mode="text"
                    compact
                    onPress={() => setTermsAndConditions(defaultAuTradieTerms(gstMode))}
                  >
                    Reset to starter
                  </Button>
                  <Text style={[styles.helperText, { marginLeft: 'auto' }]}>
                    v{hashTerms(termsAndConditions).slice(0, 6)}
                  </Text>
                </View>
              </>
            ) : (
              <View style={{ gap: 10, marginTop: 4 }}>
                <Button
                  mode="contained-tonal"
                  icon="file-document-plus"
                  onPress={() => setTermsAndConditions(defaultAuTradieTerms(gstMode))}
                >
                  Use starter template
                </Button>
                <Button
                  mode="outlined"
                  icon="pencil"
                  onPress={() => setTermsAndConditions(' ')}
                >
                  Write your own
                </Button>
              </View>
            )}
          </Surface>

          <Surface style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Title style={styles.sectionTitle}>Extra Quote Section</Title>
              <Text style={[styles.helperText, { marginLeft: 'auto', fontStyle: 'italic' }]}>
                Optional
              </Text>
            </View>
            <Text style={styles.helperText}>
              Shown on every quote after your terms. Handy for trades you recommend, licence and insurance details, or your warranty.
            </Text>

            {extraSectionOpen ? (
              <>
                <TextInput
                  label="Heading"
                  value={extraSectionTitle}
                  onChangeText={setExtraSectionTitle}
                  mode="outlined"
                  style={styles.input}
                  placeholder="e.g. Preferred trades"
                  maxLength={EXTRA_SECTION_TITLE_MAX}
                  testID="extra-section-title"
                />
                <TextInput
                  label="What to show"
                  value={extraSectionBody}
                  onChangeText={setExtraSectionBody}
                  mode="outlined"
                  style={[styles.input, { minHeight: 140 }]}
                  multiline
                  numberOfLines={7}
                  placeholder={'e.g. Smith Plastering — Dave, 0400 123 456\nBright Sparks Electrical — 0411 222 333'}
                  maxLength={EXTRA_SECTION_BODY_MAX}
                  testID="extra-section-body"
                />
                <View style={{ flexDirection: 'row' }}>
                  <Button
                    mode="text"
                    compact
                    onPress={() => {
                      setExtraSectionTitle('');
                      setExtraSectionBody('');
                      setExtraSectionOpen(false);
                    }}
                  >
                    Remove
                  </Button>
                </View>
              </>
            ) : (
              <Button
                mode="outlined"
                icon="plus"
                style={{ marginTop: 4 }}
                onPress={() => setExtraSectionOpen(true)}
              >
                Add a section
              </Button>
            )}
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
        message="Your quote and invoice settings have been updated."
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
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  templateText: { flex: 1 },
  changeText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.accentText,
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
  toggleRowDisabled: { opacity: 0.5 },
  toggleLabel: { flex: 1, marginRight: 12 },
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
  connectSquareButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: t.colors.accent,
    marginTop: 4,
    marginBottom: 8,
  },
  connectSquareText: {
    color: t.colors.onAccent,
    fontSize: 13,
    fontWeight: '600',
  },
}));
