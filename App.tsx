/**
 * QuoteMate - Main App Entry Point
 * A quoting tool for Australian tradies.
 */

import 'react-native-gesture-handler';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { initSentry, wrapRootComponent, reportIssue } from './src/config/sentry';
import { Platform, LogBox, InteractionManager, AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

// Suppress known harmless warning from react-native-draggable-flatlist + reanimated v3
LogBox.ignoreLogs(['ref.measureLayout must be called with a ref to a native component']);
import { NavigationContainer, DarkTheme, LinkingOptions, createNavigationContainerRef, getStateFromPath as defaultGetStateFromPath, getPathFromState as defaultGetPathFromState } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { LINKING_CONFIG } from './src/navigation/linkingConfig';
import { Provider as PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged } from 'firebase/auth';
import { KeyboardProvider, KeyboardToolbar } from 'react-native-keyboard-controller';
import { isStickyFooterMounted, subscribeStickyFooter } from './src/components/stickyFooterPresence';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useStore } from './src/store/useStore';
import { useJobStore } from './src/store/useJobStore';
import { useJobListPrefsStore } from './src/store/useJobListPrefsStore';

const LAST_USER_UID_KEY = '@quotemate:lastUserUid';
const LAST_USER_EMAIL_KEY = '@quotemate:lastUserEmail';
import * as Font from 'expo-font';
import { ThemeProvider, useAppTheme, makeStyles, FONT_ASSETS } from './src/theme';
import {
  buildPaperTheme,
  buildNavigationTheme,
  statusBarStyle,
} from './src/theme/adapters';
import { seedAppearanceForExistingUser } from './src/services/appearance';

import { RootNavigator } from './src/navigation/RootNavigator';
import { isDemoCaptureActive } from './src/demo/demoPlayback';
import { trackEvent } from './src/services/analyticsService';
import { appOpenTracker, pushTapKey, pushTypeOf } from './src/services/appOpenTracker';
import { warmUpTapToPay } from './src/services/squarePayments';
import { syncFavoritesFromCloud } from './src/services/materialFavorites';
import { registerQuotingProfileSource } from './src/services/assistant/quotingProfileContext';
import { trackWebEvent } from './src/utils/webAnalytics';
import {
  raceTimeout,
  failedLoaderNames,
  resolveLaunchGate,
  isAuthKnown,
  BOOTSTRAP_TIMEOUT_MS,
  FIRST_PAINT_TIMEOUT_MS,
  SESSION_RESTORE_TIMEOUT_MS,
  SPLASH_MAX_MS,
  type LoaderName,
} from './src/utils/bootstrapGate';

// Order MUST match the Promise.allSettled batch in the auth handler — the
// names are positional, and a mismatch would blame the wrong loader in the
// telemetry that exists to diagnose exactly this.
const CRITICAL_LOADERS: readonly LoaderName[] = [
  'quotes',
  'businessSettings',
  'onboarding',
  'subscription',
  'nextQuoteNumber',
];
import { NewOnboardingScreen } from './src/screens/NewOnboardingScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { subscriptionSyncService } from './src/services/subscriptionSyncService';
import { recoverPendingPurchases } from './src/services/receiptEntitlement';
import { auth, AUTH_PERSISTENCE_KEY } from './src/config/firebase';
import { shouldClearLocalData } from './src/utils/localDataReset';
import { consumeSignOutIntent } from './src/services/authIntent';
import { initWebAnalytics } from './src/utils/webAnalytics';
import { fetchReclaimedOldUid } from './src/services/accountReclaimService';
import { captureAttributionFromUrl, persistAttributionIfNew } from './src/services/attributionService';
import { stripeService } from './src/services/stripeService';
import { firestoreService } from './src/services/firestoreService';
import { documentService } from './src/services/documentService';
import { notificationService } from './src/services/notificationService';
import { routeForNotification } from './src/services/notificationRouting';
import { checkForUpdate, snoozeUpdate, AppUpdateInfo, releaseKey } from './src/services/appUpdateService';
import { checkDeferredLink } from './src/services/supplierDiscoveryService';
import { applyPendingReferral, storePendingReferral } from './src/services/pendingReferral';
import { AppUpdateSheet } from './src/components/AppUpdateSheet';
import { keyboardToolbarVisibleForRoute } from './src/screens/assistant/composerKeyboard';
import { SplashOverlay } from './src/components/SplashOverlay';

