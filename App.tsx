/**
 * QuoteMate - Main App Entry Point
 * A quoting tool for Australian tradies.
 */

import 'react-native-gesture-handler';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, View, Image, StyleSheet, LogBox, InteractionManager } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

// Suppress known harmless warning from react-native-draggable-flatlist + reanimated v3
LogBox.ignoreLogs(['ref.measureLayout must be called with a ref to a native component']);
import { NavigationContainer, DarkTheme, LinkingOptions, createNavigationContainerRef, getStateFromPath as defaultGetStateFromPath, getPathFromState as defaultGetPathFromState } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { Provider as PaperProvider, ActivityIndicator } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { KeyboardProvider, KeyboardToolbar } from 'react-native-keyboard-controller';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useStore } from './src/store/useStore';
import { useJobStore } from './src/store/useJobStore';

const LAST_USER_UID_KEY = '@quotemate:lastUserUid';
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
import { isDemoCaptureActive } from './src/demo/demoPlayback';
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

// SPA route restore (web only). The app is served from /app on a static host
// with no per-route files, so a hard refresh of /app/<route> 404s and the
// website's 404 page bounces back here with the intended route stashed in
// sessionStorage. Put that route back in the URL before NavigationContainer
// reads it below, so refresh lands on the right screen instead of the 404.
// Runs at module eval (before render); no-op on native and on a clean load.
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  try {
    const k = 'qm_spa_redirect';
    const v = window.sessionStorage.getItem(k);
    if (v) {
      window.sessionStorage.removeItem(k);
      if (v !== '/') window.history.replaceState(null, '', '/app' + v);
    }
  } catch (e) {
    // sessionStorage/history unavailable — ignore, app loads at default route.
  }
}

// The web build is served under /app (Expo baseUrl), but React Navigation's
// linking writes paths from the site root — e.g. navigating to Dashboard sets
// the URL to /Main/Dashboard, escaping /app. On a hard refresh the static host
// has no file there and serves the marketing 404. Namespace every web URL
// under /app so a refresh lands on a /app/* path, which the website's 404 page
// catches and bounces back into the app (see the SPA route restore above).
// Native is unaffected — these overrides only apply on web.
const WEB_BASE = '/app';
const linking: LinkingOptions<any> = {
  prefixes: [Linking.createURL('/'), 'https://quotemateapp.au', 'quotemate://'],
  config: {
    screens: {
      DiscoverSuppliers: 'join',
    },
  },
  ...(Platform.OS === 'web'
    ? {
        getPathFromState(state, config) {
          const path = defaultGetPathFromState(state, config);
          // path always starts with '/'; '/' + base avoids a double slash.
          return WEB_BASE + (path === '/' ? '/' : path);
        },
        getStateFromPath(path, config) {
          const stripped = path.startsWith(WEB_BASE)
            ? path.slice(WEB_BASE.length) || '/'
            : path;
          return defaultGetStateFromPath(stripped, config);
        },
      }
    : {}),
};

