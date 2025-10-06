/**
 * Paywall Screen
 * Shows subscription options when free quote limit is reached
 */

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import {
  Text,
  Button,
  Surface,
  Title,
  List,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import { colors } from '../theme';

export function PaywallScreen() {
  const navigation = useNavigation<any>();
  const { subscriptionStatus, upgradeToProMock } = useStore();
  const [isUpgrading, setIsUpgrading] = useState(false);

  const quotesUsed = subscriptionStatus?.quotesThisMonth || 0;
  const quotesLimit = subscriptionStatus?.freeQuotesLimit || 5;

  const handleUpgrade = async () => {
    setIsUpgrading(true);

    try {
      // In production, this would integrate with:
      // - iOS: StoreKit / RevenueCat
      // - Android: Google Play Billing / RevenueCat
      await upgradeToProMock();

      Alert.alert(
        'Success!',
        'Welcome to QuoteMate Pro! You now have unlimited quote analyses.',
        [
          {
            text: 'OK',
            onPress: () => navigation.goBack(),
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to upgrade. Please try again.');
    } finally {
      setIsUpgrading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <MaterialCommunityIcons
          name="crown"
          size={80}
          color={colors.secondary}
        />
        <Title style={styles.title}>Upgrade to Pro</Title>
        <Text style={styles.subtitle}>
          You've used {quotesUsed} of {quotesLimit} free quote analyses this month
        </Text>
      </View>

      <Surface style={styles.planCard}>
        <View style={styles.planHeader}>
          <Text style={styles.planName}>QuoteMate Pro</Text>
          <View style={styles.priceContainer}>
            <Text style={styles.currency}>$</Text>
            <Text style={styles.price}>19</Text>
            <Text style={styles.period}>/month</Text>
          </View>
        </View>

        <View style={styles.features}>
          <View style={styles.feature}>
            <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
            <Text style={styles.featureText}>Unlimited quote analyses per month</Text>
          </View>

          <View style={styles.feature}>
            <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
            <Text style={styles.featureText}>Priority customer support</Text>
          </View>

          <View style={styles.feature}>
            <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
            <Text style={styles.featureText}>Custom branding with logo</Text>
          </View>

          <View style={styles.feature}>
            <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
            <Text style={styles.featureText}>Advanced reporting</Text>
          </View>

          <View style={styles.feature}>
            <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
            <Text style={styles.featureText}>Future features included</Text>
          </View>
        </View>

        <Button
          mode="contained"
          onPress={handleUpgrade}
          style={styles.upgradeButton}
          contentStyle={styles.upgradeButtonContent}
          loading={isUpgrading}
          disabled={isUpgrading}
        >
          Start Pro Subscription
        </Button>

        <Text style={styles.disclaimer}>
          * This is a demo version. In production, payment would be processed through App Store or Google Play.
        </Text>
      </Surface>

      <Surface style={styles.freeCard}>
        <Text style={styles.freeTitle}>Free Plan</Text>
        <Text style={styles.freeText}>
          • {quotesLimit} quote analyses per month{'\n'}
          • Resets on the 1st of each month{'\n'}
          • All core features included
        </Text>
      </Surface>

      <Button
        mode="text"
        onPress={() => navigation.goBack()}
        style={styles.backButton}
      >
        Maybe Later
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    alignItems: 'center',
    padding: 32,
    paddingTop: 48,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.onSurface,
    textAlign: 'center',
  },
  planCard: {
    margin: 20,
    padding: 24,
    borderRadius: 12,
    elevation: 4,
  },
  planHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  planName: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  currency: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
  },
  price: {
    fontSize: 48,
    fontWeight: 'bold',
    color: colors.primary,
  },
  period: {
    fontSize: 16,
    color: colors.onSurface,
    marginTop: 24,
  },
  features: {
    marginBottom: 24,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  featureText: {
    fontSize: 16,
    marginLeft: 12,
    flex: 1,
  },
  upgradeButton: {
    marginBottom: 16,
  },
  upgradeButtonContent: {
    paddingVertical: 8,
  },
  disclaimer: {
    fontSize: 12,
    color: colors.onSurface,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  freeCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
  },
  freeTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  freeText: {
    fontSize: 14,
    color: colors.onSurface,
    lineHeight: 22,
  },
  backButton: {
    marginBottom: 40,
  },
});
