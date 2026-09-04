/**
 * Store review prompt.
 *
 * The quote-accept flow now awaits this behind the sticky bar's spinner and
 * branches on what it returns, so two properties matter: it reports honestly
 * whether the OS prompt was requested, and it never outlasts its time-box —
 * the Firestore read it starts with simply never settles offline, which would
 * leave a tradie staring at a spinner after their customer said yes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  /** Offline: the read is issued and never settles. */
  hangReads: false,
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return env.os;
    },
  },
}));

const storeReview = vi.hoisted(() => ({
  isAvailableAsync: vi.fn(async () => true),
  hasAction: vi.fn(async () => true),
  requestReview: vi.fn(async () => {}),
}));
vi.mock('expo-store-review', () => storeReview);

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => {
    if (env.hangReads) await new Promise(() => {});
    // One earlier happy moment, never prompted — every gate open.
    return { exists: () => true, data: () => ({ happyEvents: 1 }) };
  }),
  setDoc: vi.fn(async () => {}),
  serverTimestamp: vi.fn(() => 'server-ts'),
  increment: vi.fn((by: number) => ({ increment: by })),
}));

/** Fresh copy per test — the once-per-session guard is module-level state. */
async function loadService() {
  vi.resetModules();
  return (await import('./storeReviewService')).maybeRequestReview;
}

beforeEach(() => {
  vi.clearAllMocks();
  env.os = 'ios';
  env.hangReads = false;
});

describe('maybeRequestReview', () => {
  it('returns false on web, where there is no native review prompt', async () => {
    env.os = 'web';
    const maybeRequestReview = await loadService();

    await expect(maybeRequestReview('quote_accepted')).resolves.toBe(false);
    expect(storeReview.requestReview).not.toHaveBeenCalled();
  });

  it('returns true when the native prompt was invoked', async () => {
    const maybeRequestReview = await loadService();

    await expect(maybeRequestReview('quote_accepted')).resolves.toBe(true);
    expect(storeReview.requestReview).toHaveBeenCalledTimes(1);
  });

  it('returns false when the timeout wins, without waiting on the hung read', async () => {
    env.hangReads = true;
    const maybeRequestReview = await loadService();

    vi.useFakeTimers();
    try {
      const pending = maybeRequestReview('quote_accepted');
      await vi.advanceTimersByTimeAsync(2500);

      await expect(pending).resolves.toBe(false);
      expect(storeReview.requestReview).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
