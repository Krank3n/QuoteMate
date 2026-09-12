/**
 * Sep 2026 money reconciliation: the nightly audit filed Apple App Review's
 * sandbox purchase under `bare_ispro` (it looks like a free-Pro leak, it is
 * not), and counted admin comps without ever listing one whose end date had
 * passed. Both now get a name of their own.
 */
import { describe, it, expect } from 'vitest';
import { classify } from './subscriptionAudit.helpers';

const NOW = Date.parse('2026-09-12T14:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('subscription audit classify', () => {
  it('names an App Store sandbox purchase `sandbox`, whatever the case of the environment field', () => {
    const review = { isPro: true, platform: 'ios', productId: 'quotemate_pro_monthly', environment: 'Sandbox' };
    expect(classify(review, NOW)).toBe('sandbox');
    expect(classify({ ...review, environment: 'SANDBOX' }, NOW)).toBe('sandbox');
    expect(classify({ ...review, environment: 'sandbox' }, NOW)).toBe('sandbox');
  });

  it('reads the environment out of a stored JWS token when the doc carries no environment field', () => {
    const payload = Buffer.from(JSON.stringify({ environment: 'Sandbox', productId: 'quotemate_pro_monthly' })).toString('base64url');
    const sub = { isPro: true, platform: 'ios', productId: 'quotemate_pro_monthly', purchaseToken: `h.${payload}.s` };
    expect(classify(sub, NOW)).toBe('sandbox');
  });

  it('a production purchase is billed, not an issue; a Pro doc with nothing behind it is still bare_ispro', () => {
    expect(classify({ isPro: true, platform: 'ios', productId: 'quotemate_pro_monthly', environment: 'Production' }, NOW)).toBeNull();
    expect(classify({ isPro: true }, NOW)).toBe('bare_ispro');
    expect(classify({ isPro: false, environment: 'Sandbox' }, NOW)).toBeNull();
  });

  it('lists an admin grant the night its end date passes, and keeps a current one off the list', () => {
    const grant = { isPro: true, platform: 'admin_grant' };
    expect(classify({ ...grant, currentPeriodEnd: new Date(NOW - DAY) }, NOW)).toBe('admin_grant_lapsed');
    // Firestore's serialised timestamp shape counts as an end date too.
    expect(classify({ ...grant, currentPeriodEnd: { _seconds: Math.floor((NOW - DAY) / 1000) } }, NOW)).toBe('admin_grant_lapsed');
    expect(classify({ ...grant, currentPeriodEnd: new Date(NOW + 30 * DAY) }, NOW)).toBeNull();
    // An open-ended comp has no lapse to report.
    expect(classify(grant, NOW)).toBeNull();
  });

  it('incident restores keep their existing reasons', () => {
    const restored = { isPro: true, restoredFromIncident: 'incident-2026-07' };
    expect(classify({ ...restored, platform: 'ios', incidentProUntil: new Date(NOW + DAY).toISOString() }, NOW)).toBe('restored_awaiting_receipt');
    expect(classify({ ...restored, platform: 'unknown', incidentProUntil: new Date(NOW - DAY).toISOString() }, NOW)).toBe('restored_expired');
    expect(classify({ ...restored, platform: 'unknown', incidentProUntil: new Date(NOW + DAY).toISOString() }, NOW)).toBe('restored_unknown_platform');
  });
});
