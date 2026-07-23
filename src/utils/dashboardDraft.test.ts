/**
 * Dashboard draft-banner rules.
 *
 * Regression context (Jul 2026): the banner used to show the newest
 * unfinished draft forever — a weeks-old abandoned draft squatted on the
 * home screen's top slot with only a destructive delete as the way out —
 * and the draft's auto-created Job simultaneously appeared at the top of
 * Recent Jobs, so the same work-in-progress was listed twice on one screen.
 */
import { describe, it, expect } from 'vitest';

import {
  pickDashboardDraft,
  excludeDraftJob,
  DRAFT_BANNER_MAX_AGE_MS,
} from './dashboardDraft';
import type { Quote } from '../types';

const NOW = new Date('2026-07-16T09:00:00Z').getTime();

function draft(overrides: Partial<Quote>): Quote {
  return {
    id: 'q1',
    status: 'draft',
    draftStep: 'MaterialsList',
    updatedAt: new Date(NOW - 60 * 60 * 1000).toISOString(), // 1h old
    ...overrides,
  } as Quote;
}

describe('pickDashboardDraft', () => {
  it('returns the newest in-progress draft touched within the window', () => {
    const older = draft({ id: 'old', updatedAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString() });
    const newer = draft({ id: 'new', updatedAt: new Date(NOW - 60 * 60 * 1000).toISOString() });
    expect(pickDashboardDraft([older, newer], NOW)?.id).toBe('new');
  });

  it('ignores drafts without a wizard step stamped', () => {
    const noStep = draft({ id: 'no-step', draftStep: undefined });
    expect(pickDashboardDraft([noStep], NOW)).toBeNull();
  });

  it('ignores quotes that are past draft status', () => {
    const sent = draft({ id: 'sent', status: 'sent' });
    const accepted = draft({ id: 'accepted', status: 'accepted' });
    expect(pickDashboardDraft([sent, accepted], NOW)).toBeNull();
  });

  it('hides a zombie draft older than the banner window', () => {
    const stale = draft({
      id: 'stale',
      updatedAt: new Date(NOW - DRAFT_BANNER_MAX_AGE_MS - 60 * 1000).toISOString(),
    });
    expect(pickDashboardDraft([stale], NOW)).toBeNull();
  });

  it('still shows a draft just inside the window', () => {
    const nearlyStale = draft({
      id: 'nearly',
      updatedAt: new Date(NOW - DRAFT_BANNER_MAX_AGE_MS + 60 * 1000).toISOString(),
    });
    expect(pickDashboardDraft([nearlyStale], NOW)?.id).toBe('nearly');
  });

  it('returns null for an empty quote list', () => {
    expect(pickDashboardDraft([], NOW)).toBeNull();
  });

  // Regression (Jul 2026): converting a wizard draft to an invoice via the
  // unified convertDocumentToInvoice path left the legacy quote row as
  // status 'draft' with a draftStep, so the banner offered "Continue draft"
  // for a job that was already invoiced — and paid.
  it('ignores a draft that has been converted to an invoice (invoiceId stamped)', () => {
    const converted = draft({ id: 'converted', invoiceId: 'converted' });
    expect(pickDashboardDraft([converted], NOW)).toBeNull();
  });

  it('ignores a draft with invoicedAt stamped even without invoiceId', () => {
    const invoiced = draft({ id: 'invoiced', invoicedAt: new Date(NOW - 1000) });
    expect(pickDashboardDraft([invoiced], NOW)).toBeNull();
  });

  it('an invoiced zombie does not shadow an older genuine draft', () => {
    const zombie = draft({ id: 'zombie', invoiceId: 'zombie', updatedAt: new Date(NOW - 1000).toISOString() });
    const genuine = draft({ id: 'genuine', updatedAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() });
    expect(pickDashboardDraft([zombie, genuine], NOW)?.id).toBe('genuine');
  });
});

describe('excludeDraftJob', () => {
  const jobs = [{ id: 'job-a' }, { id: 'job-b' }, { id: 'job-c' }];

  it("removes the banner draft's job so it isn't listed twice", () => {
    expect(excludeDraftJob(jobs, 'job-b').map((j) => j.id)).toEqual(['job-a', 'job-c']);
  });

  it('is a no-op when the draft has no linked job', () => {
    expect(excludeDraftJob(jobs, undefined)).toEqual(jobs);
    expect(excludeDraftJob(jobs, null)).toEqual(jobs);
  });

  it('is a no-op when no job matches', () => {
    expect(excludeDraftJob(jobs, 'job-x')).toEqual(jobs);
  });
});
