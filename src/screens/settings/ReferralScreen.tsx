/**
 * Referral Screen
 *
 * Two distinct experiences:
 * - Affiliates: QR-first layout with earnings dashboard and commission tracking
 * - Regular users: referral code sharing to help mates discover the app
 *
 * ── App Store compliance notes (read before changing copy) ────────────────
 * A referral code is ATTRIBUTION ONLY. It never unlocks, discounts, or extends
 * a subscription, and this screen must never imply that it does (Guideline
 * 3.1.1 — no purchases or entitlements outside IAP; 3.1.3 — no external
 * purchase CTAs).
 *
 * Affiliate commission is paid by us, out-of-band, from net revenue AFTER the
 * store's cut. Every dollar figure shown is therefore derived from the
 * affiliate's real commission rate and the real platform fee
 * (src/utils/referral.ts, unit-tested) — never a default or a rounded-up
 * "average". Projections are labelled as illustrative, which keeps them clear
 * of Guideline 2.3.1 (accurate metadata / no misleading claims).
 *
 * The affiliate-recruitment material (game plan, tips, WhatsApp contact) is
 * shown ONLY to approved affiliates. Presenting an earn-money programme to
 * every user turns the app into an unreviewed income-opportunity pitch, and the
 * WhatsApp button was an off-platform contact CTA on a monetisation screen.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Share,
  Platform,
  ActivityIndicator,
  Linking,
  Image,
  RefreshControl,
} from 'react-native';
import {
  Text,
  Surface,
  Title,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { getFunctions, httpsCallable } from 'firebase/functions';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { useRoute } from '@react-navigation/native';

import { makeStyles, useThemeColors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal, AlertType } from '../../components/AlertModal';
import { ReferralInfo, AffiliateEarning } from '../../types';
import { firestoreService } from '../../services/firestoreService';
import { auth } from '../../config/firebase';
import { useStore } from '../../store/useStore';
import { GridBackground } from '../../components/GridBackground';
import {
  applyCodeEligibility,
  buildSharePayload,
  commissionPerUserCents,
  displayCommissionRate,
  earningsProjection,
  extractReferralCode,
  formatCents,
  isValidReferralCode,
  referralLink as buildReferralLink,
} from '../../utils/referral';

const SUPPORT_EMAIL = 'support@quotemateapp.au';

export function ReferralScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [referralInfo, setReferralInfo] = useState<ReferralInfo | null>(null);
  const [earnings, setEarnings] = useState<AffiliateEarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingEarnings, setLoadingEarnings] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [modal, setModal] = useState<{ visible: boolean; type: AlertType; title: string; message: string }>({
    visible: false, type: 'info', title: '', message: '',
  });

  // Gate the apply-code form on real entitlement state: the backend refuses a
  // code once the account is paying, so offering the form to a Pro user is a
  // guaranteed dead end.
  const isPro = useStore((s) => s.subscriptionStatus?.isPro === true);

  // Deep link: https://quotemateapp.au/ref/QM-AB2CD3 routes here with the code
  // as a param (see the `linking` config in App.tsx). Pre-fill it so the tradie
  // taps Apply instead of retyping a code off someone else's phone.
  const route = useRoute();
  const deepLinkCode = extractReferralCode((route.params as { code?: string } | undefined)?.code);

  useEffect(() => {
    if (deepLinkCode && isValidReferralCode(deepLinkCode)) {
      setCodeInput(deepLinkCode);
    }
  }, [deepLinkCode]);

  const showModal = (type: AlertType, title: string, message: string) => {
    setModal({ visible: true, type, title, message });
  };

  const loadReferralInfo = useCallback(async () => {
    try {
      const info = await firestoreService.loadReferralInfo();
      setReferralInfo(info);
    } catch (error) {
      // Non-fatal: the screen renders its empty state and the user can retry
      // with pull-to-refresh.
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEarnings = useCallback(async () => {
    if (!auth.currentUser) return;
    setLoadingEarnings(true);
    try {
      const functions = getFunctions();
      const getAffiliateEarnings = httpsCallable(functions, 'getAffiliateEarnings');
      const result = await getAffiliateEarnings();
      const data = result.data as { summary?: Partial<ReferralInfo>; earnings?: AffiliateEarning[] };
      setEarnings(Array.isArray(data?.earnings) ? data.earnings : []);
      // The callable is the authoritative view of the ledger (the Firestore doc
      // can lag a webhook). Fold its summary over the cached profile so the
      // balances on screen match the earnings list underneath them.
      if (data?.summary) {
        setReferralInfo((prev) => (prev ? { ...prev, ...data.summary } as ReferralInfo : prev));
      }
    } catch (error) {
      // Leave whatever we already had rather than blanking the dashboard.
    } finally {
      setLoadingEarnings(false);
    }
  }, []);

  useEffect(() => { loadReferralInfo(); }, [loadReferralInfo]);
  useEffect(() => {
    if (referralInfo?.isAffiliate) loadEarnings();
  }, [referralInfo?.isAffiliate, loadEarnings]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadReferralInfo();
    if (referralInfo?.isAffiliate) await loadEarnings();
    setRefreshing(false);
  }, [loadReferralInfo, loadEarnings, referralInfo?.isAffiliate]);

  // ── Derived values ──

  const referralCode = referralInfo?.referralCode || '';
  const referralLink = referralCode ? buildReferralLink(referralCode) : '';

  // null when the user has no genuine commission rate — the UI then shows no
  // percentage at all instead of an invented default (the old screen fell back
  // to 80% for everyone, including non-affiliates).
  const commissionRate = displayCommissionRate(referralInfo);
  const commissionPercent = commissionRate !== null ? Math.round(commissionRate * 100) : null;

  const projection = useMemo(() => earningsProjection(referralInfo), [referralInfo]);
  const maxProjection = projection.length
    ? Math.max(...projection.map((p) => p.amountCents))
    : 0;
  const perUserIos = commissionRate !== null ? commissionPerUserCents('ios', commissionRate) : 0;
  const perUserWeb = commissionRate !== null ? commissionPerUserCents('web', commissionRate) : 0;

  const eligibility = applyCodeEligibility(referralInfo, isPro);
  const normalisedInput = extractReferralCode(codeInput);
  const inputLooksValid = isValidReferralCode(normalisedInput);

  // ── Handlers ──

  const handleGenerateCode = async () => {
    if (!auth.currentUser) {
      showModal('warning', 'Sign In Required', 'Please sign in to get your referral code.');
      return;
    }
    setGeneratingCode(true);
    try {
      const functions = getFunctions();
      const generateReferralCode = httpsCallable(functions, 'generateReferralCode');
      const result = await generateReferralCode();
      const data = result.data as { referralCode?: string };
      if (!data?.referralCode) throw new Error('No code returned');
      // Re-read the profile instead of fabricating one locally: the old code
      // overwrote isAffiliate/commissionRate/earnings with zeros in local
      // state, so an existing affiliate who tapped this lost their dashboard
      // until the next app launch.
      await loadReferralInfo();
    } catch (error: any) {
      showModal('error', 'Something went wrong', 'Could not create your referral code. Please try again.');
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleCopyCode = async () => {
    if (!referralLink) return;
    try {
      // expo-clipboard works on native AND web. The old code only ever copied
      // on web (`Platform.OS === 'web' && navigator.clipboard`), so on iOS and
      // Android the button showed "Copied!" while the clipboard was untouched.
      await Clipboard.setStringAsync(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showModal('error', 'Could not copy', 'Copying failed. You can still use Share instead.');
    }
  };

  const handleShare = async () => {
    if (!referralCode || !referralLink) return;
    try {
      await Share.share(buildSharePayload(referralCode, referralLink, Platform.OS));
    } catch (error) {
      // User dismissed the share sheet, or no share target — nothing to do.
    }
  };

  const handleApplyCode = async () => {
    const code = extractReferralCode(codeInput);
    if (!code) {
      showModal('warning', 'Enter a Code', 'Please enter your mate\'s referral code.');
      return;
    }
    if (!isValidReferralCode(code)) {
      showModal('warning', 'Check the Code', 'Referral codes look like QM-AB2CD3. Double-check it with your mate.');
      return;
    }
    if (!auth.currentUser) {
      showModal('warning', 'Sign In Required', 'Please sign in to apply a referral code.');
      return;
    }

    setApplyingCode(true);
    try {
      const functions = getFunctions();
      const applyReferralCode = httpsCallable(functions, 'applyReferralCode');
      await applyReferralCode({ referralCode: code });
      showModal(
        'success',
        'Code Applied',
        'Your mate is now credited for referring you. Nice one!'
      );
      setCodeInput('');
      await loadReferralInfo();
    } catch (error: any) {
      // The backend sends precise, user-ready messages for every rejection
      // (unknown code, own code, already applied, already subscribed, outside
      // the attribution window). Surfacing them beats the old substring
      // sniffing, which mislabelled anything it didn't recognise.
      const message = typeof error?.message === 'string' && error.message.trim()
        ? error.message
        : 'Could not apply that code. Please try again.';
      const isExpected = ['not-found', 'invalid-argument', 'already-exists', 'failed-precondition']
        .includes(error?.code?.replace?.('functions/', '') || '');
      showModal(isExpected ? 'warning' : 'error', isExpected ? 'Code Not Applied' : 'Something went wrong', message);
    } finally {
      setApplyingCode(false);
    }
  };

  const formatCurrency = formatCents;

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'ios': return 'apple' as const;
      case 'android': return 'android' as const;
      case 'web': return 'web' as const;
      default: return 'help-circle' as const;
    }
  };
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return themeColors.warning;
      case 'confirmed': return themeColors.accent;
      case 'paid': return themeColors.money;
      case 'cancelled': return themeColors.error;
      default: return themeColors.textSecondary;
    }
  };

  // ── Loading ──

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={themeColors.accentText} />
      </View>
    );
  }

  // ── Shared blocks ──

  const renderGenerateCode = () => (
    <TouchableOpacity
      style={styles.generateButton}
      onPress={handleGenerateCode}
      disabled={generatingCode}
      accessibilityRole="button"
      accessibilityLabel="Get my referral code"
    >
      {generatingCode ? (
        <ActivityIndicator size="small" color={themeColors.onAccent} />
      ) : (
        <MaterialCommunityIcons name="qrcode" size={20} color={themeColors.onAccent} />
      )}
      <Text style={styles.generateButtonText}>
        {generatingCode ? 'Generating...' : 'Get My Referral Code'}
      </Text>
    </TouchableOpacity>
  );

  const renderQrCard = (subtitle: React.ReactNode) => (
    <Surface style={styles.adQrCard}>
      <Image
        source={require('../../../assets/logo-scaled.png')}
        style={styles.adLogo}
        resizeMode="contain"
      />

      <View style={styles.qrContainer}>
        <QRCode value={referralLink} size={240} backgroundColor="#ffffff" color="#000000" />
      </View>

      <Text style={styles.adScanText}>Scan to download QuoteMate</Text>
      {subtitle}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.shareButton}
          onPress={handleShare}
          accessibilityRole="button"
          accessibilityLabel="Share your referral link"
        >
          <MaterialCommunityIcons name="share-variant" size={20} color={themeColors.onAccent} />
          <Text style={styles.shareButtonText}>Share Link</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.codeToggleButton}
          onPress={() => { handleCopyCode(); setShowCode(true); }}
          accessibilityRole="button"
          accessibilityLabel="Copy your referral link and show your code"
        >
          <MaterialCommunityIcons
            name={copied ? 'check' : 'content-copy'} size={20}
            color={copied ? themeColors.money : themeColors.accent}
          />
          <Text style={[styles.codeToggleText, copied && { color: themeColors.money }]}>
            {copied ? 'Copied!' : 'Copy'}
          </Text>
        </TouchableOpacity>
      </View>

      {showCode && (
        <View style={styles.codeBox}>
          <Text style={styles.codeText} selectable>{referralCode}</Text>
        </View>
      )}
    </Surface>
  );

  const renderFeaturePills = () => (
    <View style={styles.adFeaturePills}>
      {[
        { icon: 'robot' as const, label: 'AI-Powered' },
        { icon: 'currency-usd' as const, label: 'Live Pricing' },
        { icon: 'file-document-outline' as const, label: 'GST Ready' },
        { icon: 'wifi-off' as const, label: 'Offline' },
      ].map((feature, index) => (
        <View key={index} style={styles.adFeaturePill}>
          <MaterialCommunityIcons name={feature.icon} size={14} color={themeColors.accentText} />
          <Text style={styles.adFeaturePillText}>{feature.label}</Text>
        </View>
      ))}
    </View>
  );

  const renderApplyCode = () => {
    // Already attributed — confirm it and stop. No form to submit.
    if (!eligibility.canApply) {
      if (eligibility.reason === 'already_referred') {
        return (
          <Surface style={styles.card}>
            <View style={styles.referredByRow}>
              <MaterialCommunityIcons name="check-circle" size={20} color={themeColors.money} />
              <Text style={styles.referredByText}>You were referred by a mate</Text>
            </View>
          </Surface>
        );
      }
      // Pro user: the server will reject an apply, so explain rather than
      // showing a form that cannot succeed.
      return null;
    }

    return (
      <Surface style={styles.card}>
        <Title style={styles.sectionTitle}>Got a Referral Code?</Title>
        <Text style={styles.hint}>
          If a mate gave you their code, pop it in below so they get credited.
          It doesn&apos;t change your price or your plan.
        </Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            placeholder="QM-AB2CD3"
            placeholderTextColor={themeColors.textMuted}
            value={codeInput}
            onChangeText={setCodeInput}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            // A pasted link is normalised for us, so allow room for one.
            maxLength={64}
            returnKeyType="done"
            onSubmitEditing={() => { if (inputLooksValid) handleApplyCode(); }}
            editable={!applyingCode}
            accessibilityLabel="Referral code"
          />
          <TouchableOpacity
            style={[styles.applyButton, !inputLooksValid && styles.applyButtonDisabled]}
            onPress={handleApplyCode}
            disabled={applyingCode || !inputLooksValid}
            accessibilityRole="button"
            accessibilityLabel="Apply referral code"
          >
            {applyingCode
              ? <ActivityIndicator size="small" color={themeColors.onAccent} />
              : <Text style={styles.applyButtonText}>Apply</Text>}
          </TouchableOpacity>
        </View>
        {codeInput.trim().length > 0 && !inputLooksValid && (
          <Text style={styles.inputHelp}>Codes look like QM-AB2CD3 — you can paste the whole link too.</Text>
        )}
      </Surface>
    );
  };

  // ════════════════════════════════════════
  // AFFILIATE SCREEN
  // ════════════════════════════════════════

  if (referralInfo?.isAffiliate) {
    return (
      <View style={styles.container}>
      <GridBackground />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={themeColors.accent} />
          }
        >
          <WebContainer>
            {referralCode ? (
              <>
                {renderQrCard(null)}
                {renderFeaturePills()}

                {/* ── Your earnings ── */}
                <Surface style={styles.card}>
                  <Title style={styles.sectionTitle}>Your Earnings</Title>
                  <View style={styles.earningsGrid}>
                    <View style={styles.earningBox}>
                      <Text style={[styles.earningValue, { color: themeColors.money }]}>
                        {formatCurrency(referralInfo.totalEarnings)}
                      </Text>
                      <Text style={styles.earningLabel}>Earned</Text>
                    </View>
                    <View style={styles.earningBox}>
                      <Text style={[styles.earningValue, { color: themeColors.warning }]}>
                        {formatCurrency(referralInfo.pendingEarnings)}
                      </Text>
                      <Text style={styles.earningLabel}>Awaiting Payout</Text>
                    </View>
                    <View style={styles.earningBox}>
                      <Text style={[styles.earningValue, { color: themeColors.accentText }]}>
                        {formatCurrency(referralInfo.paidEarnings)}
                      </Text>
                      <Text style={styles.earningLabel}>Paid Out</Text>
                    </View>
                  </View>

                  <View style={styles.affiliateStatsRow}>
                    <View style={styles.affiliateStatItem}>
                      <Text style={styles.affiliateStatValue}>{referralInfo.totalReferrals}</Text>
                      <Text style={styles.affiliateStatLabel}>Signups</Text>
                    </View>
                    <View style={styles.affiliateStatDivider} />
                    <View style={styles.affiliateStatItem}>
                      <Text style={styles.affiliateStatValue}>{referralInfo.convertedReferrals}</Text>
                      <Text style={styles.affiliateStatLabel}>Subscribed</Text>
                    </View>
                    {commissionPercent !== null && (
                      <>
                        <View style={styles.affiliateStatDivider} />
                        <View style={styles.affiliateStatItem}>
                          <Text style={[styles.affiliateStatValue, { color: themeColors.accentText }]}>
                            {commissionPercent}%
                          </Text>
                          <Text style={styles.affiliateStatLabel}>Your Cut</Text>
                        </View>
                      </>
                    )}
                  </View>

                  {referralInfo.lastPayoutAt && (
                    <Text style={styles.payoutNote}>
                      Last payout {new Date(referralInfo.lastPayoutAt).toLocaleDateString('en-AU', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </Text>
                  )}
                </Surface>

                {/* ── How the commission works ── */}
                {commissionPercent !== null && (
                  <Surface style={styles.card}>
                    <Title style={styles.sectionTitle}>How Your Commission Works</Title>
                    <Text style={styles.gameplanIntro}>
                      You earn {commissionPercent}% of the net revenue on every subscription payment
                      from someone who signed up with your code — for as long as they stay
                      subscribed. Net revenue is what&apos;s left after the app store or card
                      processor takes their cut, which is why the amount differs by platform.
                    </Text>

                    <View style={styles.rateRow}>
                      <View style={styles.rateItem}>
                        <MaterialCommunityIcons name="apple" size={18} color={themeColors.textSecondary} />
                        <Text style={styles.rateLabel}>App Store</Text>
                        <Text style={styles.rateValue}>{formatCurrency(perUserIos)}/mo</Text>
                      </View>
                      <View style={styles.rateItem}>
                        <MaterialCommunityIcons name="web" size={18} color={themeColors.textSecondary} />
                        <Text style={styles.rateLabel}>Web</Text>
                        <Text style={styles.rateValue}>{formatCurrency(perUserWeb)}/mo</Text>
                      </View>
                    </View>
                    <Text style={styles.disclaimer}>
                      Per subscriber on the $49/month plan. Commission is paid by bank transfer
                      once a payment has settled and is not refunded.
                    </Text>
                  </Surface>
                )}

                {/* ── Illustrative projection ── */}
                {projection.length > 0 && (
                  <Surface style={styles.card}>
                    <Title style={styles.sectionTitle}>Example Monthly Earnings</Title>
                    <Text style={styles.projectionSubtext}>
                      An illustration only — based on your {commissionPercent}% rate at App Store
                      fees. Actual earnings depend entirely on how many people subscribe and stay
                      subscribed.
                    </Text>

                    <View style={styles.chartContainer}>
                      {projection.map((item) => {
                        const barHeight = maxProjection > 0
                          ? Math.max(8, (item.amountCents / maxProjection) * 140)
                          : 8;
                        return (
                          <View key={item.users} style={styles.chartBarWrapper}>
                            <Text style={styles.chartBarAmount}>{formatCurrency(item.amountCents)}</Text>
                            <View style={[styles.chartBar, { height: barHeight }]} />
                            <Text style={styles.chartBarLabel}>{item.users}</Text>
                          </View>
                        );
                      })}
                    </View>
                    <Text style={styles.chartFooter}>active subscribers</Text>
                  </Surface>
                )}

                {/* ── Sharing tips ── */}
                <Surface style={styles.card}>
                  <Title style={styles.sectionTitle}>Getting the Word Out</Title>
                  {[
                    { icon: 'qrcode-scan' as const, title: 'Show the QR code', text: 'On site, at the supplier, at trade nights — it takes a couple of seconds to scan.' },
                    { icon: 'cellphone-play' as const, title: 'Give them a quick demo', text: 'Open the app and show how fast a quote comes together. That does more than any pitch.' },
                    { icon: 'account-group' as const, title: 'Trade groups', text: 'A genuine recommendation in a trade group lands far better than an ad. Follow each group\'s rules on promotion.' },
                  ].map((item, index) => (
                    <View key={index} style={styles.gameplanStep}>
                      <View style={styles.gameplanIcon}>
                        <MaterialCommunityIcons name={item.icon} size={22} color={themeColors.accentText} />
                      </View>
                      <View style={styles.gameplanContent}>
                        <Text style={styles.gameplanStepTitle}>{item.title}</Text>
                        <Text style={styles.gameplanStepText}>{item.text}</Text>
                      </View>
                    </View>
                  ))}
                </Surface>

                {/* ── Recent earnings ── */}
                <Surface style={styles.card}>
                  <Title style={styles.sectionTitle}>Recent Earnings</Title>
                  {loadingEarnings ? (
                    <ActivityIndicator size="small" color={themeColors.accentText} />
                  ) : earnings.length === 0 ? (
                    <Text style={styles.hint}>
                      No commission yet. Earnings appear here once someone who used your code
                      completes a subscription payment.
                    </Text>
                  ) : (
                    earnings.slice(0, 15).map((earning) => (
                      <View key={earning.id} style={styles.earningRow}>
                        <View style={styles.earningRowLeft}>
                          <MaterialCommunityIcons name={getPlatformIcon(earning.platform)} size={20} color={themeColors.textSecondary} />
                          <View style={styles.earningRowInfo}>
                            <Text style={styles.earningRowEmail}>{earning.referredUserEmail}</Text>
                            <Text style={styles.earningRowPeriod}>{earning.billingPeriod}</Text>
                          </View>
                        </View>
                        <View style={styles.earningRowRight}>
                          <Text style={styles.earningRowAmount}>{formatCurrency(earning.commissionAmount)}</Text>
                          <Text style={[styles.earningRowStatus, { color: getStatusColor(earning.status) }]}>
                            {earning.status}
                          </Text>
                        </View>
                      </View>
                    ))
                  )}
                </Surface>

                {/* Support contact — plain email, no off-platform messaging CTA
                    on a monetisation screen. */}
                <TouchableOpacity
                  style={styles.supportButton}
                  onPress={() => Linking.openURL(
                    `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('QuoteMate affiliate question')}`
                  )}
                  accessibilityRole="button"
                  accessibilityLabel="Email support about the affiliate program"
                >
                  <MaterialCommunityIcons name="email-outline" size={20} color={themeColors.accentText} />
                  <Text style={styles.supportButtonText}>Questions about payouts? Email us</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Surface style={styles.card}>
                <Title style={styles.sectionTitle}>Get Your Affiliate Code</Title>
                <Text style={styles.hint}>
                  Create your code to start sharing QuoteMate and earning commission.
                </Text>
                {renderGenerateCode()}
              </Surface>
            )}
          </WebContainer>
        </ScrollView>

        <AlertModal
          visible={modal.visible}
          onDismiss={() => setModal(m => ({ ...m, visible: false }))}
          type={modal.type} title={modal.title} message={modal.message}
          showConfetti={modal.type === 'success'}
        />
      </View>
    );
  }

  // ════════════════════════════════════════
  // REGULAR REFERRAL SCREEN
  // ════════════════════════════════════════

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={themeColors.accent} />
        }
      >
        <WebContainer>
          {referralCode ? (
            <>
              {renderQrCard(
                <View style={styles.regularQrSubtext}>
                  <MaterialCommunityIcons name="account-plus" size={18} color={themeColors.accentText} />
                  <Text style={styles.regularQrSubtextText}>
                    Help your mates find QuoteMate
                  </Text>
                </View>
              )}
              {renderFeaturePills()}
            </>
          ) : (
            <Surface style={styles.heroCard}>
              <MaterialCommunityIcons name="account-plus" size={48} color={themeColors.accentText} />
              <Title style={styles.heroTitle}>Refer a Mate</Title>
              <Text style={styles.heroText}>
                Create your referral code and share QuoteMate with other tradies.
              </Text>
              {renderGenerateCode()}
            </Surface>
          )}

          {renderApplyCode()}

          {/* How it works — states plainly that a code is attribution only, so
              nobody expects a discount that does not exist. */}
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>How It Works</Title>
            {[
              { step: '1', text: 'Share your code or QR with other tradies' },
              { step: '2', text: 'They download QuoteMate and enter your code' },
              { step: '3', text: 'You can see how many mates you\'ve referred here' },
            ].map((item) => (
              <View key={item.step} style={styles.stepRow}>
                <View style={styles.stepCircle}>
                  <Text style={styles.stepNumber}>{item.step}</Text>
                </View>
                <Text style={styles.stepText}>{item.text}</Text>
              </View>
            ))}
            <Text style={styles.disclaimer}>
              Referral codes are for keeping track of who told who about QuoteMate. They
              don&apos;t change the price of a subscription or add anything to your plan.
            </Text>
          </Surface>

          {referralCode && (
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{referralInfo?.totalReferrals ?? 0}</Text>
                <Text style={styles.statLabel}>Mates referred</Text>
              </View>
            </View>
          )}
        </WebContainer>
      </ScrollView>

      <AlertModal
        visible={modal.visible}
        onDismiss={() => setModal(m => ({ ...m, visible: false }))}
        type={modal.type} title={modal.title} message={modal.message}
        showConfetti={modal.type === 'success'}
      />
    </View>
  );
}

