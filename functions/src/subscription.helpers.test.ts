import { describe, it, expect } from 'vitest';
import { isBilledSub, subEnvironment, deriveSubFields } from './subscription.helpers';

// Build a StoreKit 2-style JWS: header.payload.signature with base64url segments.
function jwsWith(payload: Record<string, any>): string {
  const b64url = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64url({ alg: 'ES256' })}.${b64url(payload)}.c2ln`;
}

describe('subEnvironment', () => {
  it('reads the environment from a StoreKit 2 JWS purchaseToken', () => {
    expect(subEnvironment({ purchaseToken: jwsWith({ environment: 'Sandbox' }) })).toBe('Sandbox');
    expect(subEnvironment({ purchaseToken: jwsWith({ environment: 'Production' }) })).toBe('Production');
  });

  it('prefers an explicit environment field over the token', () => {
    expect(
      subEnvironment({ environment: 'Production', purchaseToken: jwsWith({ environment: 'Sandbox' }) })
    ).toBe('Production');
  });

  it('returns null for legacy base64 receipts, malformed JWS, and missing tokens', () => {
    expect(subEnvironment({ purchaseToken: 'MIIEMTCCA7agAwIBAgIQR8' })).toBeNull();
    expect(subEnvironment({ purchaseToken: 'a.%%%not-base64-json%%%.c' })).toBeNull();
    expect(subEnvironment({ purchaseToken: jwsWith({ transactionId: '123' }) })).toBeNull();
    expect(subEnvironment({})).toBeNull();
    expect(subEnvironment(null)).toBeNull();
  });
});

describe('isBilledSub', () => {
  it('counts a pro sub backed by a store productId', () => {
    expect(isBilledSub({ isPro: true, platform: 'android', productId: 'quotemate_pro_yearly' })).toBe(true);
  });

  it('counts a pro sub backed by a Stripe subscriptionId or priceId', () => {
    expect(isBilledSub({ isPro: true, platform: 'web', subscriptionId: 'sub_123' })).toBe(true);
    expect(isBilledSub({ isPro: true, platform: 'web', priceId: 'price_123' })).toBe(true);
  });

  it('rejects non-pro, admin comps, and bare isPro flags without billing IDs', () => {
    expect(isBilledSub({ isPro: false, productId: 'quotemate_pro_yearly' })).toBe(false);
    expect(isBilledSub({ isPro: true, platform: 'admin_grant', productId: 'quotemate_pro_yearly' })).toBe(false);
    expect(isBilledSub({ isPro: true, platform: 'android' })).toBe(false);
    expect(isBilledSub(null)).toBe(false);
  });

  it('rejects App Store sandbox purchases even when they carry a productId', () => {
    const sandbox = {
      isPro: true,
      platform: 'ios',
      productId: 'quotemate_pro_yearly',
      purchaseToken: jwsWith({ environment: 'Sandbox', productId: 'quotemate_pro_yearly' }),
    };
    expect(isBilledSub(sandbox)).toBe(false);
  });

  it('rejects an explicit environment: Sandbox field (backfill override)', () => {
    expect(
      isBilledSub({ isPro: true, platform: 'ios', productId: 'quotemate_pro_yearly', environment: 'Sandbox' })
    ).toBe(false);
  });

  it('still counts production App Store purchases with a JWS token', () => {
    const production = {
      isPro: true,
      platform: 'ios',
      productId: 'quotemate_pro_yearly',
      purchaseToken: jwsWith({ environment: 'Production' }),
    };
    expect(isBilledSub(production)).toBe(true);
  });
});

describe('deriveSubFields billing rollup', () => {
  it('gives a sandbox sub pro tier but zero revenue', () => {
    const f = deriveSubFields({
      isPro: true,
      platform: 'ios',
      productId: 'quotemate_pro_yearly',
      purchaseToken: jwsWith({ environment: 'Sandbox' }),
    });
    expect(f.tier).toBe('pro');
    expect(f.billed).toBe(false);
    expect(f.interval).toBeNull();
    expect(f.monthlyAud).toBe(0);
  });

  it('gives a billed yearly sub the yearly monthly-equivalent revenue', () => {
    const f = deriveSubFields({ isPro: true, platform: 'android', productId: 'quotemate_pro_yearly' });
    expect(f.billed).toBe(true);
    expect(f.interval).toBe('yearly');
    expect(f.monthlyAud).toBeCloseTo(328 / 12, 1);
  });
});
