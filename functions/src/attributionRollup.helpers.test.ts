import { describe, expect, it } from 'vitest';
import {
  attributionKey,
  rollupAttribution,
  AttributionRollupInput,
} from './attributionRollup.helpers';

function user(overrides: Partial<AttributionRollupInput>): AttributionRollupInput {
  return {
    uid: 'u',
    attribution: null,
    hasQuoteDraft: false,
    hasSentDoc: false,
    monetized: false,
    ...overrides,
  };
}

describe('attributionKey', () => {
  it('uses utm_content (the ad name) when present', () => {
    expect(attributionKey({ utm_content: 'qm-b1-news', utm_source: 'facebook' })).toBe('qm-b1-news');
  });

  it('falls back to source/campaign for non-ad-tagged channels', () => {
    expect(attributionKey({ utm_source: 'asa', utm_campaign: 'brand' })).toBe('asa/brand');
  });

  it('falls back to bare source when campaign is missing', () => {
    expect(attributionKey({ utm_source: 'partner-mea' })).toBe('partner-mea');
  });

  it('returns null for organic users (no doc, or doc without source/content)', () => {
    expect(attributionKey(null)).toBeNull();
    expect(attributionKey({})).toBeNull();
    expect(attributionKey({ utm_campaign: 'qm-launch' })).toBeNull();
  });

  it('treats whitespace-only values as absent', () => {
    expect(attributionKey({ utm_content: '  ', utm_source: 'facebook' })).toBe('facebook');
  });
});

describe('rollupAttribution', () => {
  it('produces one row per ad key with the full funnel counted', () => {
    const { rows } = rollupAttribution([
      user({ uid: 'a', attribution: { utm_content: 'qm-a1' }, hasQuoteDraft: true }),
      user({
        uid: 'b',
        attribution: { utm_content: 'qm-a1' },
        hasQuoteDraft: true,
        hasSentDoc: true,
        monetized: true,
      }),
      user({ uid: 'c', attribution: { utm_content: 'qm-b1-news' } }),
    ]);
    expect(rows).toEqual([
      { key: 'qm-a1', signups: 2, trials: 2, sent: 1, monetized: 1 },
      { key: 'qm-b1-news', signups: 1, trials: 0, sent: 0, monetized: 0 },
    ]);
  });

  it('counts organic users in the baseline but never as rows', () => {
    const rollup = rollupAttribution([
      user({ uid: 'a' }),
      user({ uid: 'b', attribution: { utm_content: 'qm-a1' } }),
    ]);
    expect(rollup.organicSignups).toBe(1);
    expect(rollup.attributedSignups).toBe(1);
    expect(rollup.rows.map((r) => r.key)).toEqual(['qm-a1']);
  });

  it('sorts rows by signups desc, then key asc for stable admin rendering', () => {
    const { rows } = rollupAttribution([
      user({ uid: 'a', attribution: { utm_content: 'zz-low' } }),
      user({ uid: 'b', attribution: { utm_content: 'aa-low' } }),
      user({ uid: 'c', attribution: { utm_content: 'big' } }),
      user({ uid: 'd', attribution: { utm_content: 'big' } }),
    ]);
    expect(rows.map((r) => r.key)).toEqual(['big', 'aa-low', 'zz-low']);
  });

  it('returns empty rollup for no users', () => {
    expect(rollupAttribution([])).toEqual({ rows: [], attributedSignups: 0, organicSignups: 0 });
  });
});
