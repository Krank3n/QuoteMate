const isWebExport = process.env.EXPO_WEB_BASE_URL;

export default {
  expo: {
    name: "QuoteMate",
    slug: "quotemate",
    version: "1.0.64",
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
          photosPermission: "QuoteMate needs access to your photo library so you can select a company logo to display on your PDF quotes and invoices. For example, you can upload your business logo to appear in the header of every quote you generate.",
          cameraPermission: "QuoteMate needs access to your camera so you can take a photo to use as your company logo on PDF quotes and invoices."
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
      versionCode: 74,
      permissions: ["android.permission.RECORD_AUDIO"],
      blockedPermissions: ["android.permission.CAMERA"]
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
