/**
 * The Jobs list is dated by each card's stage stamp ("Quote sent 6 days
 * ago") but used to be ordered by Firestore's `orderBy('updatedAt')`.
 * Any background write to a job — a mirror projection, an aggregate sync —
 * moved it up the list without changing the date on its face, so the
 * ordering rule was unreadable on screen.
 *
 * These lock the two together: the list sorts by the value the card prints.
 */
import { describe, it, expect } from 'vitest';

import { jobStatusTimestamp, sortJobsForList } from './jobTimeline';

const DAY = 24 * 60 * 60 * 1000;
const T = 1_700_000_000_000;

function job(over: Record<string, any> = {}): any {
  return {
    id: over.id ?? 'j1',
    stage: 'inquiry',
    createdAt: T,
    updatedAt: T,
    customerName: 'Someone',
    name: 'A job',
    ...over,
  };
}

describe('jobStatusTimestamp', () => {
  it('dates a quoted job by quotedAt, not updatedAt', () => {
    expect(
      jobStatusTimestamp(job({ stage: 'quoted', quotedAt: T - 6 * DAY, updatedAt: T })),
    ).toBe(T - 6 * DAY);
  });

  it('dates a paid job by paidAt', () => {
    expect(
      jobStatusTimestamp(job({ stage: 'paid', paidAt: T - DAY, updatedAt: T })),
    ).toBe(T - DAY);
  });

  it('dates an inquiry by createdAt, since its card says "Created"', () => {
    expect(
      jobStatusTimestamp(job({ stage: 'inquiry', createdAt: T - 3 * DAY, updatedAt: T })),
    ).toBe(T - 3 * DAY);
  });

  it('REGRESSION: editing a job does not make an old draft claim it was just created', () => {
    // A customer edit writes to every job in the group, bumping updatedAt.
    // Dating an inquiry by updatedAt made a two-month-old draft read "Created
    // less than a minute ago" and jump to the top of Recent.
    const draft = job({ stage: 'inquiry', createdAt: T - 60 * DAY, updatedAt: T });
    expect(jobStatusTimestamp(draft)).toBe(T - 60 * DAY);
  });

  it('falls back to createdAt when the stage stamp and updatedAt are both missing', () => {
    expect(
      jobStatusTimestamp(job({ stage: 'quoted', quotedAt: undefined, updatedAt: undefined, createdAt: T - 9 * DAY })),
    ).toBe(T - 9 * DAY);
  });

  it('returns 0 rather than NaN when a job carries no usable dates', () => {
    expect(
      jobStatusTimestamp(job({ stage: 'quoted', quotedAt: undefined, updatedAt: undefined, createdAt: undefined })),
    ).toBe(0);
  });
});

describe('sortJobsForList', () => {
  it('REGRESSION: orders by the date on the card, not by updatedAt', () => {
    // `stale` was touched most recently (updatedAt = now) but its card
    // reads "Quote sent 30 days ago". `fresh` reads "Quote sent 1 day
    // ago". updatedAt ordering would put stale on top, contradicting
    // what both cards say.
    const stale = job({ id: 'stale', stage: 'quoted', quotedAt: T - 30 * DAY, updatedAt: T });
    const fresh = job({ id: 'fresh', stage: 'quoted', quotedAt: T - DAY, updatedAt: T - 20 * DAY });

    expect(sortJobsForList([stale, fresh]).map((j) => j.id)).toEqual(['fresh', 'stale']);
  });

  it('orders newest-first across different stages, each by its own stamp', () => {
    const paid = job({ id: 'paid', stage: 'paid', paidAt: T - 2 * DAY });
    const quoted = job({ id: 'quoted', stage: 'quoted', quotedAt: T - 5 * DAY });
    // Explicit createdAt: an inquiry is dated by when it was created, so the
    // fixture has to say so rather than leaning on the factory default.
    const draft = job({ id: 'draft', stage: 'inquiry', createdAt: T - DAY, updatedAt: T });

    expect(sortJobsForList([quoted, paid, draft]).map((j) => j.id)).toEqual([
      'draft',
      'paid',
      'quoted',
    ]);
  });

  it('breaks ties deterministically so the list cannot reshuffle between renders', () => {
    const a = job({ id: 'aaa', stage: 'quoted', quotedAt: T, updatedAt: T });
    const b = job({ id: 'bbb', stage: 'quoted', quotedAt: T, updatedAt: T });

    expect(sortJobsForList([b, a]).map((j) => j.id)).toEqual(['aaa', 'bbb']);
    expect(sortJobsForList([a, b]).map((j) => j.id)).toEqual(['aaa', 'bbb']);
  });

  it('sinks undated jobs to the bottom instead of floating them to the top', () => {
    const dated = job({ id: 'dated', stage: 'quoted', quotedAt: T - 40 * DAY });
    const undated = job({ id: 'undated', stage: 'quoted', quotedAt: undefined, updatedAt: undefined, createdAt: undefined });

    expect(sortJobsForList([undated, dated]).map((j) => j.id)).toEqual(['dated', 'undated']);
  });

  it('does not mutate the array it was given (the store owns that array)', () => {
    const older = job({ id: 'older', stage: 'quoted', quotedAt: T - 5 * DAY });
    const newer = job({ id: 'newer', stage: 'quoted', quotedAt: T });
    const input = [older, newer];

    sortJobsForList(input);

    expect(input.map((j) => j.id)).toEqual(['older', 'newer']);
  });
});
