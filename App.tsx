/**
 * QuoteMate - Main App Entry Point
 * A quoting tool for Australian tradies with Bunnings API integration
 */

import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { Platform, View, Image, StyleSheet } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { Provider as PaperProvider, ActivityIndicator } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged } from 'firebase/auth';

import { useStore } from './src/store/useStore';
import { theme, colors } from './src/theme';

// Custom navigation theme to match our dark theme
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.primary,
  },
};
import { RootNavigator } from './src/navigation/RootNavigator';
import { NewOnboardingScreen } from './src/screens/NewOnboardingScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { subscriptionSyncService } from './src/services/subscriptionSyncService';
import { auth } from './src/config/firebase';
import { stripeService } from './src/services/stripeService';
import { firestoreService } from './src/services/firestoreService';
import { notificationService } from './src/services/notificationService';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [userDataLoaded, setUserDataLoaded] = useState(false);
  const { isOnboarded, checkOnboarding, loadQuotes, loadBusinessSettings, loadSubscription, loadNextQuoteNumber, checkTourStatus, loadXeroConnection } = useStore();

  // ===== TESTING FLAGS =====
  // Set SKIP_AUTH_FOR_TESTING to true to bypass login and test onboarding
  const SKIP_AUTH_FOR_TESTING = false;
  // Set FORCE_ONBOARDING to true to always show onboarding (even if completed)
  const FORCE_ONBOARDING = false;
  // =========================

  // Require authentication on all platforms for account syncing
  const requiresAuth = !SKIP_AUTH_FOR_TESTING;

  useEffect(() => {
    // Listen to authentication state changes
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log('🔐 Auth state changed:', currentUser ? 'Signed in' : 'Not signed in');
      setUser(currentUser);

      // When user signs in, reload data from Firestore and set up listeners
      if (currentUser) {
        console.log('👤 User signed in, syncing data from cloud...');
        setUserDataLoaded(false); // Reset when new user signs in

        await Promise.all([
          loadQuotes(),
          loadBusinessSettings(),
          checkOnboarding(),
          loadSubscription(),
          loadNextQuoteNumber(),
          checkTourStatus(),
          loadXeroConnection(),
        ]);

        setUserDataLoaded(true); // Mark user data as loaded

        // Register for push notifications
        if (Platform.OS !== 'web') {
          notificationService.registerForPushNotifications().then((token) => {
            if (token) {
              console.log('📱 Push notifications registered');
            }
          });

          // Set up notification listeners
          notificationService.setupNotificationListeners(
            (notification) => {
              // Handle notification received while app is open
              console.log('📬 Notification received:', notification.request.content.title);
            },
            (response) => {
              // Handle user tapping on notification
              const data = response.notification.request.content.data;
              if (data?.quoteId && data?.type === 'quote_response') {
                console.log('📋 Quote response notification tapped, quoteId:', data.quoteId);
                // Could navigate to the quote here if needed
              }
            }
          );
        }

        // Set up real-time listeners for cross-device sync
        firestoreService.listenToQuotes((quotes) => {
          console.log('📡 Real-time quotes update received');
          useStore.setState({ quotes });
        });

        firestoreService.listenToBusinessSettings((settings) => {
          console.log('📡 Real-time settings update received');
          if (settings) {
            useStore.setState({ businessSettings: settings });
          }
        });

        firestoreService.listenToOnboardingStatus((isOnboarded) => {
          console.log('📡 Real-time onboarding update received');
          useStore.setState({ isOnboarded });
        });

        firestoreService.listenToSubscriptionStatus((subscriptionStatus) => {
          console.log('📡 Real-time subscription status update received');
          if (subscriptionStatus) {
            useStore.setState({ subscriptionStatus });
          }
        });
      } else {
        // User signed out, clean up listeners and notification token
        console.log('🔌 User signed out, cleaning up listeners');
        firestoreService.cleanup();
        notificationService.removeNotificationListeners();
        setUserDataLoaded(false);
      }
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
          loadNextQuoteNumber(),
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

    // Cleanup subscription, Firestore, and notification listeners on unmount
    return () => {
      subscriptionSyncService.cleanup();
      firestoreService.cleanup();
      notificationService.removeNotificationListeners();
    };
  }, []);

  // Check for Stripe checkout success on web
  useEffect(() => {
    if (Platform.OS === 'web' && user) {
      const checkStripeReturn = async () => {
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const sessionId = urlParams.get('session_id');
          const paymentSuccess = urlParams.get('payment');

          // Handle hosted checkout return (session_id parameter)
          if (sessionId) {
            console.log('🎉 Returned from Stripe hosted checkout, checking subscription status...');

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

              // Sync to Firestore
              await firestoreService.saveSubscriptionStatus(subscriptionStatus);

              // Reload subscription in UI
              await loadSubscription();

              alert('🎉 Subscription activated! You now have unlimited quote analyses.');
            }

            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
          }

          // Handle embedded checkout return (payment=success parameter)
          if (paymentSuccess === 'success') {
            console.log('🎉 Returned from payment authentication, checking subscription status...');

            // Wait a bit for Stripe webhooks to process
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Query subscription status from Stripe
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

              // Sync to Firestore
              await firestoreService.saveSubscriptionStatus(subscriptionStatus);

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

  // Show loading screen while initializing OR while user data is being loaded after auth
  if (isLoading || (user && !userDataLoaded)) {
    return (
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <View style={appStyles.loadingContainer}>
            <StatusBar style="light" />
            <Image
              source={require('./assets/logo-scaled.png')}
              style={appStyles.loadingLogo}
              resizeMode="contain"
            />
            <ActivityIndicator size="large" color={theme.colors.primary} style={appStyles.loadingSpinner} />
          </View>
        </PaperProvider>
      </SafeAreaProvider>
    );
  }

  // Require authentication on all platforms before showing the app
  if (requiresAuth && !user) {
    console.log('📱 Showing auth screen - user not signed in');
    return (
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <NavigationContainer key="auth" theme={navigationTheme}>
            <StatusBar style="light" />
            <AuthScreen />
          </NavigationContainer>
        </PaperProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <NavigationContainer key="main" theme={navigationTheme}>
          <StatusBar style="light" />
          {(isOnboarded && !FORCE_ONBOARDING) ? <RootNavigator /> : <NewOnboardingScreen />}
        </NavigationContainer>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const appStyles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingLogo: {
    width: 88,
    height: 88,
    borderRadius: 20,
    marginBottom: 32,
  },
  loadingSpinner: {
    marginTop: 16,
  },
});
