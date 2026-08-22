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

import {
  initSentry,
  wrapRootComponent,
  shouldEnableSentry,
  SENTRY_DSN,
  SENTRY_IGNORE_ERRORS,
} from './sentry';

const matchesIgnoreList = (message: string): boolean =>
  SENTRY_IGNORE_ERRORS.some((p) =>
    typeof p === 'string' ? message.includes(p) : p.test(message),
  );

describe('SENTRY_IGNORE_ERRORS', () => {
  it('filters the exact react-native-web pointer-capture messages seen in production (REACT-NATIVE-5)', () => {
    expect(
      matchesIgnoreList(
        "Failed to execute 'setPointerCapture' on 'Element': No active pointer with the given id is found.",
      ),
    ).toBe(true);
    expect(
      matchesIgnoreList(
        "Failed to execute 'releasePointerCapture' on 'Element': No active pointer with the given id is found.",
      ),
    ).toBe(true);
  });

  it('does not swallow other NotFoundErrors or unrelated crashes', () => {
    expect(matchesIgnoreList('NotFoundError: The object can not be found here.')).toBe(false);
    expect(
      matchesIgnoreList("TypeError: Cannot read properties of undefined (reading 'routes')"),
    ).toBe(false);
  });

  it('filters the Firebase Auth IndexedDB teardown race seen on the web build', () => {
    // Exact production Sentry message (oi._openDb / initializeCurrentUser).
    expect(matchesIgnoreList('Database is closing/hidden')).toBe(true);
    expect(matchesIgnoreList('Error: Database is closing')).toBe(true);
  });

  it('does not swallow real IndexedDB failures that indicate a genuine bug', () => {
    expect(matchesIgnoreList('IndexedDB write failed: QuotaExceededError')).toBe(false);
    expect(matchesIgnoreList('Database deleted by request of the user')).toBe(false);
    expect(matchesIgnoreList('The database connection is closing')).toBe(false);
    expect(matchesIgnoreList('FirebaseError: Missing or insufficient permissions.')).toBe(false);
    expect(matchesIgnoreList('UnknownError: Internal error opening backing store.')).toBe(false);
  });

  it('is passed to Sentry.init in enabled builds', () => {
    init.mockClear();
    initSentry();
    if (SENTRY_DSN !== '') {
      expect(init).toHaveBeenCalledWith(
        expect.objectContaining({ ignoreErrors: SENTRY_IGNORE_ERRORS }),
      );
    } else {
      expect(init).not.toHaveBeenCalled();
    }
  });
});

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