// ════════════════════════════════════════
// STYLES
// ════════════════════════════════════════

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },

  // ── Shared ──
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.accent,
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
    marginTop: 8,
  },
  generateButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.onAccent,
  },
  hint: {
    fontSize: 14,
    color: t.colors.textSecondary,
    marginBottom: 12,
    lineHeight: 20,
  },
  disclaimer: {
    fontSize: 12,
    color: t.colors.textMuted,
    lineHeight: 18,
    marginTop: 14,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputHelp: {
    fontSize: 12,
    color: t.colors.warning,
    marginTop: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: t.colors.bg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: t.colors.text,
    borderWidth: 1,
    borderColor: t.colors.border,
    letterSpacing: 1,
    ...(Platform.OS === 'web' && { outlineStyle: 'none' as any }),
  },
  applyButton: {
    backgroundColor: t.colors.accent,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 88,
  },
  applyButtonDisabled: {
    opacity: 0.5,
  },
  applyButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.onAccent,
  },
  referredByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  referredByText: {
    fontSize: 15,
    color: t.colors.money,
    fontWeight: '600',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 12,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.accentText,
  },
  stepText: {
    fontSize: 14,
    color: t.colors.textSecondary,
    flex: 1,
  },

  // ── Regular referral screen ──
  heroCard: {
    padding: 24,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
    alignItems: 'center',
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: t.colors.text,
    textAlign: 'center',
    marginTop: 12,
  },
  heroText: {
    fontSize: 15,
    color: t.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    elevation: 2,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: t.colors.text,
  },
  statLabel: {
    fontSize: 12,
    color: t.colors.textSecondary,
    marginTop: 4,
  },

  // ── QR hero card ──
  adQrCard: {
    padding: 24,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
    alignItems: 'center',
  },
  adLogo: {
    width: 90,
    height: 90,
    borderRadius: 18,
    marginBottom: 20,
  },
  adScanText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.textSecondary,
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 4,
  },
  adFeaturePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  adFeaturePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaceRaised,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
    elevation: 1,
  },
  adFeaturePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: t.colors.text,
  },
  regularQrSubtext: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  regularQrSubtextText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.warning,
    textAlign: 'center',
  },
  qrContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    width: '100%',
  },
  shareButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.accent,
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  shareButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.onAccent,
  },
  codeToggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.accentSubtle,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    gap: 6,
  },
  codeToggleText: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.accentText,
  },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg,
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
    borderWidth: 2,
    borderColor: t.colors.accentSubtle,
    borderStyle: 'dashed',
    gap: 10,
    width: '100%',
  },
  codeText: {
    fontSize: 22,
    fontWeight: '800',
    color: t.colors.accentText,
    letterSpacing: 2,
  },

  // ── Affiliate earnings ──
  earningsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  earningBox: {
    flex: 1,
    backgroundColor: t.colors.bg,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  earningLabel: {
    fontSize: 11,
    color: t.colors.textSecondary,
    marginTop: 4,
    fontWeight: '500',
    textAlign: 'center',
  },
  earningValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  affiliateStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  affiliateStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  affiliateStatValue: {
    fontSize: 24,
    fontWeight: '800',
    color: t.colors.text,
  },
  affiliateStatLabel: {
    fontSize: 11,
    color: t.colors.textSecondary,
    marginTop: 2,
    fontWeight: '500',
  },
  affiliateStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: t.colors.border,
  },
  payoutNote: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 12,
    textAlign: 'center',
  },

  // ── Commission rates ──
  rateRow: {
    flexDirection: 'row',
    gap: 10,
  },
  rateItem: {
    flex: 1,
    backgroundColor: t.colors.bg,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  rateLabel: {
    fontSize: 12,
    color: t.colors.textSecondary,
    fontWeight: '500',
  },
  rateValue: {
    fontSize: 17,
    fontWeight: '800',
    color: t.colors.money,
  },

  // ── Projection chart ──
  projectionSubtext: {
    fontSize: 13,
    color: t.colors.textSecondary,
    marginBottom: 20,
    lineHeight: 19,
  },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 180,
    paddingTop: 20,
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  chartBarWrapper: {
    alignItems: 'center',
    flex: 1,
  },
  chartBarAmount: {
    fontSize: 10,
    fontWeight: '700',
    color: t.colors.money,
    marginBottom: 4,
  },
  chartBar: {
    width: 30,
    borderRadius: 6,
    backgroundColor: t.colors.accent,
  },
  chartBarLabel: {
    fontSize: 12,
    color: t.colors.textSecondary,
    marginTop: 6,
    fontWeight: '600',
  },
  chartFooter: {
    fontSize: 11,
    color: t.colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },

  // ── Sharing tips ──
  gameplanIntro: {
    fontSize: 14,
    color: t.colors.textSecondary,
    lineHeight: 21,
    marginBottom: 16,
  },
  gameplanStep: {
    flexDirection: 'row',
    marginBottom: 18,
    gap: 14,
  },
  gameplanIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameplanContent: {
    flex: 1,
  },
  gameplanStepTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text,
    marginBottom: 3,
  },
  gameplanStepText: {
    fontSize: 14,
    color: t.colors.textSecondary,
    lineHeight: 20,
  },

  // ── Support ──
  supportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.accentSubtle,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  supportButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.accentText,
  },

  // ── Earnings list ──
  earningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  earningRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  earningRowInfo: {
    flex: 1,
  },
  earningRowEmail: {
    fontSize: 14,
    color: t.colors.text,
    fontWeight: '500',
  },
  earningRowPeriod: {
    fontSize: 12,
    color: t.colors.textSecondary,
    marginTop: 2,
  },
  earningRowRight: {
    alignItems: 'flex-end',
  },
  earningRowAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.money,
  },
  earningRowStatus: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
    marginTop: 2,
  },
}));
