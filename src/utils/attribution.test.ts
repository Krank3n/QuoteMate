import { describe, expect, it } from 'vitest';
import {
  parseAttributionParams,
  buildAttributionDoc,
  parseStoredAttribution,
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
