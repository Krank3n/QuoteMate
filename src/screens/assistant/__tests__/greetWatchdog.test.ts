// The greet watchdog exists because the session right after a mic-permission
// grant twice connected and never greeted — dead air as the app's first voice
// impression. These cases pin when a re-send fires and, as importantly, the
// three ways it must NOT.

import { describe, it, expect } from 'vitest';
import { GREET_RETRY_MS, shouldRetryGreet } from '../greetWatchdog';

describe('shouldRetryGreet', () => {
  it('re-sends when the session is up and nothing has been heard', () => {
    expect(
      shouldRetryGreet({ sessionAlive: true, greetHeard: false, alreadyRetried: false }),
    ).toBe(true);
  });

  it('stays quiet once a greeting has rendered', () => {
    expect(
      shouldRetryGreet({ sessionAlive: true, greetHeard: true, alreadyRetried: false }),
    ).toBe(false);
  });

  it('never fires into a dead or replaced session', () => {
    // A retry aimed at the NEXT session would double-greet it.
    expect(
      shouldRetryGreet({ sessionAlive: false, greetHeard: false, alreadyRetried: false }),
    ).toBe(false);
  });

  it('retries at most once — two eaten greets is not a retry problem', () => {
    expect(
      shouldRetryGreet({ sessionAlive: true, greetHeard: false, alreadyRetried: true }),
    ).toBe(false);
  });

  it('waits long enough for a slow first token, not long enough to lose the tradie', () => {
    expect(GREET_RETRY_MS).toBeGreaterThanOrEqual(5000);
    expect(GREET_RETRY_MS).toBeLessThanOrEqual(12000);
  });
});
