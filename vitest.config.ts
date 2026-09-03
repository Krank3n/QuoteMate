import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // Metro injects the __DEV__ global; store-graph modules reference it.
  define: { __DEV__: 'false' },
  test: {
    globals: true,
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'shared/**/*.test.ts',
      'functions/scripts/**/*.test.ts',
      'plugins/**/*.test.ts',
      // Local Expo native modules live outside src/ but their JS wrappers carry
      // real branching (availability, error-code mapping) worth covering.
      'modules/**/*.test.ts',
    ],
    exclude: ['node_modules', 'functions/node_modules', 'android', 'ios', 'dist', 'dist-web', 'build'],
  },
  resolve: {
    alias: [
      // config/firebase initialises the React Native Firebase SDK (RN/Expo
      // native deps, auth persistence) at import time, which can't run under
      // vitest. Modules with pure, testable logic (e.g. assistant/readTools)
      // import it at the top level, so alias it to an inert stub. Tests that
      // need Firestore should mock it explicitly.
      { find: /^.*\/config\/firebase$/, replacement: resolve(__dirname, 'src/test/stubs/firebase.ts') },
      // Component tests render React Native components under jsdom via
      // react-native-web (the same mapping the Expo web build uses). The
      // react-native package itself ships Flow syntax vitest can't parse.
      { find: /^react-native$/, replacement: 'react-native-web' },
      // @env is a react-native-dotenv babel virtual module — only exists in
      // the Metro build. Stub the keys so store-graph imports resolve.
      { find: /^@env$/, replacement: resolve(__dirname, 'src/test/stubs/env.ts') },
      // Font files. Metro turns require('...ttf') into an asset-registry
      // number; vite tries to parse the binary as JS and throws. Stubbing the
      // extension keeps the font map in src/theme/typography.ts as one source
      // of truth instead of a test-safe copy alongside a runtime copy.
      { find: /^.*\.ttf$/, replacement: resolve(__dirname, 'src/test/stubs/fontAsset.ts') },
      // Image files, same story as the fonts above (SplashOverlay requires
      // the splash logo PNG).
      { find: /^.*\.png$/, replacement: resolve(__dirname, 'src/test/stubs/imageAsset.ts') },
      // expo-notifications is ESM-only internally ('./ImportMetaRegistry') and
      // vite cannot resolve it under jsdom. tapToPayOutcomeNotice imports it
      // statically for Apple req 5.12, which drags it into TakePaymentSheet's
      // graph and every suite that renders one.
      {
        find: /^expo-notifications$/,
        replacement: resolve(__dirname, 'src/test/stubs/expoNotifications.ts'),
      },
      // nativeGoogleSignIn ships only platform variants (.native.ts/.web.ts),
      // which Metro resolves but vite cannot. Tests run under react-native-web,
      // so point at the web stub — it's native-dependency-free by design.
      {
        find: /^(.*\/)?services\/nativeGoogleSignIn$/,
        replacement: resolve(__dirname, 'src/services/nativeGoogleSignIn.web.ts'),
      },
    ],
  },
});
