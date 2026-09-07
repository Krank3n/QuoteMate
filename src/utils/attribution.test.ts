import { describe, expect, it } from 'vitest';
import {
  parseAttributionParams,
  buildAttributionDoc,
  parseStoredAttribution,
  parseAcquisitionContext,
  classifyAcquisition,
  isGenuinelyNewAccount,
  acquisitionFitsAccount,
  buildAcquisitionRecord,
  type AcquisitionContext,
} from './attribution';

describe('parseAttributionParams', () => {
  it('extracts utm params and fbclid from a full ad-click query string', () => {
    const result = parseAttributionParams(
      '?utm_source=facebook&utm_medium=paid&utm_campaign=qm-launch&utm_content=qm-b1-news&fbclid=IwAR123',
    );
    expect(result).toEqual({
      utm_source: 'facebook',
      utm_medium: 'paid',
      utm_campaign: 'qm-launch',
      utm_content: 'qm-b1-news',
      fbclid: 'IwAR123',
    });
  });

  it('returns null for an organic session (no attribution params)', () => {
    expect(parseAttributionParams('?ref=footer&page=2')).toBeNull();
  });

  it('returns null for empty, undefined, and bare-question-mark input', () => {
    expect(parseAttributionParams('')).toBeNull();
    expect(parseAttributionParams(undefined)).toBeNull();
    expect(parseAttributionParams('?')).toBeNull();
  });

  it('accepts a query string without the leading question mark', () => {
    expect(parseAttributionParams('utm_source=facebook')).toEqual({ utm_source: 'facebook' });
  });

  it('ignores unknown params and keeps only the allow-listed keys', () => {
    const result = parseAttributionParams('?utm_source=fb&evil=<script>&utm_nope=x');
    expect(result).toEqual({ utm_source: 'fb' });
  });

  it('caps values at 200 chars (URLs are attacker-controlled input)', () => {
    const long = 'x'.repeat(500);
    const result = parseAttributionParams(`?utm_content=${long}`);
    expect(result!.utm_content).toHaveLength(200);
  });

  it('drops whitespace-only values rather than storing junk', () => {
    expect(parseAttributionParams('?utm_source=%20%20')).toBeNull();
  });

  it('captures gclid so the same pipe serves future Google campaigns', () => {
    expect(parseAttributionParams('?gclid=abc')).toEqual({ gclid: 'abc' });
  });
});

describe('buildAttributionDoc', () => {
  it('stamps landedAt as ISO and marks the platform', () => {
    const doc = buildAttributionDoc({ utm_source: 'facebook' }, new Date('2026-07-26T03:00:00Z'));
    expect(doc).toEqual({
      utm_source: 'facebook',
      landedAt: '2026-07-26T03:00:00.000Z',
      capturedOn: 'web',
    });
  });
});

describe('parseStoredAttribution', () => {
  it('round-trips a payload produced by buildAttributionDoc', () => {
    const doc = buildAttributionDoc(
      { utm_source: 'facebook', utm_content: 'qm-a1' },
      new Date('2026-07-26T03:00:00Z'),
    );
    expect(parseStoredAttribution(JSON.stringify(doc))).toEqual(doc);
  });

  it('returns null for junk JSON, non-objects, and payloads without known params', () => {
    expect(parseStoredAttribution('not-json')).toBeNull();
    expect(parseStoredAttribution('42')).toBeNull();
    expect(parseStoredAttribution(JSON.stringify({ irrelevant: true }))).toBeNull();
    expect(parseStoredAttribution(null)).toBeNull();
  });

  it('defaults landedAt to epoch when the stored value is missing or malformed', () => {
    const parsed = parseStoredAttribution(JSON.stringify({ utm_source: 'facebook', landedAt: 7 }));
    expect(parsed!.landedAt).toBe(new Date(0).toISOString());
  });
});

