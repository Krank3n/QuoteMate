import { defineConfig } from 'vitest/config';

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
});