// Mate's prompt carries this business's saved quoting profile (preferences +
// rate card). Registered here, at the composition root, so the assistant
// services never import the store.
registerQuotingProfileSource(() => useStore.getState().businessSettings);

const navigationRef = createNavigationContainerRef<any>();

// iOS-only keyboard accessory (prev/next/Done). Kept off the Mate tab: the
// chat composer sits flush above the keyboard there, and the toolbar would
// render directly on top of it. Subscribes to the nav ref itself so route
// changes re-render this leaf, not the whole App tree.
function RouteAwareKeyboardToolbar() {
  const [routeName, setRouteName] = useState<string | undefined>(undefined);
  useEffect(() => {
    const update = () => setRouteName(navigationRef.getCurrentRoute()?.name);
    update();
    return navigationRef.addListener('state', update);
  }, []);
  // A screen with its own keyboard-sticky action bar already owns the strip
  // above the keyboard; drawing the toolbar there puts prev/next/Done straight
  // on top of Save. See components/stickyFooterPresence.
  const stickyFooter = useSyncExternalStore(
    subscribeStickyFooter,
    isStickyFooterMounted,
    isStickyFooterMounted,
  );
  if (stickyFooter) return null;
  if (!keyboardToolbarVisibleForRoute(routeName)) return null;
  return <KeyboardToolbar />;
}

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
  // Route map lives in src/navigation/linkingConfig.ts so it can be unit
  // tested (see linkingConfig.test.ts) and cross-checked against the native
  // Universal Link / App Link path allow-lists.
  config: LINKING_CONFIG,
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

  // GA4 for the web build only — same property/origin as the marketing site,
  // so sessions and sign_up events attribute to the acquiring channel.
  initWebAnalytics();
}

// As early as possible so crashes during startup/data-load are captured —
// the July 2026 ghost-job crash happened right here, between mount and the
// first Firestore snapshot render.
initSentry();

