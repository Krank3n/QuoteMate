import { describe, it, expect } from 'vitest';
import {
  CREW_PUSH_COOLDOWN_MS,
  crewJobView,
  decideCrewSendInPush,
  crewLinkDeadPage,
  crewTimePage,
  hashCrewToken,
  isCrewVisibleJob,
  rateLimitIp,
  isPlausibleToken,
  liveCrewMember,
  newCrewToken,
  validateCrewLog,
} from './crewTime.helpers';

const NOW = Date.UTC(2026, 9, 1, 2, 0); // 1 Oct 2026, midday in Sydney

describe('crew link tokens', () => {
  it('mints unguessable, URL-safe tokens and stores only their hash', () => {
    const a = newCrewToken();
    const b = newCrewToken();
    expect(a).not.toBe(b);
    expect(isPlausibleToken(a)).toBe(true);
    expect(hashCrewToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCrewToken(a)).not.toContain(a);
  });

  it('refuses anything that is not token-shaped before touching the database', () => {
    for (const bad of [undefined, '', 'short', '../../users/abc', 'a'.repeat(65), ['x'], 'has space in it here ok']) {
      expect(isPlausibleToken(bad as any), String(bad)).toBe(false);
    }
  });
});

describe('who the link belongs to', () => {
  const crew = [
    { id: 'c1', name: 'Jake', createdAt: 1 },
    { id: 'c2', name: 'Gone', createdAt: 1, archived: true },
  ];
  it('is a live crew member, or nobody', () => {
    expect(liveCrewMember(crew, 'c1')?.name).toBe('Jake');
    expect(liveCrewMember(crew, 'c2')).toBeNull();
    expect(liveCrewMember(crew, 'nope')).toBeNull();
    expect(liveCrewMember(undefined, 'c1')).toBeNull();
  });
});

describe('what a crew member sees of a job', () => {
  it('is the name and address — no customer contact details, no money', () => {
    const view = crewJobView('j1', {
      name: 'Back deck',
      jobAddress: '12 Smith St',
      customerName: 'Gigar',
      customerPhone: '0400 000 000',
      totalQuoted: 12000,
      balanceDue: 400,
    });
    expect(view).toEqual({ id: 'j1', name: 'Back deck', address: '12 Smith St' });
  });
});

describe('what a crew member sends in', () => {
  const ok = { jobId: 'j1', date: '2026-10-01', hours: '7.5', note: '  framing  ' };

  it('accepts hours as typed and tidies the note', () => {
    expect(validateCrewLog(ok, NOW)).toEqual({ input: { jobId: 'j1', date: '2026-10-01', hours: 7.5, note: 'framing' } });
    expect(validateCrewLog({ ...ok, hours: 8, note: '' }, NOW).input).toEqual({ jobId: 'j1', date: '2026-10-01', hours: 8 });
  });

  it('refuses a missing job or a path-shaped one', () => {
    expect(validateCrewLog({ ...ok, jobId: '' }, NOW).error).toMatch(/job/);
    expect(validateCrewLog({ ...ok, jobId: 'a/b' }, NOW).error).toMatch(/job/);
  });

  it('refuses bad hours', () => {
    for (const hours of ['0', '-3', '25', 'lots', null]) {
      expect(validateCrewLog({ ...ok, hours }, NOW).error, String(hours)).toMatch(/Hours/);
    }
  });

  it('allows today and tomorrow-in-UTC (the phone may be a day ahead), not the future or far past', () => {
    expect(validateCrewLog({ ...ok, date: '2026-10-02' }, NOW).input).toBeDefined();
    expect(validateCrewLog({ ...ok, date: '2026-10-04' }, NOW).error).toMatch(/hasn't happened/);
    expect(validateCrewLog({ ...ok, date: '2026-08-05' }, NOW).input).toBeDefined();
    expect(validateCrewLog({ ...ok, date: '2026-07-01' }, NOW).error).toMatch(/days back/);
    expect(validateCrewLog({ ...ok, date: '2026-02-30' }, NOW).error).toMatch(/date/);
  });

  it('caps the note', () => {
    expect(validateCrewLog({ ...ok, note: 'x'.repeat(500) }, NOW).input?.note).toHaveLength(200);
  });
});

describe('the page', () => {
  it('carries no business data and is kept out of search and referrers', () => {
    const html = crewTimePage('abcdefghijklmnopqrstuvwxyz012345');
    expect(html).toContain('noindex');
    expect(html).toContain('no-referrer');
    expect(html).toContain('"abcdefghijklmnopqrstuvwxyz012345"');
    expect(html).not.toMatch(/QuoteMate/i);
  });

  it('a dead link says nothing about whose it was', () => {
    const html = crewLinkDeadPage();
    expect(html).toContain("This link isn't working");
    expect(html).not.toMatch(/QuoteMate/i);
  });
});

describe('which jobs a crew member sees', () => {
  it('open, won jobs only — never archived ones, whose stage archiving leaves alone', () => {
    expect(isCrewVisibleJob({ stage: 'in_progress' })).toBe(true);
    expect(isCrewVisibleJob({ stage: 'completed' })).toBe(true);
    expect(isCrewVisibleJob({ stage: 'in_progress', archivedAt: 1727740800000 })).toBe(false);
    expect(isCrewVisibleJob({ stage: 'quoted' })).toBe(false);
    expect(isCrewVisibleJob({ stage: 'closed' })).toBe(false);
    expect(isCrewVisibleJob({ stage: 'paid' })).toBe(false);
  });
});

describe('the rate-limit key', () => {
  it("trusts the address Google's front end appended, not what the client claimed", () => {
    expect(rateLimitIp('1.1.1.1, 203.0.113.9', '10.0.0.1')).toBe('203.0.113.9');
    expect(rateLimitIp(undefined, '10.0.0.1')).toBe('10.0.0.1');
  });
  it('can never be a Firestore path', () => {
    expect(rateLimitIp('a/b/../c', undefined)).toBe('a_b_.._c');
    expect(rateLimitIp('x'.repeat(200), undefined)).toHaveLength(64);
  });
});

describe('telling the owner hours were sent in', () => {
  const sentIn = { source: 'crew_link', status: 'pending', hours: 7, workerName: 'Jake' };
  const now = 1_000_000_000;

  it('pushes for a crew send-in waiting on approval', () => {
    expect(decideCrewSendInPush(sentIn, undefined, now)).toEqual({ push: true, reason: 'ok' });
  });

  it("stays quiet for time the owner logged themselves, or for an already-approved entry", () => {
    expect(decideCrewSendInPush({ source: 'manual', hours: 7 }, undefined, now).push).toBe(false);
    expect(decideCrewSendInPush({ source: 'mate', hours: 2 }, undefined, now).push).toBe(false);
    expect(decideCrewSendInPush({ ...sentIn, status: 'approved' }, undefined, now).push).toBe(false);
    expect(decideCrewSendInPush(undefined, undefined, now).push).toBe(false);
  });

  it('a burst of send-ins is one buzz, then the next one after the cooldown pushes again', () => {
    expect(decideCrewSendInPush(sentIn, now - 60_000, now)).toEqual({ push: false, reason: 'cooldown' });
    expect(decideCrewSendInPush(sentIn, now - CREW_PUSH_COOLDOWN_MS, now).push).toBe(true);
  });
});
