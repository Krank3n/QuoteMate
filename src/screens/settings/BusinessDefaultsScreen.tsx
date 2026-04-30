/**
 * Business Defaults Settings Screen
 *
 * Default rates + Terms & Conditions applied to new quotes/invoices. Lifted
 * out of BusinessProfileScreen so the "who you are" (name, logo, contact
 * details) stays separate from "how you price" (labour rate, markup, deposit,
 * card surcharge, terms). Easier to find and less to scroll past.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import {
  Text,
  TextInput,
  Surface,
  Title,
  Button,
  Switch,
} from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { AlertModal } from '../../components/AlertModal';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { checkSquareConnection } from '../../services/squareService';
import { defaultAuTradieTerms, hashTerms, isUnmodifiedStarterTerms } from '../../../shared/pdf/terms/defaultAuTradie';
import { PASSTHROUGH_SURCHARGE_PCT } from '../../../shared/pdf/squareFees';

export function BusinessDefaultsScreen() {
  const navigation = useNavigation<any>();
  const { businessSettings, setBusinessSettings } = useStore();

  const [laborRate, setLaborRate] = useState('85');
  const [markup, setMarkup] = useState('20');
  const [laborMarkup, setLaborMarkup] = useState('20');
  const [defaultDepositPercentage, setDefaultDepositPercentage] = useState('0');
  const [requireDepositByDefault, setRequireDepositByDefault] = useState(false);
  const [transportMarkupEnabled, setTransportMarkupEnabled] = useState(true);
  const [surchargePaymentFees, setSurchargePaymentFees] = useState(false);
  const [pricesIncludeGst, setPricesIncludeGst] = useState(false);
  const [termsAndConditions, setTermsAndConditions] = useState('');

  const [squareConnected, setSquareConnected] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const initialSnapshotRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (!businessSettings) return;
    const lr = businessSettings.defaultLaborRate?.toString() || '85';
    const mk = businessSettings.defaultMarkup?.toString() || '20';
    const lm = (businessSettings.defaultLaborMarkup ?? businessSettings.defaultMarkup ?? 20).toString();
    const dp = (businessSettings.defaultDepositPercentage ?? 0).toString();
    const rd = businessSettings.requireDepositByDefault === true;
    const tm = businessSettings.transportMarkupEnabled !== false;
    const sf = businessSettings.surchargePaymentFees === true;
    const pig = businessSettings.pricesIncludeGst === true;
    const tc = businessSettings.termsAndConditions ?? '';

    setLaborRate(lr);
    setMarkup(mk);
    setLaborMarkup(lm);
    setDefaultDepositPercentage(dp);
    setRequireDepositByDefault(rd);
    setTransportMarkupEnabled(tm);
    setSurchargePaymentFees(sf);
    setPricesIncludeGst(pig);
    setTermsAndConditions(tc);

    initialSnapshotRef.current = JSON.stringify({ lr, mk, lm, dp, rd, tm, sf, pig, tc });
  }, [businessSettings]);

  // Re-check on focus so the deposit + surcharge toggles unlock the moment
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
    if (!initialSnapshotRef.current) return false;
    const current = JSON.stringify({
      lr: laborRate,
      mk: markup,
      lm: laborMarkup,
      dp: defaultDepositPercentage,
      rd: requireDepositByDefault,
      tm: transportMarkupEnabled,
      sf: surchargePaymentFees,
      pig: pricesIncludeGst,
      tc: termsAndConditions,
    });
    return current !== initialSnapshotRef.current;
  }, [
    laborRate, markup, laborMarkup, defaultDepositPercentage, requireDepositByDefault,
    transportMarkupEnabled, surchargePaymentFees, pricesIncludeGst, termsAndConditions,
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
      await setBusinessSettings({
        ...businessSettings!,
        defaultLaborRate: parseFloat(laborRate) || 85,
        defaultMarkup: parseFloat(markup) || 20,
        defaultLaborMarkup: parseFloat(laborMarkup) || 0,
        defaultDepositPercentage: Math.max(0, Math.min(100, parseFloat(defaultDepositPercentage) || 0)),
        requireDepositByDefault,
        transportMarkupEnabled,
        surchargePaymentFees,
        pricesIncludeGst,
        termsAndConditions: termsAndConditions.trim() || undefined,
        termsUpdatedAt:
          termsAndConditions !== (businessSettings?.termsAndConditions ?? '')
            ? new Date().toISOString()
            : businessSettings?.termsUpdatedAt,
      });
      // The store update triggers the hydration useEffect to re-derive form
      // state from the new businessSettings and refresh initialSnapshotRef.
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
      <ScrollView
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
              onChangeText={setLaborRate}
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
                color={colors.primary}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <Text style={styles.toggleTitle}>Prices include GST</Text>
                <Text style={styles.toggleDescription}>
                  {pricesIncludeGst
                    ? 'Prices you enter are inc-GST. The quote shows GST as a 1/11 disclosure.'
                    : 'Prices you enter are ex-GST. The quote adds 10% GST to the total.'}
                </Text>
              </View>
              <Switch
                value={pricesIncludeGst}
                onValueChange={(next) => {
                  setPricesIncludeGst(next);
                  // Keep the starter T&C's GST line in sync when toggling —
                  // but only if the tradie hasn't hand-edited the template.
                  // If they've customised the wording we leave it alone so
                  // we don't clobber their changes.
                  if (isUnmodifiedStarterTerms(termsAndConditions)) {
                    setTermsAndConditions(defaultAuTradieTerms(next));
                  }
                }}
                color={colors.primary}
              />
            </View>
          </Surface>

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Deposits &amp; Card Fees (Square)</Title>
            <Text style={styles.helperText}>
              {squareConnected === false
                ? 'Connect Square to accept card payments, deposits, and surcharges.'
                : 'Powered by Square. Both can be overridden per quote.'}
            </Text>

            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <Text style={[styles.toggleTitle, squareConnected === false && { color: colors.textMuted }]}>
                  Require Deposit by Default
                </Text>
                <Text style={styles.toggleDescription}>
                  Customers are asked to pay a deposit when accepting.
                </Text>
              </View>
              <Switch
                value={requireDepositByDefault && squareConnected !== false}
                onValueChange={setRequireDepositByDefault}
                color={colors.primary}
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

            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <Text style={[styles.toggleTitle, squareConnected === false && { color: colors.textMuted }]}>
                  Pass Card Fees to Customer
                </Text>
                <Text style={styles.toggleDescription}>
                  {surchargePaymentFees && squareConnected === true
                    ? `Customer pays an extra ${PASSTHROUGH_SURCHARGE_PCT}% on card payments. Covers processing fees so you keep the full quoted amount.`
                    : `You absorb the ~${PASSTHROUGH_SURCHARGE_PCT}% card processing fee. Customer only sees the quoted amount.`}
                </Text>
              </View>
              <Switch
                value={surchargePaymentFees && squareConnected !== false}
                onValueChange={setSurchargePaymentFees}
                color={colors.primary}
                disabled={squareConnected !== true}
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
                : 'Add short terms to set expectations (deposits, payment, warranty). Leave blank if you don\u2019t need them.'}
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
                    onPress={() => setTermsAndConditions(defaultAuTradieTerms(pricesIncludeGst))}
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
                  onPress={() => setTermsAndConditions(defaultAuTradieTerms(pricesIncludeGst))}
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
        </WebContainer>
      </ScrollView>

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
        message="Your business defaults have been updated."
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  helperText: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 12,
  },
  input: {
    marginBottom: 12,
    backgroundColor: colors.surface,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  toggleLabel: { flex: 1, marginRight: 12 },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  toggleDescription: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  connectSquareButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.primary,
    marginTop: 4,
    marginBottom: 8,
  },
  connectSquareText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
