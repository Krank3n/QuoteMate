import { describe, expect, it } from 'vitest';
import {
  acquisitionChannel,
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

  it('counts users with no first-touch record as unattributed, never as rows', () => {
    const rollup = rollupAttribution([
      user({ uid: 'a' }),
      user({ uid: 'b', attribution: { utm_content: 'qm-a1' } }),
    ]);
    expect(rollup.unattributedSignups).toBe(1);
    expect(rollup.attributedSignups).toBe(1);
    expect(rollup.rows.map((r) => r.key)).toEqual(['qm-a1']);
  });

  it('keeps the deprecated organicSignups alias equal to unattributedSignups', () => {
    // Both sides of the mirror must agree while the dashboard still reads the
    // old name; the alias is a rename shim, not a second measurement.
    const rollup = rollupAttribution([
      user({ uid: 'a' }),
      user({ uid: 'b', attribution: { acquisition: { channel: 'organic_search' } } }),
    ]);
    expect(rollup.organicSignups).toBe(rollup.unattributedSignups);
    expect(rollup.unattributedSignups).toBe(1);
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
    const rollup = rollupAttribution([]);
    expect(rollup.rows).toEqual([]);
    expect(rollup.attributedSignups).toBe(0);
    expect(rollup.unattributedSignups).toBe(0);
    expect(rollup.organicLandingPages).toEqual([]);
    expect(rollup.channels.every((c) => c.signups === 0)).toBe(true);
  });
});

describe('acquisitionChannel', () => {
  it('reads the channel the app persisted', () => {
    expect(acquisitionChannel({ acquisition: { channel: 'organic_search' } })).toBe('organic_search');
    expect(acquisitionChannel({ acquisition: { channel: 'referral' } })).toBe('referral');
    expect(acquisitionChannel({ acquisition: { channel: 'direct' } })).toBe('direct');
  });

  it('lets a paid campaign key win over whatever the referrer looked like', () => {
    // A paid click that happens to arrive with a search referrer is paid.
    expect(
      acquisitionChannel({ utm_content: 'qm-a1', acquisition: { channel: 'organic_search' } }),
    ).toBe('paid');
  });

  it('never guesses organic: no record, no channel and junk are all unknown', () => {
    expect(acquisitionChannel(null)).toBe('unknown');
    expect(acquisitionChannel({})).toBe('unknown');
    expect(acquisitionChannel({ acquisition: null })).toBe('unknown');
    expect(acquisitionChannel({ acquisition: {} })).toBe('unknown');
    expect(acquisitionChannel({ acquisition: { channel: 'seo' } })).toBe('unknown');
    expect(acquisitionChannel({ acquisition: { channel: 'ORGANIC_SEARCH' } })).toBe('unknown');
  });
});

describe('rollupAttribution channel view', () => {
  it('counts the full funnel per channel and dedupes nothing into organic', () => {
    const rollup = rollupAttribution([
      user({
        uid: 'seo1',
        attribution: { acquisition: { channel: 'organic_search', landingPage: '/templates' } },
        hasQuoteDraft: true,
        hasSentDoc: true,
        monetized: true,
      }),
      user({
        uid: 'seo2',
        attribution: { acquisition: { channel: 'organic_search', landingPage: '/templates' } },
        hasQuoteDraft: true,
      }),
      user({ uid: 'ref1', attribution: { acquisition: { channel: 'referral' } } }),
      user({ uid: 'ad1', attribution: { utm_content: 'qm-a1' }, hasQuoteDraft: true }),
      user({ uid: 'nothing' }),
    ]);
    const byChannel = Object.fromEntries(rollup.channels.map((c) => [c.channel, c]));
    expect(byChannel.organic_search).toEqual({
      channel: 'organic_search',
      signups: 2,
      trials: 2,
      sent: 1,
      monetized: 1,
    });
    expect(byChannel.referral.signups).toBe(1);
    expect(byChannel.paid).toEqual({ channel: 'paid', signups: 1, trials: 1, sent: 0, monetized: 0 });
    expect(byChannel.unknown.signups).toBe(1);
    expect(byChannel.direct.signups).toBe(0);
    // Every account lands in exactly one channel.
    expect(rollup.channels.reduce((n, c) => n + c.signups, 0)).toBe(5);
  });

  it('does not count an account with an acquisition map as unattributed', () => {
    const rollup = rollupAttribution([
      user({ uid: 'a', attribution: { acquisition: { channel: 'direct' } } }),
      user({ uid: 'b' }),
    ]);
    expect(rollup.unattributedSignups).toBe(1);
  });

  it('rolls up organic landing pages, best first, and only for organic search', () => {
    const rollup = rollupAttribution([
      user({
        uid: 'a',
        attribution: { acquisition: { channel: 'organic_search', landingPage: '/templates' } },
        monetized: true,
      }),
      user({
        uid: 'b',
        attribution: { acquisition: { channel: 'organic_search', landingPage: '/templates' } },
      }),
      user({
        uid: 'c',
        attribution: { acquisition: { channel: 'organic_search', landingPage: '/articles/x' } },
      }),
      // A referral landing page is not an organic landing page.
      user({
        uid: 'd',
        attribution: { acquisition: { channel: 'referral', landingPage: '/pricing' } },
      }),
    ]);
    expect(rollup.organicLandingPages).toEqual([
      { landingPage: '/templates', signups: 2, trials: 0, sent: 0, monetized: 1 },
      { landingPage: '/articles/x', signups: 1, trials: 0, sent: 0, monetized: 0 },
    ]);
  });
});
