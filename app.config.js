export default {
  expo: {
    name: "QuoteMate",
    slug: "quotemate",
    version: "1.0.1",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    newArchEnabled: true,
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
      bundleIdentifier: "com.quotemate.app"
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#009868"
      },
      package: "com.quotemate.app",
      versionCode: 2,
      targetSdkVersion: 35,
      permissions: []
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    scheme: "quotemate",
    extra: {
      eas: {
        projectId: "b164d7f8-b04e-4960-a962-ebc74fe65bce"
      },
      BUNNINGS_CLIENT_ID: process.env.BUNNINGS_CLIENT_ID,
      BUNNINGS_CLIENT_SECRET: process.env.BUNNINGS_CLIENT_SECRET,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    }
  }
};
