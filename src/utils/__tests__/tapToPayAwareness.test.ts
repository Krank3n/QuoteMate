/**
 * Apple reqs 3.1 / 3.3 — the awareness moment.
 *
 * Two opposite mistakes are easy here. Show it too eagerly and a tradie is
 * pitched a feature their phone cannot run, or one that dead-ends because
 * Square is not connected. Retire it too eagerly and the requirement to reach
 * every eligible merchant at least once quietly stops being met.
 *
 * The naming assertions are not pedantry: the Developer Marketing Guidelines
 * forbid shortening the name or pairing it with "Apple", and this string is the
 * most visible use of it in the app.
 */
import { describe, it, expect } from 'vitest';

import {
  shouldShowTapToPayAwareness,
  TAP_TO_PAY_AWARENESS_COPY,
  type TapToPayAwarenessInput,
} from '../tapToPayAwareness';

const eligible: TapToPayAwarenessInput = {
  platformOS: 'ios',
  tapToPayEnabled: true,
  squareConnected: true,
  termsAccepted: false,
  dismissedAt: null,
};

describe('shouldShowTapToPayAwareness', () => {
  it('shows for an eligible iPhone merchant who has not enabled it', () => {
    expect(shouldShowTapToPayAwareness(eligible)).toBe(true);
  });

  it('never shows on Android — that reader is Square\'s, not Apple\'s', () => {
    expect(
      shouldShowTapToPayAwareness({ ...eligible, platformOS: 'android' }),
    ).toBe(false);
  });

  it('never shows on web', () => {
    expect(shouldShowTapToPayAwareness({ ...eligible, platformOS: 'web' })).toBe(
      false,
    );
  });

  it('stays silent on a phone that cannot run it', () => {
    expect(
      shouldShowTapToPayAwareness({ ...eligible, tapToPayEnabled: false }),
    ).toBe(false);
  });

  it('stays silent until Square is connected, so the CTA cannot dead-end', () => {
    expect(
      shouldShowTapToPayAwareness({ ...eligible, squareConnected: false }),
    ).toBe(false);
  });

  it('retires once the merchant has accepted Apple\'s terms', () => {
    expect(
      shouldShowTapToPayAwareness({ ...eligible, termsAccepted: true }),
    ).toBe(false);
  });

  it('honours a dismissal for good', () => {
    expect(
      shouldShowTapToPayAwareness({ ...eligible, dismissedAt: 1_700_000_000 }),
    ).toBe(false);
  });

  it('treats a dismissal at epoch 0 as a real dismissal, not a missing one', () => {
    // A falsy-vs-null slip here would resurrect the banner for anyone whose
    // stored timestamp is 0.
    expect(shouldShowTapToPayAwareness({ ...eligible, dismissedAt: 0 })).toBe(
      false,
    );
  });
});

describe('the copy', () => {
  it('uses Apple\'s full name, never shortened', () => {
    expect(TAP_TO_PAY_AWARENESS_COPY.title).toBe('Tap to Pay on iPhone');
  });

  it('never pairs the name with "Apple"', () => {
    const all = Object.values(TAP_TO_PAY_AWARENESS_COPY).join(' ');
    expect(all).not.toMatch(/Apple\s+Tap to Pay/i);
  });

  it('never abbreviates it anywhere', () => {
    const all = Object.values(TAP_TO_PAY_AWARENESS_COPY).join(' ');
    // Every mention of "Tap to Pay" must carry "on iPhone".
    const mentions = all.match(/Tap to Pay(?! on iPhone)/g) ?? [];
    expect(mentions).toEqual([]);
  });

  it('says what the tradie gets, not what the technology is', () => {
    expect(TAP_TO_PAY_AWARENESS_COPY.body).toMatch(/card payments/i);
  });
});
