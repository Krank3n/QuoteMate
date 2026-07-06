import { describe, it, expect } from 'vitest';
import {
  reclaimDocIdForEmail,
  shouldReclaim,
  reclaimCopyPlan,
  buildProRestorePatch,
  buildProFloorPatch,
  grantEndDate,
  pickLogoObject,
} from './accountReclaim.helpers';

describe('reclaimDocIdForEmail — email normalisation', () => {
  it('lowercases and trims', () => {
    expect(reclaimDocIdForEmail('  Admin@ThieleConstructions.com.au ')).toBe(
      'admin@thieleconstructions.com.au',
    );
  });

  it('leaves an already-normalised email unchanged', () => {
    expect(reclaimDocIdForEmail('a@b.co')).toBe('a@b.co');
  });
});

describe('shouldReclaim — one-shot claim gating', () => {
  it('reclaims an unclaimed record with a different oldUid', () => {
    expect(shouldReclaim({ oldUid: 'old123' }, 'new456')).toBe(true);
  });

  it('never reclaims a missing record', () => {
    expect(shouldReclaim(undefined, 'new456')).toBe(false);
  });

  it('never reclaims a record without an oldUid', () => {
    expect(shouldReclaim({}, 'new456')).toBe(false);
  });

  it('never reclaims twice — claimedByUid blocks it', () => {
    expect(
      shouldReclaim({ oldUid: 'old123', claimedByUid: 'other789' }, 'new456'),
    ).toBe(false);
  });

  it('never copies a uid onto itself', () => {
    expect(shouldReclaim({ oldUid: 'same1' }, 'same1')).toBe(false);
  });
});

describe('reclaimCopyPlan — storage object remapping', () => {
  it('maps logo and nested quote photos onto the new uid', () => {
    const plan = reclaimCopyPlan('oldU', 'newU', [
      'users/oldU/logo.jpg',
      'users/oldU/quote-photos/171234-abc.jpg',
    ]);
    expect(plan).toEqual([
      { from: 'users/oldU/logo.jpg', to: 'users/newU/logo.jpg' },
      {
        from: 'users/oldU/quote-photos/171234-abc.jpg',
        to: 'users/newU/quote-photos/171234-abc.jpg',
      },
    ]);
  });

  it('drops objects outside the old uid tree', () => {
    const plan = reclaimCopyPlan('oldU', 'newU', [
      'users/otherU/logo.jpg',
      'suppliers/s1/logo.png',
      'users/oldUx/sneaky-prefix-collision.jpg',
    ]);
    expect(plan).toEqual([]);
  });

  it('drops the bare folder placeholder (prefix with nothing after it)', () => {
    expect(reclaimCopyPlan('oldU', 'newU', ['users/oldU/'])).toEqual([]);
  });

  it('returns an empty plan for no objects', () => {
    expect(reclaimCopyPlan('oldU', 'newU', [])).toEqual([]);
  });
});

describe('buildProRestorePatch — deleted-payer Pro restoration', () => {
  const now = new Date('2026-07-06T00:00:00Z');

  it('grants Pro until the recorded date for an active payer', () => {
    const patch = buildProRestorePatch(
      {
        oldUid: 'old1',
        restorePro: { platform: 'android', plan: 'yearly', proUntil: '2027-09-09T00:00:00Z' },
      },
      now,
    );
    expect(patch).toMatchObject({
      isPro: true,
      platform: 'android',
      plan: 'yearly',
      restoredFromIncident: 'incident-2026-07',
      quotesThisMonth: 0,
    });
    expect((patch!.currentPeriodEnd as Date).toISOString()).toBe('2027-09-09T00:00:00.000Z');
  });

  it('returns null when the record has no Pro grant', () => {
    expect(buildProRestorePatch({ oldUid: 'old1' }, now)).toBeNull();
    expect(buildProRestorePatch(undefined, now)).toBeNull();
  });

  it('returns null when the grant has already lapsed', () => {
    expect(
      buildProRestorePatch(
        { oldUid: 'old1', restorePro: { proUntil: '2026-07-05T00:00:00Z' } },
        now,
      ),
    ).toBeNull();
  });

  it('returns null for an unparseable proUntil', () => {
    expect(
      buildProRestorePatch(
        { oldUid: 'old1', restorePro: { proUntil: 'not-a-date' } },
        now,
      ),
    ).toBeNull();
  });

  it('defaults platform when missing', () => {
    const patch = buildProRestorePatch(
      { oldUid: 'old1', restorePro: { proUntil: '2026-10-06T00:00:00Z' } },
      now,
    );
    expect(patch!.platform).toBe('unknown');
    expect(patch!.plan).toBeNull();
  });

  it('resolves a durationDays grant from the claim moment and stamps the absolute end', () => {
    const patch = buildProRestorePatch(
      { oldUid: 'old1', restorePro: { plan: 'goodwill', durationDays: 30 } },
      now,
    );
    expect(patch!.isPro).toBe(true);
    expect(patch!.incidentProUntil).toBe('2026-08-05T00:00:00.000Z');
    expect((patch!.currentPeriodEnd as Date).toISOString()).toBe('2026-08-05T00:00:00.000Z');
  });

  it('proUntil wins over durationDays when both are present', () => {
    expect(
      grantEndDate({ proUntil: '2027-09-09T00:00:00Z', durationDays: 30 }, now)!.toISOString(),
    ).toBe('2027-09-09T00:00:00.000Z');
  });

  it('grants nothing for zero/negative durations', () => {
    expect(buildProRestorePatch({ oldUid: 'o', restorePro: { durationDays: 0 } }, now)).toBeNull();
    expect(buildProRestorePatch({ oldUid: 'o', restorePro: { durationDays: -5 } }, now)).toBeNull();
  });
});

describe('buildProFloorPatch — grant defence against client clobbers', () => {
  const now = new Date('2026-07-06T00:00:00Z');
  const until = '2026-10-06T00:00:00Z';

  it('re-asserts Pro when a client write downgraded it', () => {
    const patch = buildProFloorPatch({ isPro: false, plan: 'free' }, until, now);
    expect(patch).toMatchObject({ isPro: true, incidentProUntil: until });
  });

  it('re-creates the grant when the doc was deleted', () => {
    expect(buildProFloorPatch(null, until, now)).toMatchObject({ isPro: true });
  });

  it('no-ops when the doc is already Pro (loop terminator)', () => {
    expect(buildProFloorPatch({ isPro: true }, until, now)).toBeNull();
  });

  it('lets a lapsed grant expire naturally', () => {
    expect(buildProFloorPatch({ isPro: false }, '2026-07-05T00:00:00Z', now)).toBeNull();
  });

  it('no-ops without a grant', () => {
    expect(buildProFloorPatch({ isPro: false }, undefined, now)).toBeNull();
  });
});

describe('pickLogoObject — logo detection among reclaimed files', () => {
  it('finds the logo among quote photos', () => {
    expect(
      pickLogoObject(['users/newU/quote-photos/1.jpg', 'users/newU/logo.jpg']),
    ).toBe('users/newU/logo.jpg');
  });

  it('accepts png and uppercase extensions', () => {
    expect(pickLogoObject(['users/newU/logo.PNG'])).toBe('users/newU/logo.PNG');
  });

  it('ignores logo-named files nested deeper', () => {
    expect(pickLogoObject(['users/newU/quote-photos/logo.jpg'])).toBeNull();
  });

  it('returns null when there is no logo', () => {
    expect(pickLogoObject(['users/newU/quote-photos/1.jpg'])).toBeNull();
  });
});
