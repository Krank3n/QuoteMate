/**
 * On web this must be a no-op that touches nothing native.
 *
 * Vitest runs under react-native-web, so Platform.OS is 'web' here and this
 * exercises exactly the path a browser takes: return immediately, never reach
 * the dynamic import. The package's own export conditions keep LiveKit out of
 * the web bundle; this keeps the side effect from running there at all.
 */
import { describe, it, expect } from 'vitest';
import { ensureElevenLabsRuntime } from '../elevenLabsRuntime';

describe('ensureElevenLabsRuntime on web', () => {
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
