/**
 * The web variant must stay a no-op that pulls in nothing native.
 *
 * The failure this guards is a build-time one: if @livekit/react-native ever
 * reaches the web bundle it breaks `expo export --platform web` outright, since
 * it has no browser build. Vitest runs under react-native-web and resolves the
 * .web variant through the alias in vitest.config.ts, so this test exercises
 * exactly the module the web bundle would get.
 */
import { describe, it, expect } from 'vitest';
import { ensureElevenLabsRuntime } from '../elevenLabsRuntime.web';

describe('ensureElevenLabsRuntime (web)', () => {
  it('resolves without loading any native module', async () => {
    await expect(ensureElevenLabsRuntime()).resolves.toBeUndefined();
  });

  it('is safe to call repeatedly, the way every voice open will', async () => {
    await Promise.all([
      ensureElevenLabsRuntime(),
      ensureElevenLabsRuntime(),
      ensureElevenLabsRuntime(),
    ]);
  });
});
