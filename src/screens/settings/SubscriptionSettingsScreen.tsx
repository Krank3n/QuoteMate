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
  Platform,
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

export function SubscriptionSettingsScreen() {
  const navigation = useNavigation<any>();
  const { subscriptionStatus } = useStore();

  // On iOS, show a different message since Apple requires using their IAP
  if (Platform.OS === 'ios') {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <WebContainer>
            <Surface style={styles.card}>
              <Title style={styles.sectionTitle}>Your Subscription</Title>
              <View style={styles.subscriptionInfo}>
                <View style={styles.freeStatusContainer}>
                  <MaterialCommunityIcons name="information" size={32} color={colors.primary} />
                  <Text style={styles.freeStatusTitle}>iOS Subscriptions</Text>
                </View>
                <Text style={styles.upgradeDescription}>
                  Subscription features are coming soon to iOS. In the meantime, you can continue using the free tier with {subscriptionStatus?.freeQuotesLimit || 5} quote analyses.
                </Text>
              </View>
            </Surface>
          </WebContainer>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Your Subscription</Title>

            <View style={styles.subscriptionInfo}>
              {subscriptionStatus?.isPro ? (
                <>
                  <View style={styles.proBadge}>
                    <MaterialCommunityIcons name="crown" size={32} color={colors.secondary} />
                    <Text style={styles.proText}>Pro Member</Text>
                  </View>
                  <Text style={styles.proStatusText}>
                    You have unlimited quote analyses. Thank you for your support!
                  </Text>

                  <View style={styles.benefitsList}>
                    <View style={styles.benefitItem}>
                      <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
                      <Text style={styles.benefitText}>Unlimited quote analyses</Text>
                    </View>
                    <View style={styles.benefitItem}>
                      <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
                      <Text style={styles.benefitText}>Priority support</Text>
                    </View>
                    <View style={styles.benefitItem}>
                      <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
                      <Text style={styles.benefitText}>All future features</Text>
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
              ) : (
                <>
                  <View style={styles.freeStatusContainer}>
                    <MaterialCommunityIcons name="account-outline" size={32} color={colors.onSurface} />
                    <Text style={styles.freeStatusTitle}>Free Plan</Text>
                  </View>

                  <View style={styles.quotaInfo}>
                    <Text style={styles.quotaText}>
                      {subscriptionStatus?.quotesThisMonth || 0} of {subscriptionStatus?.freeQuotesLimit || 5} quote analyses used this month
                    </Text>
                    <View style={styles.progressBar}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${Math.min(((subscriptionStatus?.quotesThisMonth || 0) / (subscriptionStatus?.freeQuotesLimit || 5)) * 100, 100)}%`
                          }
                        ]}
                      />
                    </View>
                  </View>

                  <Text style={styles.upgradeDescription}>
                    Upgrade to Pro for unlimited quote analyses, priority support, and all future features.
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
              )}
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
