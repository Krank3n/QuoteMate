import { describe, it, expect } from 'vitest';
import { authRejectionLog, bearerToken, invalidTokenRejection } from './authRejection.helpers';

describe('bearerToken', () => {
  it('reads a bearer token', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toEqual({ ok: true, token: 'abc.def.ghi' });
  });

  it('names the reason there is none', () => {
    expect(bearerToken(undefined)).toEqual({ ok: false, rejection: { reason: 'missing-header' } });
    expect(bearerToken('')).toEqual({ ok: false, rejection: { reason: 'missing-header' } });
    expect(bearerToken('Basic abc')).toEqual({ ok: false, rejection: { reason: 'bad-scheme' } });
    expect(bearerToken('Bearer ')).toEqual({ ok: false, rejection: { reason: 'empty-token' } });
    expect(bearerToken('Bearer undefined')).toEqual({ ok: false, rejection: { reason: 'empty-token' } });
    expect(bearerToken('Bearer null')).toEqual({ ok: false, rejection: { reason: 'empty-token' } });
  });
});

describe('invalidTokenRejection', () => {
  it('keeps firebase-admin\'s code and nothing else', () => {
    expect(invalidTokenRejection({ code: 'auth/id-token-expired', message: 'x' })).toEqual({ reason: 'invalid-token', code: 'auth/id-token-expired' });
    expect(invalidTokenRejection(new Error('boom'))).toEqual({ reason: 'invalid-token' });
    expect(invalidTokenRejection(undefined)).toEqual({ reason: 'invalid-token' });
  });
});

describe('authRejectionLog', () => {
  it('records the endpoint, the reason and what the client said it was — never the token', () => {
    const line = authRejectionLog(
      {
        path: '/updateActivityTimestamp',
        headers: { authorization: 'Bearer secret-token-value', 'user-agent': 'okhttp/4.12.0', origin: 'https://quotemateapp.au' },
        body: { appVersion: '1.58', appPlatform: 'android', supportsReturnTrial: true },
      },
      { reason: 'invalid-token', code: 'auth/id-token-expired' },
    );
    expect(line).toEqual({
      endpoint: '/updateActivityTimestamp',
      reason: 'invalid-token',
      code: 'auth/id-token-expired',
      userAgent: 'okhttp/4.12.0',
      origin: 'https://quotemateapp.au',
      appVersion: '1.58',
      appPlatform: 'android',
      tokenLength: 'secret-token-value'.length,
    });
    expect(JSON.stringify(line)).not.toContain('secret-token-value');
  });

  it('tolerates a bare request', () => {
    expect(authRejectionLog({}, { reason: 'missing-header' })).toEqual({
      endpoint: '/',
      reason: 'missing-header',
      userAgent: null,
      origin: null,
      appVersion: null,
      appPlatform: null,
      tokenLength: 0,
    });
  });
});
