/**
 * Paywall Screen
 * Shows subscription options when free quote limit is reached
 */

import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Alert, ActivityIndicator, Platform, Linking, Pressable } from 'react-native';
import {
  Text,
  Button,
  Surface,
  Title,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { billingService, SUBSCRIPTION_SKUS } from '../services/billingService';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { unifiedBillingService } from '../services/unifiedBillingService';
import { auth } from '../config/firebase';
import { WebContainer } from '../components/WebContainer';
import { StripeCheckoutModal } from '../components/StripeCheckoutModal';
import { CancellationReasonModal } from '../components/CancellationReasonModal';
import { TRIAL_DAYS, TRIAL_MS } from '../utils/trialConfig';

const PRO_NUDGES = [
  "Your quotes deserve the VIP treatment",
  "Free is nice, but Pro is where the money's at",
  "Even your ute has a paid rego",
  "Time to give your business the upgrade it deserves",
  "Pro tip: go Pro",
  "Your competitors aren't using the free version",
  "Less than a smashed avo a week",
];

const MAYBE_LATER_QUIPS = [
  "Your quotes will miss you",
  "The crown will be here when you're ready",
  "No pressure... but your competitors just upgraded",
  "We'll keep the light on for you",
  "That's what they all say... then they come back",
  "Sure, but don't say we didn't warn you",
];

export function PaywallScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const proNudge = useMemo(() => PRO_NUDGES[Math.floor(Math.random() * PRO_NUDGES.length)], []);
  const maybeLaterQuip = useMemo(() => MAYBE_LATER_QUIPS[Math.floor(Math.random() * MAYBE_LATER_QUIPS.length)], []);
  const { subscriptionStatus, loadSubscription } = useStore();
  const { quoteCount, setPremium } = useSubscriptionStore();
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [iapNotAvailable, setIapNotAvailable] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [showCancellationModal, setShowCancellationModal] = useState(false);
  const [productsLoadError, setProductsLoadError] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>('yearly');

  // Trial status
  const trialExpired = subscriptionStatus?.trialExpired || false;
  const trialStartedAt = subscriptionStatus?.trialStartedAt;
  const getTrialDaysRemaining = () => {
    if (!trialStartedAt) return TRIAL_DAYS;
    const start = new Date(trialStartedAt);
    const now = new Date();
    const elapsed = now.getTime() - start.getTime();
    const remaining = Math.ceil((TRIAL_MS - elapsed) / (24 * 60 * 60 * 1000));
    return Math.max(0, remaining);
  };
  const trialDaysRemaining = getTrialDaysRemaining();

  useEffect(() => {
    // Safety timeout: if loading takes more than 30s, stop the spinner
    const safetyTimeout = setTimeout(() => {
      setLoading(false);
      if (products.length === 0 && Platform.OS !== 'web') {
        setProductsLoadError(true);
      }
    }, 30000);

    loadProducts().catch(error => {
      setLoading(false);
    }).finally(() => clearTimeout(safetyTimeout));

    let purchaseUpdateSubscription: any;
    let purchaseErrorSubscription: any;

    try {
      const listeners = setupPurchaseListener();
      purchaseUpdateSubscription = listeners.purchaseUpdateSubscription;
      purchaseErrorSubscription = listeners.purchaseErrorSubscription;
    } catch (error) {
    }

    return () => {
      try {
        purchaseUpdateSubscription?.remove();
        purchaseErrorSubscription?.remove();
      } catch (error) {
      }
    };
  }, []);

  const loadProducts = async (retryCount = 0) => {
    setLoading(true);
    setProductsLoadError(false);
    try {

      // Use unified billing service for all platforms
      await unifiedBillingService.initialize();
      const availableProducts = await unifiedBillingService.getProducts();

      if (availableProducts.length === 0 && Platform.OS !== 'web') {
        // Auto-retry up to 2 more times with increasing delay
        if (retryCount < 2) {
          setLoading(true);
          await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
          return loadProducts(retryCount + 1);
        }
        setProductsLoadError(true);
      } else if (availableProducts.length === 0 && Platform.OS === 'web') {
      }

      // Convert to RNIap.Subscription format for compatibility
      const formattedProducts = availableProducts.map((p: any) => ({
        productId: p.id,
        title: p.title,
        description: p.description,
        localizedPrice: p.price,
        price: p.priceValue,
        currency: p.currency,
        period: p.period, // 'monthly' | 'yearly' — used on web to match selectedPlan
      }));
      setProducts(formattedProducts as any);
    } catch (error: any) {

      // Handle IAP not available gracefully (expo-iap 3.x uses kebab-case error codes)
      const code = error?.code;
      const msg = error?.message || '';
      if (code === 'iap-not-available' || code === 'E_IAP_NOT_AVAILABLE' || msg.includes('iap-not-available') || msg.includes('E_IAP_NOT_AVAILABLE')) {
        setIapNotAvailable(true);
      } else if (retryCount < 2) {
        // Auto-retry on error
        await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
        return loadProducts(retryCount + 1);
      } else {
        setProductsLoadError(true);
        Alert.alert('Error', 'Failed to load subscription options. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const setupPurchaseListener = () => {
    // Only set up purchase listeners on mobile platforms
    if (Platform.OS === 'web') {
      return { purchaseUpdateSubscription: null, purchaseErrorSubscription: null };
    }

    try {
      // Dynamically require expo-iap only on mobile platforms
      const RNIap = require('expo-iap');

      const purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(
        async (purchase: any) => {
          try {
            // expo-iap 3.x: check purchaseToken (not transactionReceipt)
            const hasValidPurchase = purchase.purchaseToken || purchase.transactionReceipt || purchase.id;
            if (hasValidPurchase) {
              // Send receipt to server for validation
              const currentUser = auth.currentUser;
              if (currentUser) {
                const API_BASE_URL = process.env.API_BASE_URL || 'https://us-central1-hansendev.cloudfunctions.net';
                const endpoint = Platform.OS === 'ios' ? 'validateAppleReceipt' : 'validateGoogleReceipt';
                try {
                  const idToken = await currentUser.getIdToken();
                  const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                    body: JSON.stringify({
                      transactionId: purchase.transactionId || purchase.id,
                      productId: purchase.productId,
                      purchaseToken: purchase.purchaseToken || null,
                    }),
                  });
                  const data = await response.json();
                  if (data.success) {
                    // Reload subscription from Firestore
                    await loadSubscription();
                  } else {
                  }
                } catch (serverError) {
                }
              }

              // Always set local premium as fallback
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
            Alert.alert('Error', 'Failed to process purchase. Please contact support.');
          } finally {
            setIsUpgrading(false);
          }
        }
      );

      const purchaseErrorSubscription = RNIap.purchaseErrorListener(
        (error: any) => {
          try {
            const errorCode = error.code;
          if (errorCode !== 'user-cancelled' && errorCode !== 'E_USER_CANCELLED' && errorCode !== 'iap-not-available' && errorCode !== 'E_IAP_NOT_AVAILABLE') {
              Alert.alert('Purchase Failed', error.message || 'An error occurred during purchase');
            }
          } catch (alertError) {
          } finally {
            setIsUpgrading(false);
          }
        }
      );

      return { purchaseUpdateSubscription, purchaseErrorSubscription };
    } catch (error: any) {
      // Don't show alert for iap-not-available during setup
      if (error?.code !== 'iap-not-available' && error?.code !== 'E_IAP_NOT_AVAILABLE') {
        setIsUpgrading(false);
      }
      return { purchaseUpdateSubscription: null, purchaseErrorSubscription: null };
    }
  };

  const handleUpgrade = async () => {

    setIsUpgrading(true);
    try {
      if (Platform.OS === 'ios') {
        // iOS MUST use Apple IAP only (App Store guidelines 3.1.1)
        await billingService.purchaseSubscription(selectedSku);
      } else if (Platform.OS === 'android') {
        // Android uses Google Play IAP
        await billingService.purchaseSubscription(selectedSku);
      } else if (Platform.OS === 'web') {
        // Web uses Stripe (multi-platform service - Guideline 3.1.3b)
        const currentUser = auth.currentUser;

        if (!currentUser) {
          Alert.alert('Error', 'Please sign in to purchase a subscription');
          setIsUpgrading(false);
          return;
        }

        const webProduct =
          products.find((p: any) => p.period === selectedPlan) ??
          (products.length > 0 ? products[0] : {
            productId: 'price_default',
            title: 'Pro Monthly',
            localizedPrice: '$49',
          });
        setSelectedProduct(webProduct);
        setShowCheckoutModal(true);
        setIsUpgrading(false);
      }
    } catch (error: any) {
      setIsUpgrading(false);
      if (error?.code !== 'user-cancelled' && error?.code !== 'E_USER_CANCELLED') {
        Alert.alert('Error', error?.message || 'Failed to start purchase. Please try again.');
      }
    }
  };

  const getProductPrice = (productId: string): string => {
    const product = products.find(p => p.productId === productId);
    if (product) return (product as any)?.localizedPrice || (productId === SUBSCRIPTION_SKUS.YEARLY ? '$328' : '$49');
    return productId === SUBSCRIPTION_SKUS.YEARLY ? '$328' : '$49';
  };

  const selectedSku = selectedPlan === 'yearly' ? SUBSCRIPTION_SKUS.YEARLY : SUBSCRIPTION_SKUS.MONTHLY;

  const handleRestorePurchases = async () => {
    if (Platform.OS === 'web') return;

    setIsRestoring(true);
    try {
      await billingService.initialize();
      const activeSubscriptions = await billingService.getActiveSubscriptions();

      if (activeSubscriptions.length > 0) {
        const purchase = activeSubscriptions[0];
        // Validate with server
        const currentUser = auth.currentUser;
        if (currentUser) {
          const API_BASE_URL = process.env.API_BASE_URL || 'https://us-central1-hansendev.cloudfunctions.net';
          const endpoint = Platform.OS === 'ios' ? 'validateAppleReceipt' : 'validateGoogleReceipt';
          try {
            const idToken = await currentUser.getIdToken();
            const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
              body: JSON.stringify({
                transactionId: purchase.transactionId || purchase.id,
                productId: purchase.productId,
                purchaseToken: purchase.purchaseToken || null,
              }),
            });
            const data = await response.json();
            if (data.success) {
              await loadSubscription();
            }
          } catch (serverError) {
          }
        }

        await setPremium(
          true,
          purchase.productId,
          new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
        );
        Alert.alert('Restored', 'Your Pro subscription has been restored successfully!', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        Alert.alert('No Purchases Found', 'No previous subscriptions were found for this account.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to restore purchases. Please try again.');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleCancelSubscription = () => {
    if (Platform.OS === 'web') {
      // Show cancellation reason modal
      setShowCancellationModal(true);
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
  };

  const confirmCancelSubscription = async (reason: string, feedback: string) => {
    setIsCancelling(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }

      // Call backend to cancel subscription
      const API_BASE_URL = process.env.API_BASE_URL || 'https://us-central1-hansendev.cloudfunctions.net';
      const idToken = await currentUser.getIdToken();
      const response = await fetch(`${API_BASE_URL}/cancelSubscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          reason,
          feedback,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel subscription');
      }

      // Close modal
      setShowCancellationModal(false);

      // Update local subscription status
      const updatedSubscription = {
        ...subscriptionStatus,
        isPro: true, // Still Pro until period end
        cancelAtPeriodEnd: true,
      };

      // Save to Firestore
      const { firestoreService } = require('../services/firestoreService');
      await firestoreService.saveSubscriptionStatus(updatedSubscription);

      // Reload subscription
      await loadSubscription();

      // Show success message with period end date
      const periodEndDate = new Date(data.periodEnd).toLocaleDateString();
      Alert.alert(
        '✅ Subscription Canceled',
        `Your subscription has been canceled. You'll continue to have Pro access until ${periodEndDate}.\n\nThank you for your feedback!`,
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.message || 'Failed to cancel subscription. Please try again or contact support.',
        [{ text: 'OK' }]
      );
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

  // Show message if IAP is not available on this device
  if (iapNotAvailable && Platform.OS !== 'web') {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
      >
        <WebContainer>
          <View style={styles.header}>
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={80}
            color={colors.warning}
          />
          <Title style={styles.title}>Subscriptions Unavailable</Title>
          <Text style={styles.subtitle}>
            In-app purchases are not available on this device. Please ensure you are signed in to the {Platform.OS === 'ios' ? 'App Store' : 'Play Store'} and try again.
          </Text>
        </View>

        <Button
          mode="contained"
          onPress={() => {
            setIapNotAvailable(false);
            loadProducts();
          }}
          style={styles.upgradeButton}
          contentStyle={styles.upgradeButtonContent}
        >
          Retry
        </Button>

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

  const handleCheckoutSuccess = async () => {
    setShowCheckoutModal(false);

    try {
      // Wait a moment for Stripe to process the subscription
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Query Stripe directly for subscription status
      const currentUser = auth.currentUser;
      if (!currentUser) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }

      const { stripeService } = require('../services/stripeService');
      const status = await stripeService.checkSubscriptionStatus(currentUser.uid);

      if (status.isPremium) {
        // Update subscription status in Firestore and local storage
        const subscriptionStatus = {
          isPro: true,
          quotesThisMonth: 0,
          currentPeriodStart: new Date(),
          currentPeriodEnd: status.expiryDate ? new Date(status.expiryDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          freeQuotesLimit: 5,
          trialExpired: false,
        };

        // Save to Firestore
        const { firestoreService } = require('../services/firestoreService');
        await firestoreService.saveSubscriptionStatus(subscriptionStatus);

        // Reload subscription in UI
        await loadSubscription();

        // Show success message
        Alert.alert(
          '🎉 Welcome to Pro!',
          'Your subscription is now active. You now have unlimited quote analyses!',
          [
            {
              text: 'Get Started',
              onPress: () => navigation.goBack(),
            }
          ]
        );
      } else {
        // Subscription not active yet, ask user to wait
        Alert.alert(
          'Processing...',
          'Your subscription is still being processed. Please check back in a moment.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      Alert.alert(
        'Error',
        'Failed to verify subscription. Please refresh the page or contact support.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleCheckoutDismiss = () => {
    setShowCheckoutModal(false);
    setSelectedProduct(null);
  };

  return (
    <>
      {/* Stripe Checkout Modal - Web only (iOS/Android MUST use native IAP per App Store Guidelines 3.1.1) */}
      {Platform.OS === 'web' && showCheckoutModal && selectedProduct && auth.currentUser && (
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

      {/* Cancellation Reason Modal */}
      <CancellationReasonModal
        visible={showCancellationModal}
        onDismiss={() => setShowCancellationModal(false)}
        onConfirm={confirmCancelSubscription}
        isLoading={isCancelling}
        periodEndDate={subscriptionStatus?.currentPeriodEnd}
      />

    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
    >
      <WebContainer>
        <View style={styles.header}>
        <View style={styles.crownContainer}>
          <View style={styles.crownGlow} />
          <MaterialCommunityIcons
            name="crown"
            size={48}
            color={colors.secondary}
          />
        </View>
        <Title style={styles.title}>{isPro ? 'Manage Subscription' : 'Upgrade to Pro'}</Title>
        <Text style={styles.subtitle}>
          {isPro
            ? 'You have unlimited quote analyses'
            : trialExpired
              ? 'Your free trial has ended'
              : `${trialDaysRemaining} day${trialDaysRemaining !== 1 ? 's' : ''} left in your free trial`
          }
        </Text>
        {!isPro && (
          <Text style={styles.proNudge}>{proNudge}</Text>
        )}
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

            {subscriptionStatus?.currentPeriodEnd && (
              <View style={styles.billingInfo}>
                <MaterialCommunityIcons name="calendar-clock" size={20} color={colors.primary} />
                <Text style={styles.billingText}>
                  Next billing date: {subscriptionStatus.currentPeriodEnd.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </Text>
              </View>
            )}

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
              {subscriptionStatus?.currentPeriodEnd
                ? `Your subscription will remain active until ${subscriptionStatus.currentPeriodEnd.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}`
                : 'Your subscription will remain active until the end of your billing period'}
            </Text>
          </View>
        </Surface>
      )}

      {/* Plan Toggle */}
      {!isPro && (
        <View style={styles.planToggleContainer}>
          <Pressable
            style={[styles.planOption, selectedPlan === 'monthly' && styles.planOptionSelected]}
            onPress={() => setSelectedPlan('monthly')}
          >
            <Text style={[styles.planOptionLabel, selectedPlan === 'monthly' && styles.planOptionLabelSelected]}>Monthly</Text>
            <Text style={[styles.planOptionPrice, selectedPlan === 'monthly' && styles.planOptionPriceSelected]}>{getProductPrice(SUBSCRIPTION_SKUS.MONTHLY)}</Text>
            <Text style={[styles.planOptionPeriod, selectedPlan === 'monthly' && styles.planOptionPeriodSelected]}>/month</Text>
          </Pressable>

          <Pressable
            style={[styles.planOption, selectedPlan === 'yearly' && styles.planOptionSelected]}
            onPress={() => setSelectedPlan('yearly')}
          >
            <View style={styles.saveBadge}>
              <Text style={styles.saveBadgeText}>Save 44%</Text>
            </View>
            <Text style={[styles.planOptionLabel, selectedPlan === 'yearly' && styles.planOptionLabelSelected]}>Yearly</Text>
            <Text style={[styles.planOptionPrice, selectedPlan === 'yearly' && styles.planOptionPriceSelected]}>{getProductPrice(SUBSCRIPTION_SKUS.YEARLY)}</Text>
            <Text style={[styles.planOptionPeriod, selectedPlan === 'yearly' && styles.planOptionPeriodSelected]}>/year</Text>
          </Pressable>
        </View>
      )}

      {/* Upgrade Section for Free Users */}
      {!isPro && (
      <View style={styles.planCard}>
        <Text style={styles.includesLabel}>Everything you need:</Text>

        <View style={styles.features}>
          <View style={styles.feature}>
            <MaterialCommunityIcons name="check-circle" size={22} color={colors.success} />
            <Text style={styles.featureText}>Unlimited quotes and invoices</Text>
          </View>

          <View style={styles.feature}>
            <MaterialCommunityIcons name="check-circle" size={22} color={colors.success} />
            <Text style={styles.featureText}>Any payment method — bank, PayID, PayPal, Square</Text>
          </View>

          <View style={styles.feature}>
            <MaterialCommunityIcons name="check-circle" size={22} color={colors.success} />
            <Text style={styles.featureText}>Your business logo on quotes and invoices</Text>
          </View>

          <View style={styles.feature}>
            <MaterialCommunityIcons name="check-circle" size={22} color={colors.success} />
            <Text style={styles.featureText}>Priority customer support</Text>
          </View>

          <View style={styles.feature}>
            <MaterialCommunityIcons name="check-circle" size={22} color={colors.success} />
            <Text style={styles.featureText}>All future features included</Text>
          </View>
        </View>

        {/* Show non-blocking warning if products failed to load on iOS/Android */}
        {productsLoadError && Platform.OS !== 'web' && (
          <View style={styles.errorStateContainer}>
            <MaterialCommunityIcons name="information-outline" size={20} color={colors.warning} />
            <Text style={styles.errorStateText}>
              Could not verify pricing from the {Platform.OS === 'ios' ? 'App Store' : 'Play Store'}. You can still subscribe below.
            </Text>
          </View>
        )}

        <Button
          mode="contained"
          onPress={handleUpgrade}
          style={styles.upgradeButton}
          contentStyle={styles.upgradeButtonContent}
          labelStyle={styles.upgradeButtonLabel}
          loading={isUpgrading}
          disabled={isUpgrading}
        >
          Start Pro Subscription
        </Button>

        {Platform.OS !== 'web' && (
          <Button
            mode="text"
            onPress={handleRestorePurchases}
            loading={isRestoring}
            disabled={isRestoring}
            style={styles.restoreButton}
          >
            Restore Purchases
          </Button>
        )}
      </View>
      )}

      {!isPro && (
        <View style={styles.bottomSection}>
          <Text style={styles.maybeLaterQuip}>{maybeLaterQuip}</Text>
          <Button
            mode="text"
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            textColor={colors.textMuted}
          >
            Maybe Later
          </Button>

          <Text style={styles.disclaimer}>
            Auto-renewable {selectedPlan} subscription at {getProductPrice(selectedSku)}/{selectedPlan === 'yearly' ? 'year' : 'month'}.{'\n'}Cancel anytime. Renews unless cancelled 24 hours before period end.
          </Text>

          <View style={styles.legalLinks}>
            <Text
              style={styles.legalLink}
              onPress={() => Linking.openURL('https://hansendev.com.au/projects/quotemate-privacy')}
            >
              Privacy Policy
            </Text>
            <Text style={styles.legalSeparator}>|</Text>
            <Text
              style={styles.legalLink}
              onPress={() => Linking.openURL('https://hansendev.com.au/projects/quotemate-terms')}
            >
              Terms of Use
            </Text>
          </View>
        </View>
      )}

      {isPro && (
        <Button
          mode="text"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          Back to Settings
        </Button>
      )}
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
    padding: 24,
    paddingTop: 32,
    paddingBottom: 20,
  },
  crownContainer: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crownGlow: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(207, 161, 83, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(207, 161, 83, 0.25)',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 6,
    color: colors.text,
  },
  subtitle: {
    fontSize: 15,
    color: colors.onSurface,
    textAlign: 'center',
  },
  proNudge: {
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    opacity: 0.85,
  },
  planToggleContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    gap: 12,
    marginTop: 4,
    marginBottom: 16,
  },
  planOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 18,
    paddingTop: 20,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
  },
  planOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryBg,
  },
  planOptionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  planOptionLabelSelected: {
    color: colors.primary,
  },
  planOptionPrice: {
    fontSize: 30,
    fontWeight: 'bold',
    color: colors.textMuted,
  },
  planOptionPriceSelected: {
    color: colors.text,
  },
  planOptionPeriod: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  planOptionPeriodSelected: {
    color: colors.onSurface,
  },
  saveBadge: {
    position: 'absolute',
    top: -11,
    backgroundColor: colors.secondary,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  saveBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  planCard: {
    marginHorizontal: 20,
    marginBottom: 0,
    padding: 20,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  includesLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
    marginBottom: 16,
  },
  features: {
    marginBottom: 20,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureText: {
    fontSize: 15,
    marginLeft: 12,
    flex: 1,
    color: colors.text,
  },
  upgradeButton: {
    marginBottom: 8,
    borderRadius: 12,
  },
  upgradeButtonContent: {
    paddingVertical: 10,
  },
  upgradeButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  bottomSection: {
    paddingHorizontal: 24,
    alignItems: 'center',
    marginTop: 4,
  },
  disclaimer: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
  maybeLaterQuip: {
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 4,
    opacity: 0.7,
  },
  backButton: {
    marginBottom: 16,
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
  billingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryBg,
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
    gap: 8,
  },
  billingText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
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
  errorStateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceLight,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    gap: 10,
  },
  errorStateText: {
    fontSize: 13,
    color: colors.onSurface,
    flex: 1,
    lineHeight: 18,
  },
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  legalLink: {
    fontSize: 13,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
  legalSeparator: {
    fontSize: 13,
    color: colors.textMuted,
    marginHorizontal: 8,
  },
  restoreButton: {
    marginTop: 4,
  },
});
