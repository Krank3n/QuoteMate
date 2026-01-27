export default {
  expo: {
    name: "QuoteMate",
    slug: "quotemate",
    version: "1.0.41",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    newArchEnabled: true,
    plugins: [
      [
        "expo-build-properties",
        {
          android: {
            compileSdkVersion: 35,
            targetSdkVersion: 35,
            buildToolsVersion: "35.0.0",
            useLegacyPackaging: false
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
      ]
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
      buildNumber: "10"
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon-new.png",
        backgroundColor: "#1E293B"  // Dark blue-gray to match app theme
      },
      package: "com.quotemate.app",
      versionCode: 49,
      permissions: ["android.permission.RECORD_AUDIO"],
      blockedPermissions: ["android.permission.CAMERA"]
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
