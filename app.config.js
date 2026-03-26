const isWebExport = process.env.EXPO_WEB_BASE_URL;

export default {
  expo: {
    name: "QuoteMate",
    slug: "quotemate",
    version: "1.0.72",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    newArchEnabled: true,
    plugins: [
      "expo-router",
      [
        "expo-build-properties",
        {
          android: {
            compileSdkVersion: 35,
            targetSdkVersion: 35,
            buildToolsVersion: "35.0.0",
            ndkVersion: "28.0.12433566",
            useLegacyPackaging: false,
            enablePageAlignedLibraries: true,
            kotlinVersion: "2.2.0"
          },
          ios: {
            deploymentTarget: "15.2"
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
      ["./plugins/withKotlinVersion", "2.2.0"]
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
      buildNumber: "17"
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon-new.png",
        backgroundColor: "#1E293B"  // Dark blue-gray to match app theme
      },
      package: "com.quotemate.app",
      versionCode: 81,
      permissions: ["android.permission.RECORD_AUDIO", "android.permission.CAMERA", "android.permission.READ_CONTACTS"]
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
      }
    }
  }
};
