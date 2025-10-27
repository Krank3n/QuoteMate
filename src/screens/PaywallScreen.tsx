/**
 * Paywall Screen
 * Shows subscription options when free quote limit is reached
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, ActivityIndicator, Platform } from 'react-native';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { billingService, SUBSCRIPTION_SKUS } from '../services/billingService';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { unifiedBillingService } from '../services/unifiedBillingService';
import { auth } from '../config/firebase';
import { WebContainer } from '../components/WebContainer';
import { StripeCheckoutModal } from '../components/StripeCheckoutModal';

export function PaywallScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { subscriptionStatus } = useStore();
  const { quoteCount, setPremium } = useSubscriptionStore();
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [products, setProducts] = useState<RNIap.Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [iapNotAvailable, setIapNotAvailable] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  // Use subscriptionStatus from useStore which has the accurate count
  const quotesUsed = subscriptionStatus?.quotesThisMonth || quoteCount;
  const quotesLimit = subscriptionStatus?.freeQuotesLimit || 5;

  useEffect(() => {
    loadProducts().catch(error => {
      console.error('Failed to load products:', error);
      // Don't crash, just set loading to false
      setLoading(false);
    });

    let purchaseUpdateSubscription: any;
    let purchaseErrorSubscription: any;

    try {
      const listeners = setupPurchaseListener();
      purchaseUpdateSubscription = listeners.purchaseUpdateSubscription;
      purchaseErrorSubscription = listeners.purchaseErrorSubscription;
    } catch (error) {
      console.error('Failed to setup purchase listener:', error);
    }

    return () => {
      try {
        purchaseUpdateSubscription?.remove();
        purchaseErrorSubscription?.remove();
      } catch (error) {
        console.error('Error removing listeners:', error);
      }
    };
  }, []);

  const loadProducts = async () => {
    setLoading(true);
    try {
      console.log('🔍 Loading products...');
      console.log('🔍 Platform:', Platform.OS);

      // Use unified billing service for all platforms
      await unifiedBillingService.initialize();
      const availableProducts = await unifiedBillingService.getProducts();
      console.log('📦 Found products:', availableProducts);
      console.log('📦 Product count:', availableProducts.length);

      if (availableProducts.length === 0) {
        // Only show alert if we're on Android where we expect subscriptions
        if (Platform.OS === 'android') {
          Alert.alert(
            'No Products Found',
            'Subscription products are not set up yet. Please:\n\n' +
            '1. Create subscriptions in Google Play Console\n' +
            '2. Use product IDs:\n   • quotemate_premium_monthly\n   • quotemate_premium_yearly\n' +
            '3. Make sure they are ACTIVE\n' +
            '4. Install app from Play Store test link'
          );
        } else if (Platform.OS === 'web') {
          console.log('ℹ️ Web products loaded from configuration');
        }
      }
      // Convert to RNIap.Subscription format for compatibility
      const formattedProducts = availableProducts.map((p: any) => ({
        productId: p.id,
        title: p.title,
        description: p.description,
        localizedPrice: p.price,
        price: p.priceValue,
        currency: p.currency,
      }));
      setProducts(formattedProducts as any);
    } catch (error: any) {
      console.error('Error loading products:', error);

      // Handle IAP not available gracefully
      if (error?.code === 'E_IAP_NOT_AVAILABLE' || error?.message?.includes('E_IAP_NOT_AVAILABLE')) {
        console.log('ℹ️ In-app purchases not available on this platform');
        setIapNotAvailable(true);
      } else {
        Alert.alert('Error', 'Failed to load subscription options');
      }
    } finally {
      setLoading(false);
    }
  };

  const setupPurchaseListener = () => {
    try {
      const purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(
        async (purchase: RNIap.SubscriptionPurchase) => {
          try {
            console.log('Purchase updated:', purchase);
            const receipt = purchase.transactionReceipt;
            if (receipt) {
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
            }
          } catch (error) {
            console.error('Error processing purchase:', error);
            Alert.alert('Error', 'Failed to process purchase. Please contact support.');
          } finally {
            setIsUpgrading(false);
          }
        }
      );

      const purchaseErrorSubscription = RNIap.purchaseErrorListener(
        (error: RNIap.PurchaseError) => {
          try {
            console.error('Purchase error:', error);
            if (error.code !== 'E_USER_CANCELLED' && error.code !== 'E_IAP_NOT_AVAILABLE') {
              Alert.alert('Purchase Failed', error.message || 'An error occurred during purchase');
            }
          } catch (alertError) {
            console.error('Error showing alert:', alertError);
          } finally {
            setIsUpgrading(false);
          }
        }
      );

      return { purchaseUpdateSubscription, purchaseErrorSubscription };
    } catch (error: any) {
      console.error('Error setting up purchase listeners:', error);
      // Don't show alert for E_IAP_NOT_AVAILABLE during setup
      if (error?.code !== 'E_IAP_NOT_AVAILABLE') {
        setIsUpgrading(false);
      }
      return { purchaseUpdateSubscription: null, purchaseErrorSubscription: null };
    }
  };

  const handleUpgrade = async () => {
    console.log('💳 handleUpgrade clicked');

    if (products.length === 0) {
      console.log('❌ No products available');
      Alert.alert(
        'Not Available',
        'Subscription products are not available yet. Please make sure:\n\n' +
        '1. You installed the app from Play Store test link\n' +
        '2. Subscriptions are created and ACTIVE in Play Console\n' +
        '3. Wait a few minutes after creating subscriptions'
      );
      return;
    }

    setIsUpgrading(true);
    try {
      const firstProduct = products[0];
      console.log('📦 First product:', firstProduct);

      if (Platform.OS === 'web') {
        // For web, get Firebase user ID (should always exist due to auth guard)
        const currentUser = auth.currentUser;
        console.log('👤 Current user:', currentUser?.uid);

        if (!currentUser) {
          // This should not happen due to auth guard, but handle it gracefully
          Alert.alert('Error', 'Please sign in to purchase a subscription');
          setIsUpgrading(false);
          return;
        }

        console.log('✅ Proceeding with purchase for user:', currentUser.uid);
        // Show embedded checkout modal
        setSelectedProduct(firstProduct);
        setShowCheckoutModal(true);
        setIsUpgrading(false);
      } else {
        // For mobile, use native IAP
        await billingService.purchaseSubscription(SUBSCRIPTION_SKUS.MONTHLY);
      }
    } catch (error: any) {
      console.error('❌ Error in handleUpgrade:', error);
      setIsUpgrading(false);
      if (error?.code !== 'E_USER_CANCELLED') {
        Alert.alert('Error', error?.message || 'Failed to start purchase. Please try again.');
      }
    }
  };

  const getProductPrice = (productId: string): string => {
    const product = products.find(p => p.productId === productId);
    return (product as any)?.localizedPrice || '$19';
  };

  const handleCancelSubscription = () => {
    // Show "Are you sure?" confirmation
    Alert.alert(
      'Cancel Subscription?',
      'Are you sure you want to cancel your Pro subscription? You can provide feedback during the cancellation process in the Stripe portal.',
      [
        {
          text: 'Keep Subscription',
          style: 'cancel',
        },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: confirmCancelSubscription,
        },
      ]
    );
  };

  const confirmCancelSubscription = async () => {
    setIsCancelling(true);
    try {
      const currentUser = auth.currentUser;

      if (Platform.OS === 'web') {
        // For web, open Stripe Customer Portal to manage subscription
        if (currentUser) {
          const { stripeService } = require('../services/stripeService');
          try {
            const portalUrl = await stripeService.createPortalSession(currentUser.uid);

            // Open Stripe portal
            window.open(portalUrl, '_blank');

            Alert.alert(
              'Manage Subscription',
              'We\'ve opened the Stripe Customer Portal where you can confirm your cancellation and provide feedback.',
              [{ text: 'OK' }]
            );
          } catch (portalError) {
            console.error('Error opening portal:', portalError);
            Alert.alert(
              'Error',
              'Failed to open the Stripe Customer Portal. Please try again or contact support.',
              [{ text: 'OK' }]
            );
          }
        }
      } else {
        // For native platforms, show instructions
        Alert.alert(
          'Cancel Subscription',
          Platform.OS === 'ios'
            ? 'To cancel your subscription, go to Settings > Your Name > Subscriptions on your iPhone.'
            : 'To cancel your subscription, open the Play Store app, tap Menu > Subscriptions, and select QuoteMate.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Error handling cancellation:', error);
      Alert.alert('Error', 'Failed to process cancellation. Please contact support.');
    } finally {
      setIsCancelling(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <WebContainer>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading subscription options...</Text>
        </WebContainer>
      </View>
    );
  }

  // Show iOS-specific message if IAP is not available
  if (iapNotAvailable && Platform.OS === 'ios') {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
      >
        <WebContainer>
          <View style={styles.header}>
          <MaterialCommunityIcons
            name="information"
            size={80}
            color={colors.secondary}
          />
          <Title style={styles.title}>iOS Subscriptions Not Available</Title>
          <Text style={styles.subtitle}>
            In-app purchases are currently only configured for Android.
          </Text>
        </View>

        <Surface style={styles.planCard}>
          <Text style={styles.featureText}>
            To enable subscriptions on iOS, you'll need to:
            {'\n\n'}
            1. Set up in-app purchases in App Store Connect
            {'\n'}
            2. Create subscription products with the same IDs
            {'\n'}
            3. Configure iOS billing in the app
            {'\n\n'}
            For now, you can continue using the free tier.
          </Text>
        </Surface>

        <Button
          mode="text"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          Go Back
        </Button>
        </WebContainer>
      </ScrollView>
    );
  }

  // Check if user is Pro
  const isPro = subscriptionStatus?.isPro || false;

  const handleCheckoutSuccess = () => {
    setShowCheckoutModal(false);
    setPremium(true);
    Alert.alert('Success!', 'Your subscription is now active. Thank you for upgrading!');
    // Reload subscription status
    unifiedBillingService.checkSubscriptionStatus(auth.currentUser?.uid || '').then((status) => {
      if (status.isPremium) {
        setPremium(true);
      }
    });
  };

  const handleCheckoutDismiss = () => {
    setShowCheckoutModal(false);
    setSelectedProduct(null);
  };

  return (
    <>
      {/* Stripe Checkout Modal */}
      {showCheckoutModal && selectedProduct && auth.currentUser && (
        <StripeCheckoutModal
          visible={showCheckoutModal}
          onDismiss={handleCheckoutDismiss}
          onSuccess={handleCheckoutSuccess}
          priceId={selectedProduct.productId}
          userId={auth.currentUser.uid}
          planName={selectedProduct.title || 'Pro Monthly'}
          amount={getProductPrice(selectedProduct.productId)}
        />
      )}


    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
    >
      <WebContainer>
        <View style={styles.header}>
        <MaterialCommunityIcons
          name="crown"
          size={80}
          color={colors.secondary}
        />
        <Title style={styles.title}>{isPro ? 'Manage Subscription' : 'Upgrade to Pro'}</Title>
        <Text style={styles.subtitle}>
          {isPro
            ? 'You have unlimited quote analyses'
            : `You've created ${quotesUsed} of ${quotesLimit} free quotes`
          }
        </Text>
      </View>

      {/* Pro Member Management Section */}
      {isPro && (
        <Surface style={styles.planCard}>
          <View style={styles.proStatusSection}>
            <View style={styles.proBadge}>
              <MaterialCommunityIcons name="crown" size={32} color={colors.secondary} />
              <Text style={styles.proStatusTitle}>Pro Member</Text>
            </View>
            <Text style={styles.proStatusText}>
              Thank you for your support! You have unlimited access to all Pro features.
            </Text>

            <View style={styles.proFeatures}>
              <View style={styles.proFeature}>
                <MaterialCommunityIcons name="infinity" size={20} color={colors.primary} />
                <Text style={styles.proFeatureText}>Unlimited quote analyses</Text>
              </View>
              <View style={styles.proFeature}>
                <MaterialCommunityIcons name="headset" size={20} color={colors.primary} />
                <Text style={styles.proFeatureText}>Priority support</Text>
              </View>
              <View style={styles.proFeature}>
                <MaterialCommunityIcons name="palette" size={20} color={colors.primary} />
                <Text style={styles.proFeatureText}>Custom branding</Text>
              </View>
            </View>

            <Button
              mode="outlined"
              onPress={handleCancelSubscription}
              style={styles.cancelButton}
              textColor={colors.error}
            >
              Cancel Subscription
            </Button>

            <Text style={styles.cancelHint}>
              Your subscription will remain active until the end of your billing period
            </Text>
          </View>
        </Surface>
      )}

      {/* Upgrade Section for Free Users */}
      {!isPro && (
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
          disabled={isUpgrading || products.length === 0}
        >
          Start Pro Subscription
        </Button>

        <Text style={styles.disclaimer}>
          Cancel anytime. Subscriptions automatically renew unless cancelled 24 hours before the end of the period.
        </Text>
      </Surface>
      )}

      {!isPro && (
      <Surface style={styles.freeCard}>
        <Text style={styles.freeTitle}>Free Plan</Text>
        <Text style={styles.freeText}>
          • {quotesLimit} quotes total{'\n'}
          • All core features included{'\n'}
          • Upgrade anytime for unlimited quotes
        </Text>
      </Surface>
      )}

      <Button
        mode="text"
        onPress={() => navigation.goBack()}
        style={styles.backButton}
      >
        {isPro ? 'Back to Settings' : 'Maybe Later'}
      </Button>
      </WebContainer>

    </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    // paddingBottom is now dynamic using insets.bottom in the component
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
    marginTop: 8,
    // marginBottom handled by scrollContent paddingBottom with insets
  },
  proStatusSection: {
    alignItems: 'center',
  },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningBg,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  proStatusTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.secondary,
    marginLeft: 12,
  },
  proStatusText: {
    fontSize: 16,
    color: colors.onSurface,
    textAlign: 'center',
    marginBottom: 24,
  },
  proFeatures: {
    alignSelf: 'stretch',
    marginBottom: 32,
  },
  proFeature: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  proFeatureText: {
    fontSize: 14,
    marginLeft: 12,
    color: colors.onSurface,
  },
  cancelButton: {
    marginBottom: 12,
    borderColor: colors.error,
  },
  cancelHint: {
    fontSize: 12,
    color: colors.onSurface,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