describe('parseAcquisitionContext (untrusted browser input)', () => {
  const valid = {
    source: 'google',
    medium: 'organic',
    landingPage: '/articles/how-to-quote-concrete-driveway',
    referrerHost: 'www.google.com',
    landedAt: '2026-09-07T01:00:00.000Z',
  };

  it('accepts exactly the record the marketing site writes', () => {
    expect(parseAcquisitionContext(JSON.stringify(valid))).toEqual(valid);
  });

  it('drops extra fields rather than forwarding them to Firestore', () => {
    const parsed = parseAcquisitionContext(
      JSON.stringify({ ...valid, isAdmin: true, note: 'x'.repeat(50) }),
    );
    expect(parsed).toEqual(valid);
    expect(Object.keys(parsed!).sort()).toEqual(
      ['landedAt', 'landingPage', 'medium', 'referrerHost', 'source'],
    );
  });

  it('rejects junk, non-objects, arrays and oversized payloads', () => {
    expect(parseAcquisitionContext('not-json')).toBeNull();
    expect(parseAcquisitionContext('42')).toBeNull();
    expect(parseAcquisitionContext('null')).toBeNull();
    expect(parseAcquisitionContext(JSON.stringify([valid]))).toBeNull();
    expect(parseAcquisitionContext(null)).toBeNull();
    expect(parseAcquisitionContext(undefined)).toBeNull();
    expect(parseAcquisitionContext(JSON.stringify({ ...valid, source: 'x'.repeat(4000) }))).toBeNull();
  });

  it('rejects a record with any field missing or of the wrong type', () => {
    for (const key of ['source', 'medium', 'landingPage', 'referrerHost', 'landedAt']) {
      const { [key]: _dropped, ...rest } = valid as Record<string, string>;
      expect(parseAcquisitionContext(JSON.stringify(rest))).toBeNull();
      expect(parseAcquisitionContext(JSON.stringify({ ...valid, [key]: 7 }))).toBeNull();
    }
  });

  it('refuses to record a private, authenticated or customer-facing URL', () => {
    for (const landingPage of ['/app', '/app/quotes', '/admin', '/admin/users', '/portal/x', '/q/abc123', '/join/x', '/api/v1']) {
      expect(parseAcquisitionContext(JSON.stringify({ ...valid, landingPage }))).toBeNull();
    }
  });

  it('refuses landing pages that are not plain relative paths', () => {
    for (const landingPage of [
      'https://evil.test/x',
      '//evil.test',
      '/x?token=secret',
      '/x#frag',
      'articles/x',
      `/${'a'.repeat(300)}`,
    ]) {
      expect(parseAcquisitionContext(JSON.stringify({ ...valid, landingPage }))).toBeNull();
    }
  });

  it('rejects an unusable landedAt', () => {
    expect(parseAcquisitionContext(JSON.stringify({ ...valid, landedAt: 'whenever' }))).toBeNull();
  });

  it('allows a blank referrerHost but not a malformed one', () => {
    expect(parseAcquisitionContext(JSON.stringify({ ...valid, referrerHost: '' }))!.referrerHost).toBe('');
    expect(parseAcquisitionContext(JSON.stringify({ ...valid, referrerHost: 'a b/c' }))).toBeNull();
  });
});

