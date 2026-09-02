const isWebExport = process.env.EXPO_WEB_BASE_URL;

// Square Mobile Payments SDK requires the production application ID baked
// into native init. Read from .env (loaded by Expo at config eval time).
const SQUARE_APPLICATION_ID =
  process.env.SQUARE_APP_ID_PRODUCTION || process.env.SQUARE_APP_ID || '';

export default {
  expo: {
    name: "QuoteMate",
    slug: "quotemate",
    // 1.46: adds the @sentry/react-native NATIVE module. Do not publish JS
    // built from this tree as an OTA for 1.45 — the appVersion runtime
    // policy below is what stops that from happening automatically.
    //
    // 1.56: adds LiveKit WebRTC (@elevenlabs/react-native). The same rule, and
    // this time it is load-bearing in a specific way: liveSession declares
    // VOICE_CLIENT_CAPABILITIES = ['elevenlabs'] on every voice mint, and that
    // claim is made by JS, not verified against the native binary. OTA this
    // bundle onto a 1.55 build and the client would promise a transport it
    // does not have — the server would hand it an ElevenLabs token, the
    // LiveKit import would fail, and the tradie would lose the session having
    // already spent a quota turn. runtimeVersion: appVersion is what makes
    // that impossible, but only while this number is ahead of 1.55.
    version: "1.56",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    // EAS Update (OTA): JS-only changes push over-the-air. runtimeVersion =
    // appVersion means an OTA only lands on a build of the SAME app version,
    // so native changes still require a fresh build + store submit.
    updates: {
      url: "https://u.expo.dev/b164d7f8-b04e-4960-a962-ebc74fe65bce"
    },
    runtimeVersion: {
      policy: "appVersion"
    },
    plugins: [
      [
        // Native crash reporting + source-map upload wiring (CNG: applied at
        // prebuild). Sourcemap upload during EAS builds needs SENTRY_AUTH_TOKEN
        // in EAS env; builds still succeed without it, stacks are just minified.
        "@sentry/react-native/expo",
        {
          organization: process.env.SENTRY_ORG || "hansendev-0p",
          project: process.env.SENTRY_PROJECT || "react-native",
        },
      ],
      [
        "expo-build-properties",
        {
          android: {
            minSdkVersion: 28,
            // Android 16. Play has required targetSdk 36 for updates since
            // 31 Aug 2026 — an API 35 artifact is rejected at upload with
            // "Target SDK of artifact is too low".
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            buildToolsVersion: "36.0.0",
            ndkVersion: "28.0.12433566",
            useLegacyPackaging: false,
            enablePageAlignedLibraries: true,
            kotlinVersion: "2.2.0"
          },
          ios: {
            deploymentTarget: "16.0"
          }
        }
      ],
      [
        // LiveKit WebRTC, the transport under @elevenlabs/react-native. ios/ and
        // android/ are gitignored, so this plugin is the ONLY way the native
        // config survives a prebuild. audioType "communication" is the manifest
        // analogue of the old mic.ts audioSource: 7 (VOICE_COMMUNICATION) — it's
        // what engages platform AEC, which is what lets the half-duplex mic gate
        // in AssistantScreen go away. We never screen-share or use the camera
        // through LiveKit, so both extras stay off.
        "@livekit/react-native-expo-plugin",
        {
          android: { audioType: "communication", enableScreenShareService: false },
          ios: { enableMultitaskingCameraAccess: false }
        }
      ],
      "expo-apple-authentication",
      [
        // Native Google Sign-In (Play Services / iOS account picker). Replaces
        // the browser-based expo-auth-session flow, which Firefox and other
        // non-Chrome default browsers broke by dropping the OAuth redirect.
        "@react-native-google-signin/google-signin",
        {
          // Reversed iOS OAuth client ID — the URL scheme the SDK returns to on
          // iOS (see GOOGLE_OAUTH_IOS_CLIENT_ID).
          iosUrlScheme: "com.googleusercontent.apps.652758863537-isuaotmpo68rj5lirc40otkevmr8annf"
        }
      ],
      [
        "expo-speech-recognition",
        {
          microphonePermission: "QuoteMate uses your microphone for voice-to-text job descriptions and to talk to Mate, your in-app offsider.",
          speechRecognitionPermission: "Allow QuoteMate to use speech recognition for voice-to-text job descriptions.",
          android: {
            requireOnDeviceRecognition: false
          }
        }
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/icon.png",
          color: "#f97316",
          sounds: [],
          android: {
            useNextNotificationsApi: true
          }
        }
      ],
      [
        "expo-image-picker",
        {
          photosPermission: "QuoteMate uses your photo library to attach site photos to quotes for AI material analysis, and to set your company logo on PDF quotes and invoices.",
          cameraPermission: "QuoteMate uses your camera to take site photos for quotes and AI material analysis, and to capture a company logo for PDF quotes and invoices."
        }
      ],
      [
        "expo-contacts",
        {
          contactsPermission: "QuoteMate uses your contacts to quickly fill in customer details when creating quotes and invoices."
        }
      ],
      "expo-iap",
      // Gradle heap. LiveKit's WebRTC pushes :app:mergeExtDexDebug past Expo's
      // default -Xmx2048m and D8 dies with an OutOfMemoryError that presents as
      // a DexArchiveMergerException. android/ is gitignored, so this can only
      // live in a plugin.
      "./plugins/withGradleJvmArgs",
      // LiveKit's webrtc manifest merges in an Android screen-capture service we
      // never start. enableScreenShareService:false does NOT remove it.
      "./plugins/withLiveKitManifestTrim",
      // targetSdk 36 turns Android 16 predictive back on by default, which stops
      // onBackPressed — and so React Native's BackHandler — ever firing: back
      // exits the app from any screen. See the plugin.
      "./plugins/withPredictiveBackOptOut",
      ["./plugins/withKotlinVersion", "2.2.0"],
      // GoogleSignIn iOS SDK (native Google sign-in) pulls Swift pod
      // AppCheckCore whose ObjC deps need module maps — see the plugin.
      "./plugins/withModularHeaders",
      "./plugins/withFmtConstevalFix",
      "./plugins/withBouncyCastleDedup",
      // Skip the Square plugin entirely if SQUARE_APP_ID_PRODUCTION is missing
      // — keeps `npx expo config` (used by EAS env commands) working before
      // the secret is registered. Builds without it will get a runtime error
      // when takeInAppPayment is called, not a config-eval crash.
      ...(SQUARE_APPLICATION_ID
        ? [["./plugins/withSquareSDK", { applicationId: SQUARE_APPLICATION_ID }]]
        : [])
    ],
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      // Must match the navy baked into the logo art (assets/logo-lrg-margin.png)
      // and the iOS SplashScreenBackground colorset — any other value draws a
      // visible square tile around the logo. Same colour is hardcoded in
      // src/components/SplashOverlay.tsx so the native→JS handoff is invisible.
      backgroundColor: "#1E293B"
    },
    assetBundlePatterns: [
      "**/*"
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.hansendev.quotemate",
      usesAppleSignIn: true,
      buildNumber: "94",
      // Universal Links. The path allow-list lives in
      // public/.well-known/apple-app-site-association (/join* and /ref/*).
      associatedDomains: ["applinks:quotemateapp.au"],
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSBluetoothAlwaysUsageDescription: "QuoteMate uses Bluetooth to pair Square card readers for in-person payments."
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon-new.png",
        backgroundColor: "#0A0E16"  // Dark blue-gray to match app theme
      },
      package: "com.quotemate.app",
      versionCode: 171,
      // Android 16 (targetSdk 36) enforces edge-to-edge and ignores the
      // opt-out flag. Declaring it here makes Expo theme for it deliberately
      // rather than emitting an opt-out Android no longer honours.
      edgeToEdgeEnabled: true,
      permissions: ["android.permission.RECORD_AUDIO", "android.permission.CAMERA", "android.permission.READ_CONTACTS"],
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            { scheme: "https", host: "quotemateapp.au", pathPrefix: "/join" },
            // Referral QR codes / shared links. Without this the link only ever
            // opened the website even with the app installed, and the tradie was
            // asked to retype the code by hand. Mirrors the /ref/* entry in
            // public/.well-known/apple-app-site-association (iOS) and the
            // `Referral: 'ref/:code'` route in App.tsx.
            { scheme: "https", host: "quotemateapp.au", pathPrefix: "/ref" }
          ],
          category: ["BROWSABLE", "DEFAULT"]
        },
        // expo-auth-session computes the Google OAuth redirect URI as
        // `${applicationId}:/oauthredirect` (com.quotemate.app:/oauthredirect).
        // Without this intent filter, Chrome has nothing to hand the redirect
        // to after Google sign-in, so the tab silently stalls on the web view.
        {
          action: "VIEW",
          data: [{ scheme: "com.quotemate.app" }],
          category: ["BROWSABLE", "DEFAULT"]
        }
      ]
    },
    experiments: {
      ...(isWebExport ? { baseUrl: isWebExport } : {}),
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    scheme: "quotemate",
    extra: {
      eas: {
        projectId: "b164d7f8-b04e-4960-a962-ebc74fe65bce"
      },
      squareApplicationId: SQUARE_APPLICATION_ID,
      // Public Google OAuth client IDs consumed by nativeGoogleSignIn.native.ts
      // via Constants.expoConfig.extra. Hardcoded fallbacks (mirroring
      // src/config/firebase.ts) because non-EXPO_PUBLIC env vars are not in the
      // EAS build context — so the correct value always bakes into the manifest.
      googleWebClientId: process.env.GOOGLE_OAUTH_WEB_CLIENT_ID
        || "652758863537-86a4q9860h9aalo36f4sb9tpt39ut7bs.apps.googleusercontent.com",
      googleIosClientId: process.env.GOOGLE_OAUTH_IOS_CLIENT_ID
        || "652758863537-isuaotmpo68rj5lirc40otkevmr8annf.apps.googleusercontent.com"
    }
  }
};
