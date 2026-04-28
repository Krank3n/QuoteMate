const isWebExport = process.env.EXPO_WEB_BASE_URL;

// Square Mobile Payments SDK requires the production application ID baked
// into native init. Read from .env (loaded by Expo at config eval time).
const SQUARE_APPLICATION_ID =
  process.env.SQUARE_APP_ID_PRODUCTION || process.env.SQUARE_APP_ID || '';

export default {
  expo: {
    name: "QuoteMate",
    slug: "quotemate",
    version: "1.30",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    newArchEnabled: true,
    plugins: [
      [
        "expo-build-properties",
        {
          android: {
            minSdkVersion: 28,
            compileSdkVersion: 35,
            targetSdkVersion: 35,
            buildToolsVersion: "35.0.0",
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
      "expo-apple-authentication",
      [
        "expo-speech-recognition",
        {
          microphonePermission: "Allow QuoteMate to use your microphone for voice-to-text job descriptions.",
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
      ["./plugins/withKotlinVersion", "2.2.0"],
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
      backgroundColor: "#1E293B"
    },
    assetBundlePatterns: [
      "**/*"
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.hansendev.quotemate",
      usesAppleSignIn: true,
      buildNumber: "17",
      associatedDomains: ["applinks:quotemateapp.au"],
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSBluetoothAlwaysUsageDescription: "QuoteMate uses Bluetooth to pair Square card readers for in-person payments."
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon-new.png",
        backgroundColor: "#1E293B"  // Dark blue-gray to match app theme
      },
      package: "com.quotemate.app",
      versionCode: 93,
      permissions: ["android.permission.RECORD_AUDIO", "android.permission.CAMERA", "android.permission.READ_CONTACTS"],
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [{ scheme: "https", host: "quotemateapp.au", pathPrefix: "/join" }],
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
      squareApplicationId: SQUARE_APPLICATION_ID
    }
  }
};