describe('classifyAcquisition', () => {
  const ctx = (source: string, medium: string): AcquisitionContext => ({
    source,
    medium,
    landingPage: '/pricing',
    referrerHost: '',
    landedAt: '2026-09-07T01:00:00.000Z',
  });

  it('calls a recognised search referral organic search', () => {
    expect(classifyAcquisition(ctx('google', 'organic'))).toBe('organic_search');
    expect(classifyAcquisition(ctx('bing', 'ORGANIC'))).toBe('organic_search');
  });

  it('calls paid mediums paid, not organic', () => {
    for (const medium of ['cpc', 'ppc', 'paid', 'paidsocial', 'paid_social', 'display']) {
      expect(classifyAcquisition(ctx('facebook', medium))).toBe('paid');
    }
  });

  it('separates referral and direct', () => {
    expect(classifyAcquisition(ctx('flyingsolo.com.au', 'referral'))).toBe('referral');
    expect(classifyAcquisition(ctx('(direct)', '(none)'))).toBe('direct');
  });

  it('never guesses organic for an internal or unrecognised first touch', () => {
    // The site records internal navigation as (unknown)/(not set); calling
    // that organic is exactly the mislabelling this whole change exists to
    // stop.
    expect(classifyAcquisition(ctx('(unknown)', '(not set)'))).toBe('unknown');
    expect(classifyAcquisition(ctx('somewhere', 'email'))).toBe('unknown');
    expect(classifyAcquisition(ctx('somewhere', ''))).toBe('unknown');
    expect(classifyAcquisition(ctx('(direct)', 'referral'))).toBe('referral');
  });
});

describe('isGenuinelyNewAccount', () => {
  const now = Date.parse('2026-09-07T02:00:00.000Z');

  it('accepts an account created moments ago', () => {
    expect(isGenuinelyNewAccount('2026-09-07T01:59:00.000Z', now)).toBe(true);
    expect(isGenuinelyNewAccount(now - 1000, now)).toBe(true);
  });

  it('rejects a returning user whose account predates the window', () => {
    expect(isGenuinelyNewAccount('2026-09-07T00:30:00.000Z', now)).toBe(false);
    expect(isGenuinelyNewAccount('2024-01-01T00:00:00.000Z', now)).toBe(false);
  });

  it('rejects missing or unparseable metadata rather than assuming new', () => {
    expect(isGenuinelyNewAccount(null, now)).toBe(false);
    expect(isGenuinelyNewAccount(undefined, now)).toBe(false);
    expect(isGenuinelyNewAccount('not a date', now)).toBe(false);
    expect(isGenuinelyNewAccount(NaN, now)).toBe(false);
  });

  it('tolerates small clock skew but not a far-future creation time', () => {
    expect(isGenuinelyNewAccount(now + 60 * 1000, now)).toBe(true);
    expect(isGenuinelyNewAccount(now + 60 * 60 * 1000, now)).toBe(false);
  });
});

describe('acquisitionFitsAccount', () => {
  const now = Date.parse('2026-09-07T02:00:00.000Z');
  const at = (iso: string): AcquisitionContext => ({
    source: 'google',
    medium: 'organic',
    landingPage: '/pricing',
    referrerHost: 'www.google.com',
    landedAt: iso,
  });

  it('accepts a landing that happened just before the account existed', () => {
    expect(acquisitionFitsAccount(at('2026-09-07T01:50:00.000Z'), now, now)).toBe(true);
  });

  it('rejects a landing recorded after the account was created', () => {
    // Somebody's later visit is not their first touch.
    const created = Date.parse('2026-09-07T01:00:00.000Z');
    expect(acquisitionFitsAccount(at('2026-09-07T01:50:00.000Z'), created, now)).toBe(false);
  });

  it('rejects a record older than the freshness window', () => {
    expect(acquisitionFitsAccount(at('2026-08-01T00:00:00.000Z'), now, now)).toBe(false);
  });

  it('rejects a landing stamped in the future', () => {
    expect(acquisitionFitsAccount(at('2026-09-08T00:00:00.000Z'), now + 86400000, now)).toBe(false);
  });
});

describe('buildAcquisitionRecord', () => {
  it('stamps the channel and the pickup time without touching the first touch', () => {
    const context: AcquisitionContext = {
      source: 'google',
      medium: 'organic',
      landingPage: '/templates',
      referrerHost: 'www.google.com',
      landedAt: '2026-09-07T01:00:00.000Z',
    };
    expect(buildAcquisitionRecord(context, new Date('2026-09-07T01:05:00.000Z'))).toEqual({
      ...context,
      channel: 'organic_search',
      recordedAt: '2026-09-07T01:05:00.000Z',
    });
  });
});