// React Native Web renders TextInput as <input>, which inherits Chrome's
// thick blue :focus glow — looks broken next to our bordered View wrappers.
// Replace it once at startup with a subtle brand-green ring that only shows
// for keyboard focus, so click/tap focus stays clean.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const STYLE_ID = 'qm-web-form-focus-reset';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      input, textarea, select {
        outline: none !important;
        box-shadow: none !important;
        -webkit-tap-highlight-color: transparent;
      }
      input:focus, input:focus-visible,
      textarea:focus, textarea:focus-visible,
      select:focus, select:focus-visible {
        outline: none !important;
        box-shadow: none !important;
      }
      /* Chrome paints autofilled fields with its own pale background and
         near-black text, which looks broken on our dark surface. There's no
         way to set the autofill background directly, so mask it with a
         surface-coloured inset box-shadow and force the text fill light.
         The long transition stops Chrome flashing its colour back on focus. */
      input:-webkit-autofill,
      input:-webkit-autofill:hover,
      input:-webkit-autofill:focus,
      input:-webkit-autofill:active {
        -webkit-box-shadow: 0 0 0 1000px #1E293B inset !important;
        box-shadow: 0 0 0 1000px #1E293B inset !important;
        -webkit-text-fill-color: #E2E8F0 !important;
        caret-color: #E2E8F0;
        transition: background-color 9999s ease-in-out 0s;
        /* Fires an animationstart event the instant Chrome autofills, even
           before any gesture (when the value still isn't readable). AuthScreen
           listens for it to drop the floating label that would otherwise sit
           on top of the autofilled text. */
        animation-name: qm-autofill;
        animation-duration: 1ms;
      }
      @keyframes qm-autofill { from {} to {} }
      button { outline: none; }
      button:focus-visible {
        outline: 2px solid rgba(0, 152, 104, 0.55);
        outline-offset: 2px;
      }
      [contenteditable]:focus,
      [contenteditable]:focus-visible {
        outline: none;
      }
    `;
    document.head.appendChild(style);
  }
}

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [userDataLoaded, setUserDataLoaded] = useState(false);
  // Tracks which uid we've already completed first-sign-in setup for.
  // Firebase fires onAuthStateChanged on EVERY token refresh — including the
  // refresh that getIdToken() in xeroService.ts (and others) triggers shortly
  // after sign-in. Without this guard, the splash flashes back into view a
  // few seconds after the dashboard mounts, and the data-load Promise.all
  // runs twice — which feels (and looks) like the app reloading itself.
  const initialisedForUidRef = useRef<string | null>(null);
  const { isOnboarded, checkOnboarding, loadQuotes, loadBusinessSettings, loadSubscription, loadNextQuoteNumber, loadXeroConnection, loadContacts, loadDocuments, listenToDocuments } = useStore();
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [showUpdateSheet, setShowUpdateSheet] = useState(false);

  const requiresAuth = true;
  // Capture-only — true exclusively when a marketing demo build has an injected
  // payload (window.__QM_DEMO__). Renders the real navigator (Mate tab) without
  // a live login so the demo harness can record. The injected payload is the
  // real gate, so this can never trip for production users — see isDemoCaptureActive.
  const DEMO_CAPTURE = isDemoCaptureActive();

  useEffect(() => {
    // Listen to authentication state changes
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      // Firebase's React Native AsyncStorage persistence sometimes refires
      // this listener with a transient `null` during an ID-token refresh
      // (e.g. when `getIdToken()` runs inside xeroService.loadXeroConnection
      // shortly after sign-in) even though the user is still signed in.
      // `auth.currentUser` remains the source of truth in that window — if
      // it still has the user, ignore the spurious null. Without this guard
      // `setUser(null)` flips `showAuthScreen` true for one render, the
      // RootNavigator unmounts, and when the listener immediately fires
      // back with the real user the navigator remounts at its initial
      // route — the "splash + back to home" symptom.
      if (!currentUser && auth.currentUser) {
        return;
      }
      if (currentUser?.providerData.some((provider: any) => provider.providerId === 'password') && !currentUser.emailVerified) {
        await signOut(auth);
        setUser(null);
        setUserDataLoaded(false);
        initialisedForUidRef.current = null;
        return;
      }

      // If a *different* user lands here than the last session, wipe the
      // previous user's locally-cached data first. Otherwise loadQuotes /
      // loadBusinessSettings fall through to AsyncStorage when the new user's
      // Firestore returns empty, showing (and re-uploading) the old user's
      // quotes/settings under the new account.
      const newUid = currentUser?.uid ?? null;
      let lastUid: string | null = null;
      try {
        lastUid = await AsyncStorage.getItem(LAST_USER_UID_KEY);
      } catch {
        // ignore - treat as no last user
      }
      if (lastUid && lastUid !== newUid) {
        await useStore.getState().clearAllData();
        useJobStore.getState().cleanup();
      }
      if (newUid) {
        try {
          await AsyncStorage.setItem(LAST_USER_UID_KEY, newUid);
        } catch {
          // best-effort
        }
      }

      setUser(currentUser);

      // When user signs in, reload data from Firestore and set up listeners
      if (currentUser) {
        // Token-refresh re-fires this callback for the same user. Without this
        // short-circuit the splash would reappear (`setUserDataLoaded(false)`)
        // and Promise.all would run again every ~hour or whenever getIdToken()
        // refreshes — felt like "the app reloaded itself" after sign-in,
        // triggered by Xero's getIdToken() call from the deferred batch.
        if (initialisedForUidRef.current === newUid && newUid !== null) {
          return;
        }
        initialisedForUidRef.current = newUid;

        setUserDataLoaded(false); // Reset when new user signs in

        // Critical-for-first-paint: dashboard needs quotes, business settings,
        // subscription (trial banner), onboarding flag (router gate), and the
        // quote-number counter. Everything else gets deferred until after first
        // paint so the splash dismisses sooner.
        await Promise.all([
          loadQuotes(),
          loadBusinessSettings(),
          checkOnboarding(),
          loadSubscription(),
          loadNextQuoteNumber(),
        ]);

        setUserDataLoaded(true); // Mark user data as loaded — dashboard can render

        // Deferred batch — fires after the first interaction frame so the
        // splash → dashboard transition isn't gated on these.
        InteractionManager.runAfterInteractions(() => {
          Promise.all([
            loadDocuments(),
            useJobStore.getState().loadJobs(),
            loadXeroConnection(),
            loadContacts(),
          ]).catch(() => {});
        });

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

        // Phase-8: real-time listener for the Jobs collection. Aggregates on
        // each Job are written by the onDocumentWriteSyncJob trigger, so the
        // listener is the only way the client stays in sync with those
        // server-side updates.
        useJobStore.getState().listenToJobs();

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
        initialisedForUidRef.current = null;
        firestoreService.cleanup();
        documentService.cleanup();
        useJobStore.getState().cleanup();
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
        // First-paint critical: cached state from AsyncStorage for instant UI.
        await Promise.all([
          checkOnboarding(),
          loadQuotes(),
          loadBusinessSettings(),
          loadSubscription(),
          loadNextQuoteNumber(),
        ]);

        setIsLoading(false);

        // Non-critical: contacts list, subscription sync init, update check —
        // run after first paint so the splash doesn't stall on them.
        InteractionManager.runAfterInteractions(async () => {
          loadContacts().catch(() => {});
          try {
            await subscriptionSyncService.initialize();
          } catch {}
          try {
            const update = await checkForUpdate();
            if (update) {
              setUpdateInfo(update);
              setTimeout(() => setShowUpdateSheet(true), 800);
            }
          } catch {}
        });
      } catch (error) {
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

  // Unified render tree — providers + NavigationContainer mount ONCE for the
  // app's lifetime. Children swap inside (AuthScreen ↔ onboarding ↔ main app)
  // so signing in doesn't tear down and rebuild the entire React tree, which
  // is what caused the "app reloads on sign-in" symptom.
  const splashVisible =
    !DEMO_CAPTURE && (isLoading || !fontsLoaded || (!!user && !userDataLoaded));
  const showAuthScreen = !DEMO_CAPTURE && requiresAuth && !user;
  const showMainApp = DEMO_CAPTURE || isOnboarded;

  return (
    <GestureHandlerRootView style={appStyles.flex}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <PaperProvider theme={theme}>
            <NavigationContainer
              key="root"
              theme={navigationTheme}
              linking={linking}
              ref={navigationRef}
            >
              <StatusBar style="light" />
              {showAuthScreen ? (
                <AuthScreen />
              ) : showMainApp ? (
                <RootNavigator />
              ) : (
                <NewOnboardingScreen />
              )}
            </NavigationContainer>
            {Platform.OS === 'ios' && <KeyboardToolbar />}
            {showUpdateSheet && updateInfo && (
              <AppUpdateSheet
                visible={showUpdateSheet}
                onDismiss={() => setShowUpdateSheet(false)}
                info={updateInfo}
              />
            )}
            {/* Splash overlay — covers the app during cold start and during
                the brief post-sign-in data load. As an overlay (not a separate
                React tree) the NavigationContainer underneath stays mounted,
                so when the splash hides the app is already there. */}
            {splashVisible && (
              <View
                style={[StyleSheet.absoluteFillObject, appStyles.loadingContainer]}
                pointerEvents="auto"
              >
                <Image
                  source={require('./assets/logo-scaled.png')}
                  style={appStyles.loadingLogo}
                  resizeMode="contain"
                />
                <ActivityIndicator
                  size="large"
                  color={theme.colors.primary}
                  style={appStyles.loadingSpinner}
                />
              </View>
            )}
          </PaperProvider>
        </KeyboardProvider>
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
