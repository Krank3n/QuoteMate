/**
 * Subscription Settings Screen
 * Pro membership status and upgrade
 */

import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import {
  Text,
  Surface,
  Title,
  Button,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { TrialBanner } from '../../components/TrialBanner';
import { TRIAL_DAYS } from '../../utils/trialConfig';

export function SubscriptionSettingsScreen() {
  const navigation = useNavigation<any>();
  const { subscriptionStatus, quotes, getEffectivePlan } = useStore();
  const plan = getEffectivePlan();

  const renderPro = () => (
    <>
      <View style={styles.proBadge}>
        <MaterialCommunityIcons name="crown" size={32} color={colors.secondary} />
        <Text style={styles.proText}>Pro Member</Text>
      </View>
      <Text style={styles.proStatusText}>
        Pro is active — thanks for your support.
      </Text>

      <View style={styles.benefitsList}>
        <View style={styles.benefitItem}>
          <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
          <Text style={styles.benefitText}>1% Square platform fee (vs 1.7% on free)</Text>
        </View>
        <View style={styles.benefitItem}>
          <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
          <Text style={styles.benefitText}>All payment methods on quotes & invoices</Text>
        </View>
        <View style={styles.benefitItem}>
          <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
          <Text style={styles.benefitText}>Send without a Square pay link required</Text>
        </View>
        <View style={styles.benefitItem}>
          <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
          <Text style={styles.benefitText}>Priority support</Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={() => navigation.navigate('Paywall' as never)}
        style={styles.manageSubscriptionButton}
      >
        <Text style={styles.manageSubscriptionText}>Manage Subscription</Text>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.primary} />
      </TouchableOpacity>
    </>
  );

  const renderTrial = () => (
    <>
      <View style={styles.freeStatusContainer}>
        <MaterialCommunityIcons name="clock-fast" size={32} color={colors.primary} />
        <Text style={styles.freeStatusTitle}>Trial</Text>
      </View>

      <View style={styles.quotaInfo}>
        {subscriptionStatus?.trialStartedAt ? (
          <TrialBanner
            trialStartedAt={subscriptionStatus.trialStartedAt}
            quoteCount={quotes.length}
            compact
          />
        ) : (
          <>
            <Text style={styles.quotaText}>
              {TRIAL_DAYS}-day free trial — starts when you create your first quote
            </Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: '0%' }]} />
            </View>
          </>
        )}
      </View>

      <Text style={styles.upgradeDescription}>
        You've got full access to Pro features for your {TRIAL_DAYS}-day trial.
        {'\n\n'}
        Once it ends, the Free plan kicks in. You can still collect online payments
        seamlessly via Square, with a small platform fee added to the customer's bill.
        {'\n\n'}
        Want to help your clients avoid card surcharges? Go Pro to unlock Bank
        Transfer options and score discounted card rates.
      </Text>

      <Button
        mode="contained"
        onPress={() => navigation.navigate('Paywall' as never)}
        style={styles.upgradeButton}
        contentStyle={styles.upgradeButtonContent}
        icon="crown"
      >
        Upgrade to Pro
      </Button>
    </>
  );

  const renderFree = () => (
    <>
      <View style={styles.freeStatusContainer}>
        <MaterialCommunityIcons name="account-outline" size={32} color={colors.onSurface} />
        <Text style={styles.freeStatusTitle}>Free Plan</Text>
      </View>

      <View style={styles.benefitsList}>
        <View style={styles.benefitItem}>
          <MaterialCommunityIcons name="information-outline" size={20} color={colors.primary} />
          <Text style={styles.benefitText}>1.7% platform fee on Square payments</Text>
        </View>
        <View style={styles.benefitItem}>
          <MaterialCommunityIcons name="information-outline" size={20} color={colors.primary} />
          <Text style={styles.benefitText}>Square is the only payment method shown to customers</Text>
        </View>
        <View style={styles.benefitItem}>
          <MaterialCommunityIcons name="information-outline" size={20} color={colors.primary} />
          <Text style={styles.benefitText}>Square link required on every quote & invoice</Text>
        </View>
      </View>

      <Text style={styles.upgradeDescription}>
        Upgrade to Pro to drop the platform fee from 1.7% to 1%, unlock bank
        transfer / PayID / BPAY / PayPal on documents, and send without a Square
        link required.
      </Text>

      <Button
        mode="contained"
        onPress={() => navigation.navigate('Paywall' as never)}
        style={styles.upgradeButton}
        contentStyle={styles.upgradeButtonContent}
        icon="crown"
      >
        Upgrade to Pro
      </Button>
    </>
  );

  return (
    <View style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Your Subscription</Title>

            <View style={styles.subscriptionInfo}>
              {plan === 'pro' ? renderPro() : plan === 'trial' ? renderTrial() : renderFree()}
            </View>
          </Surface>
        </WebContainer>
      </ScrollView>
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
    paddingBottom: 32,
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
    marginBottom: 16,
  },
  subscriptionInfo: {
    marginTop: 8,
  },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningBg,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  proText: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.secondary,
    marginLeft: 12,
  },
  proStatusText: {
    fontSize: 15,
    color: colors.onSurface,
    marginBottom: 20,
    lineHeight: 22,
  },
  benefitsList: {
    marginBottom: 20,
  },
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  benefitText: {
    fontSize: 15,
    color: colors.text,
    marginLeft: 12,
  },
  manageSubscriptionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.primary + '10',
    borderRadius: 8,
  },
  manageSubscriptionText: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '600',
  },
  freeStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  freeStatusTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
    marginLeft: 12,
  },
  quotaInfo: {
    backgroundColor: colors.background,
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
  },
  quotaText: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 12,
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.outline + '30',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  upgradeDescription: {
    fontSize: 15,
    color: colors.onSurface,
    marginBottom: 20,
    lineHeight: 22,
  },
  upgradeButton: {
    marginTop: 8,
  },
  upgradeButtonContent: {
    paddingVertical: 8,
  },
});
