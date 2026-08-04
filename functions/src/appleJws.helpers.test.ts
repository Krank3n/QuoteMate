import { describe, it, expect } from 'vitest';
import { verifyAppleJws, peekJwsEnvironment } from './appleJws.helpers';

/**
 * These deliberately contain no real purchase tokens — a genuine StoreKit JWS
 * is customer billing data. The security property under test is the one that
 * matters: nothing reaches 'valid' unless Apple actually signed it, and our own
 * inability to reach a verdict never hard-rejects a buyer's purchase.
 */

function fakeJws(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', x5c: ['ZmFrZQ=='] })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.${Buffer.from('not-a-real-signature').toString('base64url')}`;
}

describe('peekJwsEnvironment', () => {
  it('reads the declared environment from a JWS-shaped token', () => {
    expect(peekJwsEnvironment(fakeJws({ environment: 'Production' }))).toBe('Production');
    expect(peekJwsEnvironment(fakeJws({ environment: 'Sandbox' }))).toBe('Sandbox');
  });

  it('returns null for anything that is not three dot-separated parts', () => {
    expect(peekJwsEnvironment('MIIT9wYJKoZIhvcNAQcCoIIT6DCCE')).toBeNull();
    expect(peekJwsEnvironment('a.b')).toBeNull();
    expect(peekJwsEnvironment('')).toBeNull();
  });

  it('returns null when the payload is not decodable JSON', () => {
    expect(peekJwsEnvironment('aaa.!!!not-base64!!!.ccc')).toBeNull();
  });
});

describe('verifyAppleJws', () => {
  it('reports no_token for missing or non-string input', async () => {
    for (const bad of [null, undefined, '', 123, {}]) {
      const r = await verifyAppleJws(bad as unknown);
      expect(r.outcome).toBe('unavailable');
      expect(r.detail).toBe('no_token');
    }
  });

  it('treats a legacy base64 receipt as unavailable, not invalid', async () => {
    // An older client build can still send the legacy app receipt. We cannot
    // verify it, but rejecting it terminally would burn a real purchase.
    const r = await verifyAppleJws('MIIT9wYJKoZIhvcNAQcCoIIT6DCCE+QCAQExCzAJBgUrDgMCGgUAMIID');
    expect(r.outcome).toBe('unavailable');
    expect(r.detail).toBe('not_jws');
    expect(r.expiryDate).toBeNull();
  });

  it('rejects a JWS that Apple did not sign', async () => {
    const r = await verifyAppleJws(fakeJws({
      environment: 'Production',
      bundleId: 'com.hansendev.quotemate',
      productId: 'quotemate_pro_yearly',
      expiresDate: Date.now() + 365 * 24 * 3600 * 1000,
    }));
    expect(r.outcome).toBe('invalid');
    expect(r.outcome).not.toBe('valid');
  });

  it('does not grant on a forged far-future expiry', async () => {
    const r = await verifyAppleJws(fakeJws({
      environment: 'Production',
      bundleId: 'com.hansendev.quotemate',
      productId: 'quotemate_pro_yearly',
      expiresDate: Date.now() + 100 * 365 * 24 * 3600 * 1000,
    }));
    expect(r.outcome).not.toBe('valid');
    expect(r.expiryDate).toBeNull();
  });

  it('rejects a sandbox-declared token that is not genuinely signed', async () => {
    const r = await verifyAppleJws(fakeJws({
      environment: 'Sandbox',
      bundleId: 'com.hansendev.quotemate',
      productId: 'quotemate_pro_monthly',
      expiresDate: Date.now() + 30 * 24 * 3600 * 1000,
    }));
    expect(r.outcome).toBe('invalid');
  });

  it('never returns an expiry date alongside a non-valid outcome', async () => {
    for (const input of ['', 'legacy-receipt', fakeJws({ environment: 'Production' })]) {
      const r = await verifyAppleJws(input);
      if (r.outcome !== 'valid') expect(r.expiryDate).toBeNull();
    }
  });
});
