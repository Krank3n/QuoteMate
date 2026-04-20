/**
 * QuoteMate - Main App Entry Point
 * A quoting tool for Australian tradies.
 */

import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { Platform, View, Image, StyleSheet, LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

// Suppress known harmless warning from react-native-draggable-flatlist + reanimated v3
LogBox.ignoreLogs(['ref.measureLayout must be called with a ref to a native component']);
import { NavigationContainer, DarkTheme, LinkingOptions, createNavigationContainerRef } from '@react-navigation/native';
import * as Linking from 'expo-linking';
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
import { documentService } from './src/services/documentService';
import { notificationService } from './src/services/notificationService';
import { checkForUpdate, AppUpdateInfo } from './src/services/appUpdateService';
import { checkDeferredLink } from './src/services/supplierDiscoveryService';
import { AppUpdateSheet } from './src/components/AppUpdateSheet';

const navigationRef = createNavigationContainerRef<any>();

const linking: LinkingOptions<any> = {
  prefixes: [Linking.createURL('/'), 'https://quotemateapp.au', 'quotemate://'],
  config: {
    screens: {
      DiscoverSuppliers: 'join',
    },
  },
};

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [userDataLoaded, setUserDataLoaded] = useState(false);
  const { isOnboarded, checkOnboarding, loadQuotes, loadBusinessSettings, loadSubscription, loadNextQuoteNumber, checkTourStatus, loadXeroConnection, loadContacts, loadDocuments, listenToDocuments } = useStore();
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [showUpdateSheet, setShowUpdateSheet] = useState(false);

  const requiresAuth = true;

  useEffect(() => {
    // Listen to authentication state changes
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      // When user signs in, reload data from Firestore and set up listeners
      if (currentUser) {
        setUserDataLoaded(false); // Reset when new user signs in

        await Promise.all([
          loadQuotes(),
          loadDocuments(),
          loadBusinessSettings(),
          checkOnboarding(),
          loadSubscription(),
          loadNextQuoteNumber(),
          checkTourStatus(),
          loadXeroConnection(),
          loadContacts(),
        ]);

        setUserDataLoaded(true); // Mark user data as loaded

        // Check for deferred deep link (QR code scanned before app install)
        checkDeferredLink().then((supplierId) => {
          if (supplierId && navigationRef.isReady()) {
            navigationRef.navigate('DiscoverSuppliers', { supplier: supplierId });
          }
        });

        // Register for push notifications
        if (Platform.OS !== 'web') {
          notificationService.registerForPushNotifications().then((token) => {
            if (token) {
            }
          });

          // Set up notification listeners
          notificationService.setupNotificationListeners(
            (notification) => {
              // Handle notification received while app is open
            },
            (response) => {
              // Handle user tapping on notification
              const data = response.notification.request.content.data;
              if (data?.quoteId && data?.type === 'quote_response') {
                // Could navigate to the quote here if needed
              }
            }
          );
        }

        // Set up real-time listeners for cross-device sync.
        // Use mergeRemoteQuotes/Invoices (not setState) so an in-flight local edit
        // isn't wiped by a stale snapshot — see the merge actions for the rules.
        firestoreService.listenToQuotes((quotes) => {
          useStore.getState().mergeRemoteQuotes(quotes);
        });

        firestoreService.listenToInvoices((invoices) => {
          useStore.getState().mergeRemoteInvoices(invoices);
        });

        // Phase-5: real-time listener for the unified Document collection.
        // Coexists with the legacy listeners during the cutover — server-side
        // mirror keeps both projections in sync, the legacy slices are still
        // referenced by older edit/save flows.
        listenToDocuments();

        firestoreService.listenToBusinessSettings((settings) => {
          if (settings) {
            useStore.setState({ businessSettings: settings });
          }
        });

        firestoreService.listenToOnboardingStatus((isOnboarded) => {
          useStore.setState({ isOnboarded });
        });

        firestoreService.listenToSubscriptionStatus((subscriptionStatus) => {
          if (subscriptionStatus) {
            useStore.setState({ subscriptionStatus });
          }
        });
      } else {
        // User signed out, clean up listeners and notification token
        firestoreService.cleanup();
        documentService.cleanup();
        notificationService.removeNotificationListeners();
        setUserDataLoaded(false);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    MaterialCommunityIcons.loadFont().then(() => setFontsLoaded(true)).catch(() => setFontsLoaded(true));
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
          loadContacts(),
        ]);

        // Initialize subscription sync (syncs across all platforms)
        await subscriptionSyncService.initialize();

        // Check for app updates (slight delay so dashboard renders first)
        const update = await checkForUpdate();
        if (update) {
          setUpdateInfo(update);
          setTimeout(() => setShowUpdateSheet(true), 800);
        }
      } catch (error) {
      } finally {
        setIsLoading(false);
      }
    }

    initialize();

    // Cleanup subscription, Firestore, and notification listeners on unmount
    return () => {
      subscriptionSyncService.cleanup();
      firestoreService.cleanup();
      documentService.cleanup();
      notificationService.removeNotificationListeners();
    };
  }, []);

  // Check for Stripe checkout success on web
  useEffect(() => {
    if (Platform.OS === 'web' && user) {
      const activateSubscription = async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const status = await stripeService.checkSubscriptionStatus(user.uid);

        if (status.isPremium) {
          const subscriptionStatus = {
            isPro: true,
            quotesThisMonth: 0,
            freeQuotesLimit: 5,
            currentPeriodStart: new Date(),
            currentPeriodEnd: status.expiryDate ? new Date(status.expiryDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          };

          const AsyncStorage = require('@react-native-async-storage/async-storage').default;
          await AsyncStorage.setItem('@quotemate:subscription', JSON.stringify(subscriptionStatus));
          await firestoreService.saveSubscriptionStatus(subscriptionStatus);
          await loadSubscription();

          alert('Subscription activated! You now have unlimited quote analyses.');
        }

        window.history.replaceState({}, document.title, window.location.pathname);
      };

      const checkStripeReturn = async () => {
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const sessionId = urlParams.get('session_id');
          const paymentSuccess = urlParams.get('payment');

          if (sessionId || paymentSuccess === 'success') {
            await activateSubscription();
          }
        } catch {
          // Stripe return check failed silently
        }
      };

      checkStripeReturn();
    }
  }, [user]);

  // Show loading screen while initializing OR while user data is being loaded after auth
  if (isLoading || !fontsLoaded || (user && !userDataLoaded)) {
    return (
      <GestureHandlerRootView style={appStyles.flex}>
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
      </GestureHandlerRootView>
    );
  }

  // Require authentication on all platforms before showing the app
  if (requiresAuth && !user) {
    return (
      <GestureHandlerRootView style={appStyles.flex}>
        <SafeAreaProvider>
          <PaperProvider theme={theme}>
            <NavigationContainer key="auth" theme={navigationTheme}>
              <StatusBar style="light" />
              <AuthScreen />
            </NavigationContainer>
          </PaperProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={appStyles.flex}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <NavigationContainer key="main" theme={navigationTheme} linking={linking} ref={navigationRef}>
            <StatusBar style="light" />
            {isOnboarded ? <RootNavigator /> : <NewOnboardingScreen />}
          </NavigationContainer>
          {showUpdateSheet && updateInfo && (
            <AppUpdateSheet
              visible={showUpdateSheet}
              onDismiss={() => setShowUpdateSheet(false)}
              info={updateInfo}
            />
          )}
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const appStyles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
