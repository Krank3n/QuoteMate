/**
 * Paywall Screen
 * Shows subscription options when free quote limit is reached
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import {
  Text,
  Button,
  Surface,
  Title,
  List,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import * as RNIap from 'react-native-iap';

import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { billingService, SUBSCRIPTION_SKUS } from '../services/billingService';
import { useSubscriptionStore } from '../store/subscriptionStore';

export function PaywallScreen() {
  const navigation = useNavigation<any>();
  const { subscriptionStatus } = useStore();
  const { quoteCount, setPremium } = useSubscriptionStore();
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [products, setProducts] = useState<RNIap.Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  const quotesUsed = quoteCount;
  const quotesLimit = 5;

  useEffect(() => {
    loadProducts();
    setupPurchaseListener();

    return () => {
      RNIap.purchaseUpdatedListener?.remove();
      RNIap.purchaseErrorListener?.remove();
    };
  }, []);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const availableProducts = await billingService.getProducts();
      setProducts(availableProducts);
    } catch (error) {
      console.error('Error loading products:', error);
      Alert.alert('Error', 'Failed to load subscription options');
    } finally {
      setLoading(false);
    }
  };

  const setupPurchaseListener = () => {
    const purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(
      async (purchase: RNIap.SubscriptionPurchase) => {
        console.log('Purchase updated:', purchase);
        const receipt = purchase.transactionReceipt;
        if (receipt) {
          try {
            await setPremium(
              true,
              purchase.productId,
              new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
            );
            await billingService.finishTransaction(purchase);
            Alert.alert(
              'Success!',
              'Welcome to QuoteMate Pro! You now have unlimited quotes.',
              [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
          } catch (error) {
            console.error('Error processing purchase:', error);
          }
        }
        setIsUpgrading(false);
      }
    );

    const purchaseErrorSubscription = RNIap.purchaseErrorListener(
      (error: RNIap.PurchaseError) => {
        if (error.code !== 'E_USER_CANCELLED') {
          console.error('Purchase error:', error);
          Alert.alert('Purchase Failed', error.message);
        }
        setIsUpgrading(false);
      }
    );
  };

  const handleUpgrade = async () => {
    setIsUpgrading(true);
    try {
      await billingService.purchaseSubscription(SUBSCRIPTION_SKUS.MONTHLY);
    } catch (error: any) {
      setIsUpgrading(false);
      if (error.code !== 'E_USER_CANCELLED') {
        Alert.alert('Error', 'Failed to start purchase');
      }
    }
  };

  const getProductPrice = (productId: string): string => {
    const product = products.find(p => p.productId === productId);
    return product?.localizedPrice || '$19';
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading subscription options...</Text>
      </View>
    );
  }

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
          You've created {quotesUsed} of {quotesLimit} free quotes
        </Text>
      </View>

      <Surface style={styles.planCard}>
        <View style={styles.planHeader}>
          <Text style={styles.planName}>QuoteMate Pro</Text>
          <View style={styles.priceContainer}>
            <Text style={styles.price}>{getProductPrice(SUBSCRIPTION_SKUS.MONTHLY)}</Text>
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
          Cancel anytime. Subscriptions automatically renew unless cancelled 24 hours before the end of the period.
        </Text>
      </Surface>

      <Surface style={styles.freeCard}>
        <Text style={styles.freeTitle}>Free Plan</Text>
        <Text style={styles.freeText}>
          • {quotesLimit} quotes total{'\n'}
          • All core features included{'\n'}
          • Upgrade anytime for unlimited quotes
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
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: colors.onSurface,
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
