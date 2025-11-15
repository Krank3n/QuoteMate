export default {
  expo: {
    name: "QuoteMate",
    slug: "quotemate",
    version: "1.0.20",
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
            buildToolsVersion: "35.0.0"
          },
          ios: {
            deploymentTarget: "15.1"
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
      bundleIdentifier: "com.quotemate.app",
      usesAppleSignIn: true
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon-new.png",
        backgroundColor: "#1E293B"  // Dark blue-gray to match app theme
      },
      package: "com.quotemate.app",
      versionCode: 28,
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