function App() {
  const { theme: appTheme } = useAppTheme();
  const paperTheme = React.useMemo(() => buildPaperTheme(appTheme), [appTheme]);
  const navigationTheme = React.useMemo(() => buildNavigationTheme(appTheme), [appTheme]);
  const appStyles = useAppStyles();
  const [isLoading, setIsLoading] = useState(true);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [userDataLoaded, setUserDataLoaded] = useState(false);
  // Firebase has said something — a user, or null. Deliberately NOT the same as
  // knowing whether anybody is signed in: its RN persistence reports null
  // before it has read the stored session, and that null used to lift the
  // splash onto the sign-in screen in front of a signed-in tradie. isAuthKnown
  // is what turns these three flags into an answer.
  const [firebaseReported, setFirebaseReported] = useState(false);
  // The device's record of a live session; null while the read is in flight.
  const [hadSession, setHadSession] = useState<boolean | null>(null);
  // Give-up point for a session the device says exists but Firebase never
  // produces (revoked server-side). See SESSION_RESTORE_TIMEOUT_MS.
  const [restoreDeadlinePassed, setRestoreDeadlinePassed] = useState(false);
  // Absolute ceiling on the splash. The batch timeouts cover the two load
  // gates; this covers everything else that can wedge them (a font load that
  // never resolves, a throw before either flag is set). Nothing is worth
  // leaving a signed-in tradie on a motionless logo — they don't come back.
  const [splashExpired, setSplashExpired] = useState(false);
  // Tracks which uid we've already completed first-sign-in setup for.
  // Firebase fires onAuthStateChanged on EVERY token refresh — including the
  // refresh that getIdToken() in xeroService.ts (and others) triggers shortly
  // after sign-in. Without this guard, the splash flashes back into view a
  // few seconds after the dashboard mounts, and the data-load Promise.all
  // runs twice — which feels (and looks) like the app reloading itself.
  const initialisedForUidRef = useRef<string | null>(null);
  // Has Firebase produced a real user at any point in this process?
  //
  // This is what separates a genuine sign-out from the `null` that Firebase's
  // RN persistence emits before it has read the persisted session. Without it
  // the null ran the whole sign-out branch on every cold start — tearing down
  // listeners nothing had built yet, and (worse, once it existed) writing
  // "no active session" over the flag the launch gate was about to read.
  const sawUserRef = useRef(false);
  // Selector, NOT a bare useStore() destructure — the bare form subscribes
  // App to the whole store, so every quote save / listener echo re-rendered
  // the entire app tree (NavigationContainer down), dropping frames right as
  // the user navigated. isOnboarded is the only state App renders from; the
  // load actions are stable and fetched via getState() inside the effects.
  const isOnboarded = useStore((s) => s.isOnboarded);
  // Tiebreak for the one case where onboarding is never determined (offline on
  // a device that has never synced). A boolean selector, so it re-renders App
  // only when the answer actually flips.
  const hasLocalBusiness = useStore((s) => !!s.businessSettings?.businessName);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [showUpdateSheet, setShowUpdateSheet] = useState(false);

  // Capture-only — true exclusively when a marketing demo build has an injected
  // payload (window.__QM_DEMO__). Renders the real navigator (Mate tab) without
  // a live login so the demo harness can record. The injected payload is the
  // real gate, so this can never trip for production users — see isDemoCaptureActive.
  const DEMO_CAPTURE = isDemoCaptureActive();

  useEffect(() => {
    const {
      checkOnboarding,
      loadQuotes,
      loadBusinessSettings,
      loadSubscription,
      loadNextQuoteNumber,
      loadXeroConnection,
      loadContacts,
      loadDocuments,
      listenToDocuments,
    } = useStore.getState();
    // Stash ad-attribution params (utm_*/fbclid) from the launch URL before
    // anything can navigate away from them. No-op on native and organic loads.
    captureAttributionFromUrl();
    // Park a referral code from the launch URL BEFORE the auth gate can throw
    // it away. applyReferralCode needs auth, and a referral link almost always
    // lands on a fresh install that isn't signed in yet — without this the
    // referrer never got credited unless the tradie retyped the code from
    // memory in Settings. Applied automatically after first sign-in below.
    Linking.getInitialURL()
      .then((url) => (url ? storePendingReferral(url) : null))
      .catch(() => {});
    // Same for a link that arrives while the app is already running (warm
    // start): the code is parked, and applied on the spot if already signed in.
    const referralLinkSub = Linking.addEventListener('url', ({ url }) => {
      void storePendingReferral(url).then((code) => {
        if (!code || !auth.currentUser) return;
        void applyPendingReferral().then((result) => {
          if (result === 'applied') void useStore.getState().loadReferralInfo();
        });
      });
    });
    // Listen to authentication state changes
    const handleAuthChange = async (currentUser: typeof auth.currentUser) => {
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
      // If a *different identity* signs in than the last session, wipe the
      // previous user's locally-cached data first. Otherwise loadQuotes /
      // loadBusinessSettings fall through to AsyncStorage when the new user's
      // Firestore returns empty, showing (and re-uploading) the old user's
      // quotes/settings under the new account. Deliberately NOT wiped: sign-out
      // and same-email re-registrations (new uid, same person) — after the
      // July 2026 account-deletion incident the device copy can be the only
      // surviving copy, and the fall-through re-upload is how it's restored.
      const newUid = currentUser?.uid ?? null;
      const newEmail = currentUser?.email ?? null;
      let lastUid: string | null = null;
      let lastEmail: string | null = null;
      try {
        [lastUid, lastEmail] = await Promise.all([
          AsyncStorage.getItem(LAST_USER_UID_KEY),
          AsyncStorage.getItem(LAST_USER_EMAIL_KEY),
        ]);
      } catch {
        // ignore - treat as no last user
      }
      let clearLocal = shouldClearLocalData({ lastUid, lastEmail, newUid, newEmail });
      if (clearLocal && newEmail) {
        // Last-chance veto before wiping: devices that predate the stored
        // email can still be recognised via the incident-recovery map — if
        // this email's deleted account is exactly the account this device
        // last held, it's the same person re-registering.
        const reclaimOldUid = await fetchReclaimedOldUid(newEmail);
        clearLocal = shouldClearLocalData({ lastUid, lastEmail, newUid, newEmail, reclaimOldUid });
      }
      if (clearLocal) {
        await useStore.getState().clearAllData();
        useJobStore.getState().cleanup();
      }
      if (newUid) {
        try {
          await AsyncStorage.setItem(LAST_USER_UID_KEY, newUid);
          if (newEmail) {
            await AsyncStorage.setItem(LAST_USER_EMAIL_KEY, newEmail);
          }
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
        // Claim the uid now so a token refresh mid-load can't start a second
        // batch — but RELEASE it below if the load times out, so the next auth
        // event can retry. Claiming permanently before the await is what made
        // a hung load unrecoverable for the rest of the session.
        initialisedForUidRef.current = newUid;

        // Ad attribution (web only, fire-and-forget): write-once first-touch
        // params captured at launch to users/{uid}/profile/attribution.
        if (newUid) {
          void persistAttributionIfNew(newUid);
        }

        setUserDataLoaded(false); // Reset when new user signs in

        // Fires BEFORE any load, so a user who never gets past this point
        // still leaves a trace. Until this existed, a stranded sign-in was
        // invisible: no document written, no screen mounted, no other event.
        const bootstrapStartedAt = Date.now();
        const bootstrapProps = { platform: Platform.OS };
        trackEvent('auth_bootstrap_started', bootstrapProps);
        trackWebEvent('auth_bootstrap_started', bootstrapProps);

        // Critical-for-first-paint: dashboard needs quotes, business settings,
        // subscription (trial banner), onboarding flag (router gate), and the
        // quote-number counter. Everything else gets deferred until after first
        // paint so the splash dismisses sooner.
        //
        // allSettled + a timeout, never a bare Promise.all: each loader already
        // swallows its own errors, so the risk here was never rejection — it
        // was a Firestore read that never settles at all, holding the splash
        // open forever. See src/utils/bootstrapGate.ts.
        let settled: PromiseSettledResult<void>[] = [];
        const batch = Promise.allSettled([
          loadQuotes(),
          loadBusinessSettings(),
          checkOnboarding(),
          loadSubscription(),
          loadNextQuoteNumber(),
        ]).then((r) => { settled = r; });

        // Two races over the same batch, answering two different questions.
        //
        // First: when may the splash come down? Every loader now paints the
        // device's copy before it asks the network (see loadQuotes), and the
        // realtime listeners registered below keep it current — so once the
        // device has been read there is nothing left worth staring at a logo
        // for. Waiting on the cloud half meant a launch on a weak connection
        // held the splash for seconds and then opened on the same data it had
        // all along. Not awaited: the batch keeps running behind the app.
        void raceTimeout(batch, FIRST_PAINT_TIMEOUT_MS).then(() => {
          setUserDataLoaded(true);
        });

        // Second: did the batch actually finish? Unchanged 8s contract — this
        // is the stranded-signup safety net, and it must NOT fire every time a
        // tradie opens the app in a basement.
        const outcome = await raceTimeout(batch, BOOTSTRAP_TIMEOUT_MS);

        setUserDataLoaded(true); // no-op if the first-paint race already did it

        if (outcome === 'timeout') {
          // Let the next auth event have another go. The user is already
          // looking at the app (onboarding or a thin dashboard) rather than a
          // dead splash, and the loaders keep running in the background.
          initialisedForUidRef.current = null;
          // Sentry, not just trackEvent: the analytics channel writes to
          // Firestore, so a hung Firestore read would swallow the very event
          // reporting it. This is the one path that must not depend on the
          // subsystem it's diagnosing.
          reportIssue('auth bootstrap timed out', {
            platform: Platform.OS,
            timeoutMs: BOOTSTRAP_TIMEOUT_MS,
          });
        }

        trackEvent('auth_bootstrap_finished', {
          ...bootstrapProps,
          outcome,
          duration_ms: Date.now() - bootstrapStartedAt,
          failed_loaders: failedLoaderNames(CRITICAL_LOADERS, settled),
        });
        trackWebEvent('auth_bootstrap_finished', {
          ...bootstrapProps,
          outcome,
          duration_ms: Date.now() - bootstrapStartedAt,
          failed_loaders: failedLoaderNames(CRITICAL_LOADERS, settled),
        });

        // Deferred batch — fires after the first interaction frame so the
        // splash → dashboard transition isn't gated on these.
        InteractionManager.runAfterInteractions(() => {
          Promise.all([
            loadDocuments(),
            useJobStore.getState().loadJobs(),
            loadXeroConnection(),
            loadContacts(),
            // Pull the supplier book's cloud copy into the local cache the
            // pricing pipeline reads. Without it a reinstall priced from
            // retail while Firestore still held every saved rate.
            syncFavoritesFromCloud(),
            // Which pile and sort the Jobs list should open on. Cheap local
            // read; the screen also hydrates on mount, so this only warms it.
            useJobListPrefsStore.getState().hydrate(),
          ]).catch(() => {});
        });

        // Check for deferred deep link (QR code scanned before app install)
        checkDeferredLink().then((supplierId) => {
          if (supplierId && navigationRef.isReady()) {
            navigationRef.navigate('DiscoverSuppliers', { supplier: supplierId });
          }
        });

        // Apply a referral code captured before sign-in (see storePendingReferral
        // at launch). Silent and fire-and-forget: this only credits the referrer,
        // it grants the new user nothing, so there is nothing to report. A
        // terminal rejection drops the code; a transport failure retries next
        // launch.
        void applyPendingReferral()
          .then((result) => {
            if (result === 'applied') {
              void useStore.getState().loadReferralInfo();
            }
          })
          .catch(() => {});

        // Push registration is no longer requested here. Asking at sign-in
        // burns the one-shot OS prompt before the tradie has seen anything
        // work, and on iOS a decline is permanent. The ask now happens after
        // they send their first quote — see maybePromptForPushPermission.

        // The cold open, counted once per process and held briefly so a
        // launching notification tap can claim it (see appOpenTracker). Must
        // precede the listener registration below, or a replayed tap could
        // land before there is an open to attribute.
        appOpenTracker.noteOpen('cold');

        if (Platform.OS !== 'web') {
          // Re-register silently for anyone who already granted permission, so
          // a reinstall or token rotation doesn't quietly stop delivery.
          notificationService.refreshTokenIfPermitted().catch(() => {});

          // Clear any badge left over from notifications received while away.
          notificationService.clearBadge().catch(() => {});

          notificationService.setupNotificationListeners(
            undefined,
            (response) => {
              appOpenTracker.notePushTap(pushTypeOf(response), pushTapKey(response));
              // Take the tradie to whatever the notification was about.
              const route = routeForNotification(
                response?.notification?.request?.content?.data
              );
              if (!route || !navigationRef.isReady()) return;
              try {
                // The route name is resolved at runtime from the push payload,
                // so it can't be checked against RootStackParamList here.
                const navigate = navigationRef.navigate as (
                  screen: string,
                  params?: Record<string, unknown>,
                ) => void;
                navigate(route.screen, route.params);
              } catch (err) {
                reportIssue('notification navigation failed', {
                  screen: route.screen,
                  message: (err as Error)?.message,
                });
              }
              void notificationService.clearBadge();
            }
          );

          // A tap that launched the process may or may not reach the listener
          // above; ask for it outright. Same key as the listener path, so it
          // is attributed once either way. Attribution only — navigation for
          // launch taps is unchanged.
          notificationService
            .getLaunchNotificationResponse()
            .then((response) => {
              if (response) appOpenTracker.notePushTap(pushTypeOf(response), pushTapKey(response));
            })
            .catch(() => {});
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
        // A null BEFORE we have ever seen a user is Firebase's persistence
        // still loading, not a sign-out. There is nothing to tear down at that
        // point anyway — and running this branch is what used to overwrite the
        // active-session flag, so the launch gate read "signed out" from a
        // value this very launch had just written.
        if (!sawUserRef.current) return;
        // User signed out, clean up listeners and notification token
        initialisedForUidRef.current = null;
        // Nothing to wait for any more: Firebase clears its persistence record
        // on sign-out, so the next launch reads "no session" by itself. This
        // just makes the CURRENT render agree immediately, so the sign-in
        // screen appears on the tap rather than after the restore grace.
        setHadSession(false);
        firestoreService.cleanup();
        documentService.cleanup();
        useJobStore.getState().cleanup();
        notificationService.removeNotificationListeners();
        setUserDataLoaded(false);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      // Who it is, and the fact that we now know, in ONE update — not split
      // across the async handler below. handleAuthChange awaits two
      // AsyncStorage reads (and sometimes a whole clearAllData) before it
      // reaches its own setUser, so announcing "auth resolved" here while
      // `user` was still null opened a window where the gate saw a signed-out
      // app and rendered the sign-in screen. That window was measured at ~1.1s
      // on an API 36 emulator and is exactly the "Welcome back" flash.
      //
      // A null is only a sign-out if the app asked for one.
      //
      // The old guard here was `auth.currentUser` — the theory being that it
      // stays populated through a token refresh. It does not: on a cold start
      // Firebase delivers the restored user and then, ~1s later, a second null
      // with auth.currentUser ALSO null. That null tore the app down to the
      // sign-in screen mid-launch, and it is the flash that survived every fix
      // aimed at the launch gate, because it lands after the session is
      // already restored. See services/authIntent for what is and isn't
      // covered.
      if (!currentUser && sawUserRef.current && !consumeSignOutIntent()) return;
      if (!currentUser && auth.currentUser) return;
      if (currentUser) sawUserRef.current = true;
      setUser(currentUser);
      // Firebase has spoken. Whether that settles the question is isAuthKnown's
      // call, not ours — a null here may just be the persistence read still
      // running.
      setFirebaseReported(true);
      // Recovery lives here rather than inside the handler so the whole body
      // above — including the awaits that sit outside their own try/catch
      // (clearAllData, the AsyncStorage writes) — is covered. A throw used to
      // skip setUserDataLoaded entirely and strand the user on the splash with
      // no way back: the uid was already claimed, so re-fired auth events
      // short-circuited. Open the gate, release the claim, report it.
      void handleAuthChange(currentUser).catch((err) => {
        initialisedForUidRef.current = null;
        setUserDataLoaded(true);
        reportIssue('auth state handler threw', {
          platform: Platform.OS,
          error: (err as any)?.message ?? String(err),
        });
      });
    });

    return () => {
      referralLinkSub.remove();
      unsubscribe();
    };
  }, []);

  // "Was somebody signed in last time?" — asked of the device, because Firebase
  // cannot answer it. Its RN persistence fires onAuthStateChanged with `null`
  // before the persisted session is read, auth.currentUser is null then too,
  // and authStateReady() resolves on that same first emission. Both were tried
  // against a real Android cold start; both still showed the sign-in screen to
  // a signed-in tradie for ~1.1s. See isAuthKnown.
  useEffect(() => {
    let cancelled = false;
    // Firebase's own persistence record, not a flag of ours. It exists if and
    // only if there is a session to restore, needs no bookkeeping at sign-in or
    // sign-out, and is already correct for every install that updates into this
    // build. A flag we maintained ourselves would have to be migrated, and
    // would strand a signed-out tradie on the splash for the whole restore
    // grace period on every launch until something wrote it.
    AsyncStorage.getItem(AUTH_PERSISTENCE_KEY)
      .then((session) => {
        if (!cancelled) setHadSession(session != null);
      })
      .catch(() => {
        // Unreadable storage: assume no session rather than stalling the gate.
        if (!cancelled) setHadSession(false);
      });
    // Bounded, so a session that was revoked server-side still reaches the
    // sign-in screen instead of sitting on the logo until SPLASH_MAX_MS.
    const timer = setTimeout(() => setRestoreDeadlinePassed(true), SESSION_RESTORE_TIMEOUT_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Icons + Archivo. Both must land before first paint or the app renders one
  // face and then reflows into another. Failure still opens the gate: the type
  // scale falls back to the system font, which is a slightly plainer app rather
  // than no app at all.
  useEffect(() => {
    Promise.all([MaterialCommunityIcons.loadFont(), Font.loadAsync(FONT_ASSETS)])
      .then(() => setFontsLoaded(true))
      .catch(() => setFontsLoaded(true));
  }, []);

  // Pin upgrading users to dark, once. Every user before this release has only
  // ever seen a dark app; signed-in AND onboarded is the signal that they were
  // here before it shipped. A fresh install falls through to 'system'. No-ops
  // once a preference exists, so it is safe to re-run on every auth change.
  useEffect(() => {
    void seedAppearanceForExistingUser(!!user && isOnboarded === true);
  }, [user, isOnboarded]);

  // Apple req 1.5: warm up Tap to Pay at launch and on every return to the
  // foreground, so the reader is ready before a tradie is standing in front of
  // a customer (and req 5.6's one-second open is achievable). Best-effort by
  // contract — warmUpTapToPay never throws, and it deliberately skips a
  // merchant who hasn't accepted Apple's T&Cs rather than ambushing them with
  // the acceptance sheet at launch. Gated on being signed in, since it needs
  // the tradie's Square connection to mint an auth code.
  useEffect(() => {
    if (!user) return;
    void warmUpTapToPay();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void warmUpTapToPay();
    });
    return () => sub.remove();
  }, [user]);

  // app_opened, foreground half: every return from the background, on every
  // platform (the cold open is noted at sign-in above). Not gated on `user` —
  // the tracker doesn't care, and analytics drops anonymous writes itself.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      appOpenTracker.handleAppStateChange(next);
    });
    return () => sub.remove();
  }, []);

  // Dead-man's switch on the splash overlay. Runs once from mount rather than
  // resetting per gate, so a chain of individually-short stalls still can't
  // add up to an indefinite logo screen.
  useEffect(() => {
    const timer = setTimeout(() => setSplashExpired(true), SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const {
      checkOnboarding,
      loadQuotes,
      loadBusinessSettings,
      loadSubscription,
      loadNextQuoteNumber,
      loadContacts,
    } = useStore.getState();
    async function initialize() {
      try {
        // First-paint critical: cached state from AsyncStorage for instant UI.
        // Same timeout treatment as the post-sign-in batch — this gate feeds
        // the same splash, and an AsyncStorage read that never settles strands
        // the user just as effectively. See src/utils/bootstrapGate.ts.
        await raceTimeout(
          Promise.allSettled([
            checkOnboarding(),
            loadQuotes(),
            loadBusinessSettings(),
            loadSubscription(),
            loadNextQuoteNumber(),
          ]),
          BOOTSTRAP_TIMEOUT_MS,
        );

        setIsLoading(false);

        // Non-critical: contacts list, subscription sync init, update check —
        // run after first paint so the splash doesn't stall on them.
        InteractionManager.runAfterInteractions(async () => {
          loadContacts().catch(() => {});
          try {
            await subscriptionSyncService.initialize();
          } catch {}
          // Finish any purchase the stores still consider outstanding. This is
          // what makes "it'll finish automatically next time you open the app"
          // true — before this, entitlement could only ever be granted from
          // PaywallScreen, so a buyer whose validation failed had to find their
          // way back to that exact screen or stay charged-but-not-Pro.
          try {
            const summary = await recoverPendingPurchases({
              onGranted: async () => { await loadSubscription(); },
            });
            // summary.granted counts only receipts this sweep actually healed.
            // Re-checks of a live subscription land in alreadyEntitled, so an
            // ordinary Pro user opening the app no longer trips the alarm.
            if (summary.granted > 0) {
              trackEvent('purchase_recovered_on_launch', {
                granted: summary.granted,
                checked: summary.checked,
                alreadyEntitled: summary.alreadyEntitled,
                platform: Platform.OS,
              });
            }
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
          await useStore.getState().loadSubscription();

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
  // Which of splash / sign-in / onboarding / app to show. The ordering rules
  // live in resolveLaunchGate so they can be asserted without mounting the app
  // — they were wrong in four ways at once, and every one of them was only
  // visible as a flash on a real Android cold start. Auth is always required —
  // the old requiresAuth constant was hardcoded true and is folded in here.
  const authResolved = isAuthKnown({
    signedIn: !!user,
    firebaseReported,
    hadSession,
    restoreDeadlinePassed,
  });
  const { splashVisible, showAuthScreen, showMainApp } = resolveLaunchGate({
    demoCapture: DEMO_CAPTURE,
    splashExpired,
    localLoading: isLoading,
    fontsLoaded,
    authResolved,
    signedIn: !!user,
    userDataLoaded,
    isOnboarded,
    hasLocalBusiness,
  });

  return (
    <GestureHandlerRootView style={appStyles.flex}>
      <SafeAreaProvider>
        {/* preload={false}: on iOS the library warms the keyboard at startup by
            adding a hidden UITextField and calling becomeFirstResponder /
            resignFirstResponder (see ios/extensions/UIResponder.swift). It is
            meant to be invisible, but on an older device the two calls do not
            land in the same frame and the keyboard visibly flashes up as the
            app opens — reported from an iPhone 11, 6 Sep 2026. The cost of
            turning it off is a slightly slower FIRST keyboard open; the cost of
            leaving it on is an app that looks broken the moment it launches. */}
        <KeyboardProvider preload={false}>
          <PaperProvider theme={paperTheme}>
            <NavigationContainer
              key="root"
              theme={navigationTheme}
              linking={linking}
              ref={navigationRef}
            >
              <StatusBar style={statusBarStyle(appTheme)} />
              {showAuthScreen ? (
                <AuthScreen />
              ) : showMainApp ? (
                <RootNavigator />
              ) : (
                <NewOnboardingScreen />
              )}
            </NavigationContainer>
            {Platform.OS === 'ios' && <RouteAwareKeyboardToolbar />}
            {showUpdateSheet && updateInfo && (
              <AppUpdateSheet
                visible={showUpdateSheet}
                onDismiss={() => {
                  setShowUpdateSheet(false);
                  // "Maybe later" — keep this version quiet for a few days
                  // rather than re-asking on every cold start.
                  snoozeUpdate(releaseKey(updateInfo.latestVersion, updateInfo.latestBuild));
                }}
                info={updateInfo}
              />
            )}
            {/* Splash overlay — covers the app during cold start and during
                the brief post-sign-in data load. As an overlay (not a separate
                React tree) the NavigationContainer underneath stays mounted,
                so when the splash hides the app is already there. It renders
                the same frame as the native launch screen and animates its own
                exit — see SplashOverlay. */}
            <SplashOverlay visible={splashVisible} />
          </PaperProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const useAppStyles = makeStyles(() => ({
  flex: {
    flex: 1,
  },
}));

/**
 * ThemeProvider sits ABOVE App so App itself can read the theme — the Paper
 * theme, the navigation theme and the status-bar style all derive from it.
 */
function Root() {
  return (
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
}

export default wrapRootComponent(Root);
