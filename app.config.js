export default {
  expo: {
    name: "QuoteMate",
    slug: "quotemate",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    newArchEnabled: true,
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#008542"
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
        backgroundColor: "#008542"
      },
      package: "com.quotemate.app"
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    scheme: "quotemate",
    extra: {
      BUNNINGS_CLIENT_ID: process.env.BUNNINGS_CLIENT_ID,
      BUNNINGS_CLIENT_SECRET: process.env.BUNNINGS_CLIENT_SECRET,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    }
  }
};
