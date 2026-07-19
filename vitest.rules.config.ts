import { defineConfig } from 'vitest/config';

// Security-rules tests need the Firestore emulator, so they run via
// `npm run test:rules` (firebase emulators:exec) instead of the default
// vitest config — which deliberately does not include this file.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['firestore.rules.test.ts'],
    // The emulator serialises rule evaluation; keep a single worker.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
