/**
 * Payment Methods Settings Screen
 * Bank transfer, PayID, BPAY, PayPal, Other
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import {
  Text,
  TextInput,
  Surface,
  Title,
  Switch,
  Divider,
  Chip,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { useStore } from '../../store/useStore';
import { PaymentMethodSettings } from '../../types';
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { AlertModal } from '../../components/AlertModal';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';

export function PaymentMethodsScreen() {
  const { businessSettings, setBusinessSettings, getEffectivePlan } = useStore();
  const navigation = useNavigation<any>();
  const isFreeTier = getEffectivePlan() === 'free';

  const [showPaymentOnDocuments, setShowPaymentOnDocuments] = useState(false);
  // Bank Transfer
  const [bankEnabled, setBankEnabled] = useState(false);
  const [bankAccountName, setBankAccountName] = useState('');
  const [bankBsb, setBankBsb] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  // PayID
  const [payIdEnabled, setPayIdEnabled] = useState(false);
  const [payIdType, setPayIdType] = useState<'phone' | 'email' | 'abn'>('phone');
  const [payIdValue, setPayIdValue] = useState('');
  // BPAY
  const [bpayEnabled, setBpayEnabled] = useState(false);
  const [bpayBillerCode, setBpayBillerCode] = useState('');
  const [bpayReference, setBpayReference] = useState('');
  // PayPal
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  const [paypalEmail, setPaypalEmail] = useState('');
  // Other
  const [otherEnabled, setOtherEnabled] = useState(false);
  const [otherPaymentInstructions, setOtherPaymentInstructions] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);

  useEffect(() => {
    if (businessSettings?.paymentMethods) {
      const pm = businessSettings.paymentMethods;
      const sod = pm.showOnDocuments || false;
      const bE = pm.bankAccount?.enabled || false;
      const bAN = pm.bankAccount?.accountName || '';
      const bB = pm.bankAccount?.bsb || '';
      const bAcc = pm.bankAccount?.accountNumber || '';
      const piE = pm.payId?.enabled || false;
      const piT = pm.payId?.payIdType || 'phone';
      const piV = pm.payId?.payIdValue || '';
      const bpE = pm.bpay?.enabled || false;
      const bpBC = pm.bpay?.billerCode || '';
      const bpRef = pm.bpay?.referenceNumber || '';
      const ppE = pm.paypal?.enabled || false;
      const ppEmail = pm.paypal?.email || '';
      const oE = pm.other?.enabled || false;
      const oI = pm.other?.instructions || '';

      setShowPaymentOnDocuments(sod);
      setBankEnabled(bE);
      setBankAccountName(bAN);
      setBankBsb(bB);
      setBankAccountNumber(bAcc);
      setPayIdEnabled(piE);
      setPayIdType(piT);
      setPayIdValue(piV);
      setBpayEnabled(bpE);
      setBpayBillerCode(bpBC);
      setBpayReference(bpRef);
      setPaypalEnabled(ppE);
      setPaypalEmail(ppEmail);
      setOtherEnabled(oE);
      setOtherPaymentInstructions(oI);

      setInitialSnapshot(JSON.stringify({
        sod, bE, bAN, bB, bAcc, piE, piT, piV, bpE, bpBC, bpRef, ppE, ppEmail, oE, oI,
      }));
    }
  }, [businessSettings]);

  const isDirty = useMemo(() => {
    if (!initialSnapshot) return false;
    const current = JSON.stringify({
      sod: showPaymentOnDocuments,
      bE: bankEnabled, bAN: bankAccountName, bB: bankBsb, bAcc: bankAccountNumber,
      piE: payIdEnabled, piT: payIdType, piV: payIdValue,
      bpE: bpayEnabled, bpBC: bpayBillerCode, bpRef: bpayReference,
      ppE: paypalEnabled, ppEmail: paypalEmail,
      oE: otherEnabled, oI: otherPaymentInstructions,
    });
    return current !== initialSnapshot;
  }, [
    showPaymentOnDocuments,
    bankEnabled, bankAccountName, bankBsb, bankAccountNumber,
    payIdEnabled, payIdType, payIdValue,
    bpayEnabled, bpayBillerCode, bpayReference,
    paypalEnabled, paypalEmail,
    otherEnabled, otherPaymentInstructions,
    initialSnapshot,
  ]);

  const handleSave = async (opts?: { silent?: boolean }): Promise<boolean> => {
    const paymentMethods: PaymentMethodSettings = {
      showOnDocuments: showPaymentOnDocuments,
      bankAccount: {
        enabled: bankEnabled,
        accountName: bankAccountName.trim() || '',
        bsb: bankBsb.trim() || '',
        accountNumber: bankAccountNumber.trim() || '',
      },
      payId: {
        enabled: payIdEnabled,
        payIdType: payIdType,
        payIdValue: payIdValue.trim() || '',
      },
      bpay: {
        enabled: bpayEnabled,
        billerCode: bpayBillerCode.trim() || '',
        referenceNumber: bpayReference.trim() || '',
      },
      paypal: {
        enabled: paypalEnabled,
        email: paypalEmail.trim() || '',
      },
      other: {
        enabled: otherEnabled,
        instructions: otherPaymentInstructions.trim() || '',
      },
    };

    try {
      setIsLoading(true);
      await setBusinessSettings({
        ...businessSettings!,
        paymentMethods: paymentMethods,
      });
      setInitialSnapshot(JSON.stringify({
        sod: showPaymentOnDocuments,
        bE: bankEnabled, bAN: bankAccountName, bB: bankBsb, bAcc: bankAccountNumber,
        piE: payIdEnabled, piT: payIdType, piV: payIdValue,
        bpE: bpayEnabled, bpBC: bpayBillerCode, bpRef: bpayReference,
        ppE: paypalEnabled, ppEmail: paypalEmail,
        oE: otherEnabled, oI: otherPaymentInstructions,
      }));
      if (!opts?.silent) setShowSuccessModal(true);
      return true;
    } catch (error) {
      setShowErrorModal(true);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const { unsavedModalProps } = useUnsavedChangesGuard({
    isDirty,
    onSave: () => handleSave({ silent: true }),
  });

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <WebContainer>
          {isFreeTier && (
            <TouchableOpacity
              onPress={() => navigation.navigate('Paywall' as never)}
              activeOpacity={0.7}
            >
              <Surface style={styles.freeTierBanner} elevation={2}>
                <MaterialCommunityIcons
                  name="lock-outline"
                  size={20}
                  color={colors.primary}
                  style={{ marginRight: 10 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.freeTierBannerTitle}>Pro unlocks all payment methods</Text>
                  <Text style={styles.freeTierBannerSubtitle}>
                    On the free plan, only Square is shown on documents. Tap to upgrade and offer bank, PayID, BPAY, PayPal too.
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurface} />
              </Surface>
            </TouchableOpacity>
          )}

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Display Settings</Title>

            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <MaterialCommunityIcons name="credit-card-outline" size={24} color={colors.primary} />
                <View style={styles.switchTextContainer}>
                  <Text style={styles.switchTitle}>Show on Documents</Text>
                  <Text style={styles.switchDescription}>
                    {isFreeTier
                      ? 'On the free plan, only Square is shown on documents'
                      : 'Display enabled payment methods on PDF quotes and invoices'}
                  </Text>
                </View>
              </View>
              <Switch
                value={isFreeTier ? false : showPaymentOnDocuments}
                onValueChange={setShowPaymentOnDocuments}
                color={colors.primary}
                disabled={isFreeTier}
              />
            </View>
          </Surface>

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Payment Methods</Title>

            {/* Bank Transfer */}
            <View style={styles.paymentMethodSection}>
              <View style={styles.paymentMethodHeaderWithToggle}>
                <View style={styles.paymentMethodHeader}>
                  <MaterialCommunityIcons name="bank" size={20} color={bankEnabled && !isFreeTier ? colors.primary : colors.onSurface} />
                  <Text style={[styles.paymentMethodTitle, (!bankEnabled || isFreeTier) && styles.paymentMethodTitleDisabled]}>Bank Transfer</Text>
                  {isFreeTier && <Text style={styles.proBadge}>PRO</Text>}
                </View>
                <Switch
                  value={isFreeTier ? false : bankEnabled}
                  onValueChange={setBankEnabled}
                  color={colors.primary}
                  disabled={isFreeTier}
                />
              </View>
              {bankEnabled && (
                <>
                  <TextInput
                    label="Account Name"
                    value={bankAccountName}
                    onChangeText={setBankAccountName}
                    mode="outlined"
                    style={styles.paymentInput}
                    placeholder="e.g., John Smith Trading"
                  />
                  <View style={styles.bankDetailsRow}>
                    <TextInput
                      label="BSB"
                      value={bankBsb}
                      onChangeText={setBankBsb}
                      mode="outlined"
                      style={[styles.paymentInput, styles.bsbInput]}
                      keyboardType="numeric"
                      placeholder="000-000"
                      maxLength={7}
                    />
                    <TextInput
                      label="Account Number"
                      value={bankAccountNumber}
                      onChangeText={setBankAccountNumber}
                      mode="outlined"
                      style={[styles.paymentInput, styles.accountInput]}
                      keyboardType="numeric"
                      placeholder="12345678"
                    />
                  </View>
                </>
              )}
            </View>

            <Divider style={styles.paymentDivider} />

            {/* PayID */}
            <View style={styles.paymentMethodSection}>
              <View style={styles.paymentMethodHeaderWithToggle}>
                <View style={styles.paymentMethodHeader}>
                  <MaterialCommunityIcons name="cellphone" size={20} color={payIdEnabled && !isFreeTier ? colors.primary : colors.onSurface} />
                  <Text style={[styles.paymentMethodTitle, (!payIdEnabled || isFreeTier) && styles.paymentMethodTitleDisabled]}>PayID</Text>
                  {isFreeTier && <Text style={styles.proBadge}>PRO</Text>}
                </View>
                <Switch
                  value={isFreeTier ? false : payIdEnabled}
                  onValueChange={setPayIdEnabled}
                  color={colors.primary}
                  disabled={isFreeTier}
                />
              </View>
              {payIdEnabled && (
                <>
                  <View style={styles.payIdTypeRow}>
                    <Chip
                      selected={payIdType === 'phone'}
                      onPress={() => setPayIdType('phone')}
                      style={styles.payIdTypeChip}
                      mode={payIdType === 'phone' ? 'flat' : 'outlined'}
                    >
                      Phone
                    </Chip>
                    <Chip
                      selected={payIdType === 'email'}
                      onPress={() => setPayIdType('email')}
                      style={styles.payIdTypeChip}
                      mode={payIdType === 'email' ? 'flat' : 'outlined'}
                    >
                      Email
                    </Chip>
                    <Chip
                      selected={payIdType === 'abn'}
                      onPress={() => setPayIdType('abn')}
                      style={styles.payIdTypeChip}
                      mode={payIdType === 'abn' ? 'flat' : 'outlined'}
                    >
                      ABN
                    </Chip>
                  </View>
                  <TextInput
                    label={payIdType === 'phone' ? 'Phone Number' : payIdType === 'email' ? 'Email Address' : 'ABN'}
                    value={payIdValue}
                    onChangeText={setPayIdValue}
                    mode="outlined"
                    style={styles.paymentInput}
                    keyboardType={payIdType === 'phone' ? 'phone-pad' : payIdType === 'email' ? 'email-address' : 'numeric'}
                    placeholder={payIdType === 'phone' ? '0412 345 678' : payIdType === 'email' ? 'payments@business.com' : '12 345 678 901'}
                  />
                </>
              )}
            </View>

            <Divider style={styles.paymentDivider} />

            {/* BPAY */}
            <View style={styles.paymentMethodSection}>
              <View style={styles.paymentMethodHeaderWithToggle}>
                <View style={styles.paymentMethodHeader}>
                  <MaterialCommunityIcons name="barcode" size={20} color={bpayEnabled && !isFreeTier ? colors.primary : colors.onSurface} />
                  <Text style={[styles.paymentMethodTitle, (!bpayEnabled || isFreeTier) && styles.paymentMethodTitleDisabled]}>BPAY</Text>
                  {isFreeTier && <Text style={styles.proBadge}>PRO</Text>}
                </View>
                <Switch
                  value={isFreeTier ? false : bpayEnabled}
                  onValueChange={setBpayEnabled}
                  color={colors.primary}
                  disabled={isFreeTier}
                />
              </View>
              {bpayEnabled && (
                <View style={styles.bankDetailsRow}>
                  <TextInput
                    label="Biller Code"
                    value={bpayBillerCode}
                    onChangeText={setBpayBillerCode}
                    mode="outlined"
                    style={[styles.paymentInput, styles.bsbInput]}
                    keyboardType="numeric"
                    placeholder="12345"
                  />
                  <TextInput
                    label="Reference Number"
                    value={bpayReference}
                    onChangeText={setBpayReference}
                    mode="outlined"
                    style={[styles.paymentInput, styles.accountInput]}
                    keyboardType="numeric"
                    placeholder="1234567890"
                  />
                </View>
              )}
            </View>

            <Divider style={styles.paymentDivider} />

            {/* PayPal */}
            <View style={styles.paymentMethodSection}>
              <View style={styles.paymentMethodHeaderWithToggle}>
                <View style={styles.paymentMethodHeader}>
                  <MaterialCommunityIcons name="alpha-p-circle" size={20} color={paypalEnabled && !isFreeTier ? colors.primary : colors.onSurface} />
                  <Text style={[styles.paymentMethodTitle, (!paypalEnabled || isFreeTier) && styles.paymentMethodTitleDisabled]}>PayPal</Text>
                  {isFreeTier && <Text style={styles.proBadge}>PRO</Text>}
                </View>
                <Switch
                  value={isFreeTier ? false : paypalEnabled}
                  onValueChange={setPaypalEnabled}
                  color={colors.primary}
                  disabled={isFreeTier}
                />
              </View>
              {paypalEnabled && (
                <TextInput
                  label="PayPal Email"
                  value={paypalEmail}
                  onChangeText={setPaypalEmail}
                  mode="outlined"
                  style={styles.paymentInput}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder="payments@business.com"
                />
              )}
            </View>

            <Divider style={styles.paymentDivider} />

            {/* Other Instructions */}
            <View style={styles.paymentMethodSection}>
              <View style={styles.paymentMethodHeaderWithToggle}>
                <View style={styles.paymentMethodHeader}>
                  <MaterialCommunityIcons name="text-box-outline" size={20} color={otherEnabled && !isFreeTier ? colors.primary : colors.onSurface} />
                  <Text style={[styles.paymentMethodTitle, (!otherEnabled || isFreeTier) && styles.paymentMethodTitleDisabled]}>Other</Text>
                  {isFreeTier && <Text style={styles.proBadge}>PRO</Text>}
                </View>
                <Switch
                  value={isFreeTier ? false : otherEnabled}
                  onValueChange={setOtherEnabled}
                  color={colors.primary}
                  disabled={isFreeTier}
                />
              </View>
              {otherEnabled && (
                <TextInput
                  label="Additional Payment Instructions"
                  value={otherPaymentInstructions}
                  onChangeText={setOtherPaymentInstructions}
                  mode="outlined"
                  style={styles.paymentInput}
                  multiline
                  numberOfLines={3}
                  placeholder="e.g., Cash accepted on site, Afterpay available..."
                />
              )}
            </View>
          </Surface>
        </WebContainer>
      </ScrollView>

      <FixedBottomButton
        mode="contained"
        label="Save"
        onPress={() => handleSave()}
        disabled={isLoading}
        loading={isLoading}
      />

      <AlertModal
        visible={showSuccessModal}
        onDismiss={() => setShowSuccessModal(false)}
        type="success"
        title="Saved!"
        message="Your payment methods have been updated."
      />

      <AlertModal
        visible={showErrorModal}
        onDismiss={() => setShowErrorModal(false)}
        type="error"
        title="Save Failed"
        message="Failed to save settings. Please try again."
      />

      <AlertModal {...unsavedModalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  freeTierBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  freeTierBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  freeTierBannerSubtitle: {
    fontSize: 12,
    color: colors.onSurface,
    lineHeight: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  switchLabel: {
    flex: 1,
    marginRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  switchTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  switchDescription: {
    fontSize: 13,
    color: colors.onSurface,
    lineHeight: 18,
  },
  paymentMethodSection: {
    marginBottom: 8,
  },
  paymentMethodHeaderWithToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  paymentMethodHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  paymentMethodTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
    color: colors.text,
  },
  paymentMethodTitleDisabled: {
    color: colors.onSurface,
  },
  paymentInput: {
    marginBottom: 12,
    backgroundColor: colors.surface,
  },
  paymentDivider: {
    marginVertical: 16,
  },
  bankDetailsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  bsbInput: {
    flex: 1,
  },
  accountInput: {
    flex: 2,
  },
  payIdTypeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  payIdTypeChip: {
    backgroundColor: colors.surface,
  },
  proBadge: {
    marginLeft: 8,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: colors.secondary,
    backgroundColor: colors.secondary + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
});
