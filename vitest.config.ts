import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'shared/**/*.test.ts',
      'functions/scripts/**/*.test.ts',
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
    ],
  },
});
