/**
 * Referral Screen
 * Users can share their referral code and enter a friend's code.
 * Successful referrals grant 3 months of free Pro access.
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
} from 'react-native';
import {
  Text,
  Surface,
  Title,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal, AlertType } from '../../components/AlertModal';
import { ReferralInfo } from '../../types';
import { firestoreService } from '../../services/firestoreService';
import { auth } from '../../config/firebase';

export function ReferralScreen() {
  const [referralInfo, setReferralInfo] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [codeInput, setCodeInput] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [copied, setCopied] = useState(false);
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

  useEffect(() => {
    loadReferralInfo();
  }, [loadReferralInfo]);

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
        referralCode: data.referralCode,
        referredBy: null,
        totalReferrals: 0,
        convertedReferrals: 0,
        rewardMonthsEarned: 0,
        rewardExpiresAt: null,
      });
    } catch (error: any) {
      console.error('Failed to generate referral code:', error);
      showModal('error', 'Error', 'Failed to generate referral code. Please try again.');
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleCopyCode = async () => {
    if (!referralInfo?.referralCode) return;
    if (Platform.OS === 'web' && navigator?.clipboard) {
      await navigator.clipboard.writeText(referralInfo.referralCode);
    }
    // On native, the share sheet is the primary way to share the code
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!referralInfo?.referralCode) return;

    try {
      await Share.share({
        message: `Try QuoteMate for creating professional trade quotes! Use my referral code ${referralInfo.referralCode} when you sign up, and we both benefit. Get it at https://quotemateapp.au`,
      });
    } catch (error) {
      console.error('Share failed:', error);
    }
  };

  const handleApplyCode = async () => {
    const code = codeInput.trim().toUpperCase();
    if (!code) {
      showModal('warning', 'Enter a Code', 'Please enter a referral code.');
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

      showModal('success', 'Code Applied!', 'The referral code has been applied. When you upgrade to Pro, your referrer will get 3 months free!');

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

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const hasActiveReward = referralInfo?.rewardExpiresAt && new Date(referralInfo.rewardExpiresAt) > new Date();

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          {/* Hero */}
          <Surface style={styles.heroCard}>
            <MaterialCommunityIcons name="gift" size={48} color={colors.secondary} />
            <Title style={styles.heroTitle}>Refer a Friend, Get 3 Months Free</Title>
            <Text style={styles.heroText}>
              Share your referral code with mates. When they sign up and upgrade to Pro,
              you get 3 months of free Pro access.
            </Text>
          </Surface>

          {/* Referral Code */}
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Your Referral Code</Title>
            {referralInfo?.referralCode ? (
              <>
                <TouchableOpacity style={styles.codeBox} onPress={handleCopyCode}>
                  <Text style={styles.codeText}>{referralInfo.referralCode}</Text>
                  <MaterialCommunityIcons
                    name={copied ? 'check' : 'content-copy'}
                    size={22}
                    color={copied ? colors.success : colors.primary}
                  />
                </TouchableOpacity>
                {copied && (
                  <Text style={styles.copiedText}>Copied to clipboard!</Text>
                )}

                <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
                  <MaterialCommunityIcons name="share-variant" size={20} color={colors.white} />
                  <Text style={styles.shareButtonText}>Share with Mates</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={styles.generateButton}
                onPress={handleGenerateCode}
                disabled={generatingCode}
              >
                {generatingCode ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <MaterialCommunityIcons name="plus" size={20} color={colors.white} />
                )}
                <Text style={styles.generateButtonText}>
                  {generatingCode ? 'Generating...' : 'Get My Referral Code'}
                </Text>
              </TouchableOpacity>
            )}
          </Surface>

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
                  <Text style={styles.rewardText}>
                    Free Pro until {formatDate(new Date(referralInfo.rewardExpiresAt!))}
                  </Text>
                </View>
              )}
            </Surface>
          )}

          {/* Enter Referral Code */}
          {!referralInfo?.referredBy && (
            <Surface style={styles.card}>
              <Title style={styles.sectionTitle}>Have a Referral Code?</Title>
              <Text style={styles.hint}>
                If a friend gave you their code, enter it below.
              </Text>
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
                  {applyingCode ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <Text style={styles.applyButtonText}>Apply</Text>
                  )}
                </TouchableOpacity>
              </View>
            </Surface>
          )}

          {referralInfo?.referredBy && (
            <Surface style={styles.card}>
              <View style={styles.referredByRow}>
                <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
                <Text style={styles.referredByText}>
                  You were referred by a friend
                </Text>
              </View>
            </Surface>
          )}

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
        type={modal.type}
        title={modal.title}
        message={modal.message}
        showConfetti={modal.type === 'success'}
      />
    </View>
  );
}

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
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 16,
    borderWidth: 2,
    borderColor: colors.primary + '40',
    borderStyle: 'dashed',
    gap: 12,
  },
  codeText: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 2,
  },
  copiedText: {
    fontSize: 13,
    color: colors.success,
    textAlign: 'center',
    marginTop: 6,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 14,
    gap: 8,
  },
  shareButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
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
    ...(Platform.OS === 'web' && {
      outlineStyle: 'none' as any,
    }),
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
});
