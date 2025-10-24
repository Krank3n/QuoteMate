/**
 * QuoteMate - Main App Entry Point
 * A quoting tool for Australian tradies with Bunnings API integration
 */

import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { Provider as PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged } from 'firebase/auth';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

import { useStore } from './src/store/useStore';
import { theme } from './src/theme';
import { RootNavigator } from './src/navigation/RootNavigator';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { subscriptionSyncService } from './src/services/subscriptionSyncService';
import { auth } from './src/config/firebase';
import { stripeService } from './src/services/stripeService';
import { stripeConfig } from './src/config/stripeConfig';

// Initialize Stripe for web
const stripePromise = Platform.OS === 'web' ? loadStripe(stripeConfig.publishableKey) : null;

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const { isOnboarded, checkOnboarding, loadQuotes, loadBusinessSettings, loadSubscription } = useStore();

  // On web, require authentication
  const requiresAuth = Platform.OS === 'web';

  useEffect(() => {
    // Listen to authentication state changes
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      console.log('🔐 Auth state changed:', currentUser ? 'Signed in' : 'Not signed in');
      setUser(currentUser);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    async function initialize() {
      try {
        // Load saved data
        await Promise.all([
          checkOnboarding(),
          loadQuotes(),
          loadBusinessSettings(),
          loadSubscription(),
        ]);

        // Initialize subscription sync (syncs across all platforms)
        await subscriptionSyncService.initialize();
      } catch (error) {
        console.error('Error initializing app:', error);
      } finally {
        setIsLoading(false);
      }
    }

    initialize();

    // Cleanup subscription listeners on unmount
    return () => {
      subscriptionSyncService.cleanup();
    };
  }, []);

  // Check for Stripe checkout success on web
  useEffect(() => {
    if (Platform.OS === 'web' && user) {
      const checkStripeReturn = async () => {
        try {
          // Check if URL has session_id parameter (return from Stripe)
          const urlParams = new URLSearchParams(window.location.search);
          const sessionId = urlParams.get('session_id');

          if (sessionId) {
            console.log('🎉 Returned from Stripe checkout, checking subscription status...');

            // Wait a bit for Stripe to process the subscription
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Query subscription status from Stripe via our function
            const status = await stripeService.checkSubscriptionStatus(user.uid);

            console.log('Subscription status from Stripe:', status);

            if (status.isPremium) {
              console.log('✅ Subscription active! Updating local storage...');

              // Update local subscription status
              const subscriptionStatus = {
                isPro: true,
                quotesThisMonth: 0,
                freeQuotesLimit: 5,
                currentPeriodStart: new Date(),
                currentPeriodEnd: status.expiryDate ? new Date(status.expiryDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              };

              // Save to AsyncStorage
              const AsyncStorage = require('@react-native-async-storage/async-storage').default;
              await AsyncStorage.setItem('@quotemate:subscription', JSON.stringify(subscriptionStatus));

              // Reload subscription in UI
              await loadSubscription();

              alert('🎉 Subscription activated! You now have unlimited quote analyses.');
            }

            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } catch (error) {
          console.error('Error checking Stripe return:', error);
        }
      };

      checkStripeReturn();
    }
  }, [user]);

  if (isLoading) {
    // Show a simple loading view while initializing
    return (
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <StatusBar style="light" />
        </PaperProvider>
      </SafeAreaProvider>
    );
  }

  // On web, require authentication before showing the app
  if (requiresAuth && !user) {
    return (
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <NavigationContainer>
            <StatusBar style="light" />
            <AuthScreen />
          </NavigationContainer>
        </PaperProvider>
      </SafeAreaProvider>
    );
  }

  const appContent = (
    <>
      <StatusBar style="light" />
      {isOnboarded ? <RootNavigator /> : <OnboardingScreen />}
    </>
  );

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <NavigationContainer>
          {Platform.OS === 'web' && stripePromise ? (
            <Elements stripe={stripePromise}>
              {appContent}
            </Elements>
          ) : (
            appContent
          )}
        </NavigationContainer>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
