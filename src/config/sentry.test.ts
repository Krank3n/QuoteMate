/**
 * Crash reporting must be inert until it's actually configured: an empty
 * DSN (forks, CI, pre-setup builds) or a dev build must neither call
 * Sentry.init nor wrap the root component — the app has to behave exactly
 * as it did before Sentry existed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { init, wrap } = vi.hoisted(() => ({
  init: vi.fn(),
  wrap: vi.fn((c: unknown) => c),
}));
vi.mock('@sentry/react-native', () => ({ init, wrap }));

import { initSentry, wrapRootComponent, shouldEnableSentry, SENTRY_DSN } from './sentry';

describe('shouldEnableSentry', () => {
  it('is off with no DSN', () => {
    expect(shouldEnableSentry('', false)).toBe(false);
    expect(shouldEnableSentry('', true)).toBe(false);
  });

  it('is off in dev even with a DSN', () => {
    expect(shouldEnableSentry('https://abc@o1.ingest.sentry.io/1', true)).toBe(false);
  });

  it('is on with a DSN in a release build', () => {
    expect(shouldEnableSentry('https://abc@o1.ingest.sentry.io/1', false)).toBe(true);
  });
});

describe('unconfigured builds (current committed state)', () => {
  beforeEach(() => {
    init.mockClear();
    wrap.mockClear();
  });

  it('initSentry is a no-op while the DSN is unset', () => {
    // Guards the committed default: until a real DSN lands in sentry.ts,
    // nothing may touch the Sentry SDK at startup.
    if (SENTRY_DSN === '') {
      initSentry();
      expect(init).not.toHaveBeenCalled();
    } else {
      initSentry();
      expect(init).toHaveBeenCalledWith(expect.objectContaining({ dsn: SENTRY_DSN }));
    }
  });

  it('wrapRootComponent passes the component through untouched when disabled', () => {
    const Component = () => null;
    if (SENTRY_DSN === '') {
      expect(wrapRootComponent(Component)).toBe(Component);
      expect(wrap).not.toHaveBeenCalled();
    } else {
      wrapRootComponent(Component);
      expect(wrap).toHaveBeenCalledWith(Component);
    }
  });
});
