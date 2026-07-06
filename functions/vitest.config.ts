import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // src/shared is a symlink to the repo-root shared/ package, which has its
    // own test setup — don't run those here.
    exclude: ['**/node_modules/**', 'src/shared/**'],
    environment: 'node',
  },
});
