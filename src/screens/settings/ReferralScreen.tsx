/**
 * Referral Screen
 * Two distinct experiences:
 * - Affiliates: QR-first layout with earnings dashboard and commission tracking
 * - Regular users: Simple referral code sharing for 3 months free Pro
 */

import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import {
  Text,
  Surface,
  Title,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { getFunctions, httpsCallable } from 'firebase/functions';
import QRCode from 'react-native-qrcode-svg';

import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal, AlertType } from '../../components/AlertModal';
import { ReferralInfo, AffiliateEarning } from '../../types';
import { firestoreService } from '../../services/firestoreService';
import { auth } from '../../config/firebase';

const REFERRAL_BASE_URL = 'https://quotemateapp.au/ref/';

export function ReferralScreen() {
  const [referralInfo, setReferralInfo] = useState<ReferralInfo | null>(null);
  const [earnings, setEarnings] = useState<AffiliateEarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEarnings, setLoadingEarnings] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [activeTab, setActiveTab] = useState<'qr' | 'dashboard'>('qr');
  const [modal, setModal] = useState<{ visible: boolean; type: AlertType; title: string; message: string }>({
    visible: false, type: 'info', title: '', message: '',
  });

  const showModal = (type: AlertType, title: string, message: string) => {
    setModal({ visible: true, type, title, message });
  };

  const loadReferralInfo = useCallback(async () => {
    try {
      const info = await firestoreService.loadReferralInfo();
      setReferralInfo(info);
    } catch (error) {
      console.error('Failed to load referral info:', error);
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
      const data = result.data as { summary: any; earnings: AffiliateEarning[] };
      setEarnings(data.earnings || []);
    } catch (error) {
      console.error('Failed to load affiliate earnings:', error);
    } finally {
      setLoadingEarnings(false);
    }
  }, []);

  useEffect(() => { loadReferralInfo(); }, [loadReferralInfo]);
  useEffect(() => {
    if (referralInfo?.isAffiliate) loadEarnings();
  }, [referralInfo?.isAffiliate, loadEarnings]);

  // ── Shared handlers ──

  const referralLink = referralInfo?.referralCode
    ? `${REFERRAL_BASE_URL}${referralInfo.referralCode}` : '';

  const commissionPercent = referralInfo?.commissionRate
    ? Math.round(referralInfo.commissionRate * 100) : 80;

  const hasActiveReward = referralInfo?.rewardExpiresAt && new Date(referralInfo.rewardExpiresAt) > new Date();

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
      const data = result.data as { referralCode: string };
      setReferralInfo({
        referralCode: data.referralCode, referredBy: null,
        totalReferrals: 0, convertedReferrals: 0, rewardMonthsEarned: 0, rewardExpiresAt: null,
        isAffiliate: false, commissionRate: 0, totalEarnings: 0, pendingEarnings: 0, paidEarnings: 0, lastPayoutAt: null,
      });
    } catch (error: any) {
      showModal('error', 'Error', 'Failed to generate referral code. Please try again.');
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleCopyCode = async () => {
    if (!referralInfo?.referralCode) return;
    if (Platform.OS === 'web' && navigator?.clipboard) {
      await navigator.clipboard.writeText(referralLink);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!referralInfo?.referralCode) return;
    try {
      await Share.share({
        message: referralInfo.isAffiliate
          ? `Try QuoteMate — the fastest way to create professional trade quotes and invoices! Sign up with my code ${referralInfo.referralCode} to get started. ${referralLink}`
          : `Try QuoteMate for creating professional trade quotes! Use my referral code ${referralInfo.referralCode} when you sign up, and we both benefit. ${referralLink}`,
      });
    } catch (error) {
      console.error('Share failed:', error);
    }
  };

  const handleApplyCode = async () => {
    const code = codeInput.trim().toUpperCase();
    if (!code) { showModal('warning', 'Enter a Code', 'Please enter a referral code.'); return; }
    if (!auth.currentUser) { showModal('warning', 'Sign In Required', 'Please sign in to apply a referral code.'); return; }

    setApplyingCode(true);
    try {
      const functions = getFunctions();
      const applyReferralCode = httpsCallable(functions, 'applyReferralCode');
      await applyReferralCode({ referralCode: code });
      showModal('success', 'Code Applied!', 'The referral code has been applied successfully!');
      setCodeInput('');
      await loadReferralInfo();
    } catch (error: any) {
      const msg = error?.message || 'Failed to apply referral code.';
      if (msg.includes('not found') || msg.includes('Invalid')) {
        showModal('error', 'Invalid Code', 'That referral code was not found. Please check and try again.');
      } else if (msg.includes('own code')) {
        showModal('error', 'Invalid Code', "You can't use your own referral code.");
      } else if (msg.includes('already')) {
        showModal('warning', 'Already Applied', 'You have already applied a referral code.');
      } else {
        showModal('error', 'Error', msg);
      }
    } finally {
      setApplyingCode(false);
    }
  };

  const formatDate = (date: Date) => date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const formatCurrency = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const getPlatformIcon = (platform: string) => {
    switch (platform) { case 'ios': return 'apple'; case 'android': return 'android'; case 'web': return 'web'; default: return 'help-circle'; }
  };
  const getStatusColor = (status: string) => {
    switch (status) { case 'pending': return colors.secondary; case 'confirmed': return colors.primary; case 'paid': return colors.success; case 'cancelled': return colors.error; default: return colors.onSurface; }
  };

  // ── Loading ──

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Generate code (no code yet) ──

  const renderGenerateCode = () => (
    <Surface style={styles.card}>
      <TouchableOpacity style={styles.generateButton} onPress={handleGenerateCode} disabled={generatingCode}>
        {generatingCode ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <MaterialCommunityIcons name="qrcode" size={20} color={colors.white} />
        )}
        <Text style={styles.generateButtonText}>
          {generatingCode ? 'Generating...' : 'Get My Referral Code'}
        </Text>
      </TouchableOpacity>
    </Surface>
  );

  // ── Enter a friend's code ──

  const renderApplyCode = () => (
    <>
      {!referralInfo?.referredBy && (
        <Surface style={styles.card}>
          <Title style={styles.sectionTitle}>Have a Referral Code?</Title>
          <Text style={styles.hint}>If a friend gave you their code, enter it below.</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. QM-AB12CD"
              placeholderTextColor={colors.onSurface + '80'}
              value={codeInput}
              onChangeText={setCodeInput}
              autoCapitalize="characters"
              maxLength={10}
            />
            <TouchableOpacity
              style={[styles.applyButton, !codeInput.trim() && styles.applyButtonDisabled]}
              onPress={handleApplyCode}
              disabled={applyingCode || !codeInput.trim()}
            >
              {applyingCode ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={styles.applyButtonText}>Apply</Text>}
            </TouchableOpacity>
          </View>
        </Surface>
      )}
      {referralInfo?.referredBy && (
        <Surface style={styles.card}>
          <View style={styles.referredByRow}>
            <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
            <Text style={styles.referredByText}>You were referred by a friend</Text>
          </View>
        </Surface>
      )}
    </>
  );

  // ── Earnings projection data ──
  // Shows what they COULD earn based on commission rate @ $29/mo avg
  const avgCommissionPerUser = Math.round(2900 * 0.85 * (referralInfo?.commissionRate || 0.50)); // cents (net after ~15% avg platform fee)
  const projectionData = [
    { users: 5, label: '5' },
    { users: 10, label: '10' },
    { users: 25, label: '25' },
    { users: 50, label: '50' },
    { users: 100, label: '100' },
  ];
  const maxProjection = 100 * avgCommissionPerUser;

  // ════════════════════════════════════════
  // AFFILIATE SCREEN
  // ════════════════════════════════════════

  if (referralInfo?.isAffiliate) {
    return (
      <View style={styles.container}>
        {/* Tab Switcher */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'qr' && styles.tabActive]}
            onPress={() => setActiveTab('qr')}
          >
            <MaterialCommunityIcons name="qrcode" size={20} color={activeTab === 'qr' ? colors.white : colors.onSurface} />
            <Text style={[styles.tabText, activeTab === 'qr' && styles.tabTextActive]}>QR Code</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'dashboard' && styles.tabActive]}
            onPress={() => setActiveTab('dashboard')}
          >
            <MaterialCommunityIcons name="chart-line" size={20} color={activeTab === 'dashboard' ? colors.white : colors.onSurface} />
            <Text style={[styles.tabText, activeTab === 'dashboard' && styles.tabTextActive]}>Dashboard</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={[styles.scrollContent, activeTab === 'qr' && styles.scrollContentGrow]}>
          <WebContainer>
            {activeTab === 'qr' ? (
              <>
                {referralInfo.referralCode ? (
                  <>
                    {/* Logo + QR hero card */}
                    <Surface style={styles.adQrCard}>
                      <Image
                        source={require('../../../assets/logo-scaled.png')}
                        style={styles.adLogo}
                        resizeMode="contain"
                      />

                      <View style={styles.qrContainer}>
                        <QRCode value={referralLink} size={240} backgroundColor="#ffffff" color="#000000" />
                      </View>

                      <Text style={styles.adScanText}>Scan to download on iOS & Android</Text>

                      <View style={styles.buttonRow}>
                        <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
                          <MaterialCommunityIcons name="share-variant" size={20} color={colors.white} />
                          <Text style={styles.shareButtonText}>Share Link</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.codeToggleButton}
                          onPress={() => { handleCopyCode(); setShowCode(true); }}
                        >
                          <MaterialCommunityIcons
                            name={copied ? 'check' : 'content-copy'} size={20}
                            color={copied ? colors.success : colors.primary}
                          />
                          <Text style={[styles.codeToggleText, copied && { color: colors.success }]}>
                            {copied ? 'Copied!' : 'Code'}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {showCode && (
                        <View style={styles.codeBox}>
                          <Text style={styles.codeText}>{referralInfo.referralCode}</Text>
                        </View>
                      )}
                    </Surface>

                    {/* Compact feature pills */}
                    <View style={styles.adFeaturePills}>
                      {[
                        { icon: 'robot' as const, label: 'AI-Powered' },
                        { icon: 'currency-usd' as const, label: 'Live Pricing' },
                        { icon: 'file-document-outline' as const, label: 'GST Ready' },
                        { icon: 'wifi-off' as const, label: 'Offline' },
                      ].map((feature, index) => (
                        <View key={index} style={styles.adFeaturePill}>
                          <MaterialCommunityIcons name={feature.icon} size={14} color={colors.primary} />
                          <Text style={styles.adFeaturePillText}>{feature.label}</Text>
                        </View>
                      ))}
                    </View>

                    <TouchableOpacity
                      style={styles.adWhatsappButton}
                      onPress={() => Linking.openURL('https://api.whatsapp.com/send/?phone=61480232922&text=Hey%20mate%21%20Got%20some%20feedback%20from%20a%20user%20about%20QuoteMate%3A%20&type=phone_number&app_absent=0')}
                    >
                      <MaterialCommunityIcons name="whatsapp" size={20} color="#064E3B" />
                      <Text style={styles.whatsappButtonText}>Got Feedback? Flick Me a Message</Text>
                    </TouchableOpacity>
                  </>
                ) : renderGenerateCode()}
              </>
            ) : (
              <>
                {/* ── Dashboard Tab ── */}

                {/* Your Bag */}
                {referralInfo.referralCode && (
                  <Surface style={styles.card}>
                    <Title style={styles.sectionTitle}>Your Bag</Title>
                    <View style={styles.earningsGrid}>
                      <View style={styles.earningBox}>
                        <Text style={[styles.earningValue, { color: colors.success }]}>
                          {formatCurrency(referralInfo.totalEarnings)}
                        </Text>
                        <Text style={styles.earningLabel}>Earned</Text>
                      </View>
                      <View style={styles.earningBox}>
                        <Text style={[styles.earningValue, { color: colors.secondary }]}>
                          {formatCurrency(referralInfo.pendingEarnings)}
                        </Text>
                        <Text style={styles.earningLabel}>Incoming</Text>
                      </View>
                      <View style={styles.earningBox}>
                        <Text style={[styles.earningValue, { color: colors.primary }]}>
                          {formatCurrency(referralInfo.paidEarnings)}
                        </Text>
                        <Text style={styles.earningLabel}>Cashed Out</Text>
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
                        <Text style={styles.affiliateStatLabel}>Paying</Text>
                      </View>
                      <View style={styles.affiliateStatDivider} />
                      <View style={styles.affiliateStatItem}>
                        <Text style={[styles.affiliateStatValue, { color: colors.primary }]}>{commissionPercent}%</Text>
                        <Text style={styles.affiliateStatLabel}>Your Cut</Text>
                      </View>
                    </View>

                    {hasActiveReward && (
                      <View style={styles.rewardBadge}>
                        <MaterialCommunityIcons name="crown" size={18} color={colors.secondary} />
                        <Text style={styles.rewardText}>Free Pro until {formatDate(new Date(referralInfo.rewardExpiresAt!))}</Text>
                      </View>
                    )}
                  </Surface>
                )}

                {/* Potential Earnings Graph */}
                <Surface style={styles.card}>
                  <Title style={styles.sectionTitle}>What You Could Be Making</Title>
                  <Text style={styles.projectionSubtext}>Monthly recurring income per active Pro user</Text>

                  <View style={styles.chartContainer}>
                    {projectionData.map((item) => {
                      const amount = item.users * avgCommissionPerUser;
                      const barHeight = Math.max(8, (amount / maxProjection) * 140);
                      return (
                        <View key={item.users} style={styles.chartBarWrapper}>
                          <Text style={styles.chartBarAmount}>{formatCurrency(amount)}</Text>
                          <View style={[styles.chartBar, { height: barHeight }]} />
                          <Text style={styles.chartBarLabel}>{item.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <Text style={styles.chartFooter}>users</Text>

                  <View style={styles.projectionHighlight}>
                    <Text style={styles.projectionHighlightText}>
                      50 users = <Text style={{ color: colors.success, fontWeight: '800' }}>{formatCurrency(50 * avgCommissionPerUser)}/mo</Text> hitting your account.
                    </Text>
                    <Text style={styles.projectionEmphasis}>Every. Single. Month.</Text>
                  </View>
                </Surface>

                {/* The Game Plan */}
                <Surface style={styles.card}>
                  <Title style={styles.sectionTitle}>The Game Plan</Title>
                  <Text style={styles.gameplanIntro}>
                    Here's the deal — you're earning {commissionPercent}% on every subscription payment from people you bring in. Not just once. Every month they stay subscribed, you get paid. That's passive income, legend.
                  </Text>

                  {[
                    { icon: 'qrcode-scan' as const, title: 'Flash the QR', text: 'At the pub, on site, at Bunnings — anywhere you bump into a tradie. Takes 2 seconds.' },
                    { icon: 'cellphone-play' as const, title: 'Give them a quick demo', text: 'Open the app, show them how fast they can bang out a quote. That\'s the hook — they\'ll be sold.' },
                    { icon: 'message-text' as const, title: 'Feedback is gold', text: 'If they want something added or changed, flick me a message straight away. Seriously — this is how I make the app better and keep people subscribed. Every bit of feedback helps us all earn more.', whatsapp: true },
                    { icon: 'cash-register' as const, title: 'Stack that bread', text: 'Every time they pay their monthly sub, your cut lands automatically. More users = more money. Simple.' },
                  ].map((item, index) => (
                    <View key={index} style={styles.gameplanStep}>
                      <View style={styles.gameplanIcon}>
                        <MaterialCommunityIcons name={item.icon} size={22} color={colors.primary} />
                      </View>
                      <View style={styles.gameplanContent}>
                        <Text style={styles.gameplanStepTitle}>{item.title}</Text>
                        <Text style={styles.gameplanStepText}>{item.text}</Text>
                        {'whatsapp' in item && item.whatsapp && (
                          <TouchableOpacity
                            style={styles.whatsappButton}
                            onPress={() => Linking.openURL('https://api.whatsapp.com/send/?phone=61480232922&text=Hey%20mate%21%20Got%20some%20feedback%20from%20a%20user%20about%20QuoteMate%3A%20&type=phone_number&app_absent=0')}
                          >
                            <MaterialCommunityIcons name="whatsapp" size={20} color="#064E3B" />
                            <Text style={styles.whatsappButtonText}>Message Me on WhatsApp</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  ))}
                </Surface>

                {/* Tips */}
                <Surface style={styles.card}>
                  <Title style={styles.sectionTitle}>Few Tips</Title>
                  {[
                    'Facebook trade groups are goldmines — one genuine post in a 10K group can land you heaps of signups',
                    'Don\'t sound like an ad. Just be a bloke recommending something you rate',
                    'Tradies talk to other tradies on site every day — one convo at smoko can snowball into 5 signups',
                    'SEND ME FEEDBACK. If someone says "I wish it did X" — message me. I\'m building this thing non-stop and the faster I hear what people want, the faster I ship it. That keeps them subscribed which keeps us both earning.',
                  ].map((tip, index) => (
                    <View key={index} style={styles.tipRow}>
                      <MaterialCommunityIcons name="lightning-bolt" size={18} color={colors.secondary} />
                      <Text style={styles.tipText}>{tip}</Text>
                    </View>
                  ))}
                </Surface>

                {/* Recent Earnings */}
                {earnings.length > 0 && (
                  <Surface style={styles.card}>
                    <Title style={styles.sectionTitle}>Recent Earnings</Title>
                    {loadingEarnings ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      earnings.slice(0, 15).map((earning) => (
                        <View key={earning.id} style={styles.earningRow}>
                          <View style={styles.earningRowLeft}>
                            <MaterialCommunityIcons name={getPlatformIcon(earning.platform)} size={20} color={colors.onSurface} />
                            <View style={styles.earningRowInfo}>
                              <Text style={styles.earningRowEmail}>{earning.referredUserEmail}</Text>
                              <Text style={styles.earningRowPeriod}>{earning.billingPeriod}</Text>
                            </View>
                          </View>
                          <View style={styles.earningRowRight}>
                            <Text style={styles.earningRowAmount}>{formatCurrency(earning.commissionAmount)}</Text>
                            <Text style={[styles.earningRowStatus, { color: getStatusColor(earning.status) }]}>{earning.status}</Text>
                          </View>
                        </View>
                      ))
                    )}
                  </Surface>
                )}
              </>
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
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          {/* QR Hero Card */}
          {referralInfo?.referralCode ? (
            <Surface style={styles.adQrCard}>
              <Image
                source={require('../../../assets/logo-scaled.png')}
                style={styles.adLogo}
                resizeMode="contain"
              />

              <View style={styles.qrContainer}>
                <QRCode value={referralLink} size={240} backgroundColor="#ffffff" color="#000000" />
              </View>

              <Text style={styles.adScanText}>Scan to download on iOS & Android</Text>

              <View style={styles.regularQrSubtext}>
                <MaterialCommunityIcons name="gift" size={18} color={colors.secondary} />
                <Text style={styles.regularQrSubtextText}>
                  You both get 3 months free Pro when they sign up!
                </Text>
              </View>

              <View style={styles.buttonRow}>
                <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
                  <MaterialCommunityIcons name="share-variant" size={20} color={colors.white} />
                  <Text style={styles.shareButtonText}>Share with Mates</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.codeToggleButton}
                  onPress={() => { handleCopyCode(); setShowCode(true); }}
                >
                  <MaterialCommunityIcons
                    name={copied ? 'check' : 'content-copy'} size={20}
                    color={copied ? colors.success : colors.primary}
                  />
                  <Text style={[styles.codeToggleText, copied && { color: colors.success }]}>
                    {copied ? 'Copied!' : 'Code'}
                  </Text>
                </TouchableOpacity>
              </View>

              {showCode && (
                <View style={styles.codeBox}>
                  <Text style={styles.codeText}>{referralInfo.referralCode}</Text>
                </View>
              )}
            </Surface>
          ) : (
            <Surface style={styles.heroCard}>
              <MaterialCommunityIcons name="gift" size={48} color={colors.secondary} />
              <Title style={styles.heroTitle}>Refer a Friend, Get 3 Months Free</Title>
              <Text style={styles.heroText}>
                Share your referral code with mates. When they sign up and upgrade to Pro,
                you get 3 months of free Pro access.
              </Text>
              {renderGenerateCode()}
            </Surface>
          )}

          {/* Feature pills */}
          {referralInfo?.referralCode && (
            <View style={styles.adFeaturePills}>
              {[
                { icon: 'robot' as const, label: 'AI-Powered' },
                { icon: 'currency-usd' as const, label: 'Live Pricing' },
                { icon: 'file-document-outline' as const, label: 'GST Ready' },
                { icon: 'wifi-off' as const, label: 'Offline' },
              ].map((feature, index) => (
                <View key={index} style={styles.adFeaturePill}>
                  <MaterialCommunityIcons name={feature.icon} size={14} color={colors.primary} />
                  <Text style={styles.adFeaturePillText}>{feature.label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Stats */}
          {referralInfo?.referralCode && (
            <Surface style={styles.card}>
              <Title style={styles.sectionTitle}>Your Stats</Title>
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{referralInfo.totalReferrals}</Text>
                  <Text style={styles.statLabel}>Referrals</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{referralInfo.convertedReferrals}</Text>
                  <Text style={styles.statLabel}>Converted</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{referralInfo.rewardMonthsEarned}</Text>
                  <Text style={styles.statLabel}>Months Earned</Text>
                </View>
              </View>

              {hasActiveReward && (
                <View style={styles.rewardBadge}>
                  <MaterialCommunityIcons name="crown" size={18} color={colors.secondary} />
                  <Text style={styles.rewardText}>Free Pro until {formatDate(new Date(referralInfo.rewardExpiresAt!))}</Text>
                </View>
              )}
            </Surface>
          )}

          {renderApplyCode()}

          {/* How it works */}
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>How It Works</Title>
            {[
              { step: '1', text: 'Share your unique referral code with friends' },
              { step: '2', text: 'They sign up and enter your code' },
              { step: '3', text: 'When they upgrade to Pro, you get 3 months free' },
              { step: '4', text: 'No limit — refer more friends, earn more free months' },
            ].map((item) => (
              <View key={item.step} style={styles.stepRow}>
                <View style={styles.stepCircle}>
                  <Text style={styles.stepNumber}>{item.step}</Text>
                </View>
                <Text style={styles.stepText}>{item.text}</Text>
              </View>
            ))}
          </Surface>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  scrollContentGrow: {
    flexGrow: 1,
  },



  // ── Shared ──
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
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
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  generateButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  rewardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary + '15',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 16,
    gap: 8,
  },
  rewardText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.secondary,
  },
  copiedText: {
    fontSize: 13,
    color: colors.success,
    textAlign: 'center',
    marginTop: 6,
  },
  hint: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.outline + '30',
    letterSpacing: 1,
    ...(Platform.OS === 'web' && { outlineStyle: 'none' as any }),
  },
  applyButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyButtonDisabled: {
    opacity: 0.5,
  },
  applyButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },
  referredByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  referredByText: {
    fontSize: 15,
    color: colors.success,
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
    backgroundColor: colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  stepText: {
    fontSize: 14,
    color: colors.onSurface,
    flex: 1,
  },

  // ── Regular referral screen ──
  heroCard: {
    padding: 24,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginTop: 12,
  },
  heroText: {
    fontSize: 15,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
  },
  statLabel: {
    fontSize: 12,
    color: colors.onSurface,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.outline + '30',
  },

  // ── Tab bar ──
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 4,
    elevation: 2,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSurface,
  },
  tabTextActive: {
    color: colors.white,
  },

  // ── Affiliate screen ──
  // ── Ad-style QR tab ──
  adQrCard: {
    padding: 24,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
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
    color: colors.onSurface,
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
    backgroundColor: colors.surface,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
    elevation: 1,
  },
  adFeaturePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  adWhatsappButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25D366',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
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
    color: colors.secondary,
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
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  shareButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  codeToggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary + '15',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    gap: 6,
  },
  codeToggleText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
    borderWidth: 2,
    borderColor: colors.primary + '40',
    borderStyle: 'dashed',
    gap: 10,
    width: '100%',
  },
  codeText: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 2,
  },
  earningsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  earningBox: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  earningLabel: {
    fontSize: 11,
    color: colors.onSurface,
    marginTop: 4,
    fontWeight: '500',
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
    borderTopColor: colors.outline + '20',
  },
  affiliateStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  affiliateStatValue: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  affiliateStatLabel: {
    fontSize: 11,
    color: colors.onSurface,
    marginTop: 2,
    fontWeight: '500',
  },
  affiliateStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.outline + '30',
  },
  // ── Earnings projection chart ──
  projectionSubtext: {
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 20,
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
    color: colors.success,
    marginBottom: 4,
  },
  chartBar: {
    width: 30,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  chartBarLabel: {
    fontSize: 12,
    color: colors.onSurface,
    marginTop: 6,
    fontWeight: '600',
  },
  chartFooter: {
    fontSize: 11,
    color: colors.onSurface + '80',
    textAlign: 'center',
    marginTop: 4,
  },
  projectionHighlight: {
    backgroundColor: colors.success + '15',
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
  },
  projectionHighlightText: {
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '500',
  },
  projectionEmphasis: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.success,
    textAlign: 'center',
    marginTop: 6,
    letterSpacing: 1,
  },

  // ── Game plan ──
  gameplanIntro: {
    fontSize: 15,
    color: colors.onSurface,
    lineHeight: 24,
    marginBottom: 20,
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
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameplanContent: {
    flex: 1,
  },
  gameplanStepTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 3,
  },
  gameplanStepText: {
    fontSize: 14,
    color: colors.onSurface,
    lineHeight: 20,
  },

  whatsappButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25D366',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 10,
    gap: 8,
    alignSelf: 'flex-start',
  },
  whatsappButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#064E3B',
  },

  // ── Pro tips ──
  tipRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    alignItems: 'flex-start',
  },
  tipText: {
    fontSize: 14,
    color: colors.onSurface,
    lineHeight: 20,
    flex: 1,
  },

  // ── Earnings list ──
  earningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.outline + '20',
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
    color: colors.text,
    fontWeight: '500',
  },
  earningRowPeriod: {
    fontSize: 12,
    color: colors.onSurface,
    marginTop: 2,
  },
  earningRowRight: {
    alignItems: 'flex-end',
  },
  earningRowAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.success,
  },
  earningRowStatus: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
    marginTop: 2,
  },
});
