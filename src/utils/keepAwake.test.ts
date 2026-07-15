import { describe, it, expect, vi, beforeEach } from 'vitest';
import { releaseKeepAwake } from './keepAwake';

const mocks = vi.hoisted(() => ({
  deactivateKeepAwake: vi.fn<(tag?: string) => Promise<void>>(async () => {}),
}));

vi.mock('expo-keep-awake', () => mocks);

// Flush enough turns of the event loop for Node to report any unhandled
// rejection produced by the call under test.
async function flush() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('releaseKeepAwake', () => {
  beforeEach(() => {
    mocks.deactivateKeepAwake.mockReset();
    mocks.deactivateKeepAwake.mockImplementation(async () => {});
  });

  it('releases the lock for the given tag', () => {
    releaseKeepAwake('mate-voice-session');
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledExactlyOnceWith('mate-voice-session');
  });

  // Regression: Sentry REACT-NATIVE-2. On web, deactivateKeepAwake rejects
  // ("The wake lock with tag ... has not activated yet") when activation
  // failed earlier; the rejection must not escape as unhandled.
  it('swallows the rejection when the tag was never activated (web)', async () => {
    mocks.deactivateKeepAwake.mockRejectedValueOnce(
      new Error('The wake lock with tag mate-voice-session has not activated yet'),
    );
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      expect(() => releaseKeepAwake('mate-voice-session')).not.toThrow();
      await flush();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it('swallows a synchronous throw from deactivate', () => {
    mocks.deactivateKeepAwake.mockImplementationOnce(() => {
      throw new Error('release failed');
    });
    expect(() => releaseKeepAwake('materials-pipeline')).not.toThrow();
  });
});
