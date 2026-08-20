/**
 * The dashboard's "Awaiting response / Quotes sent / Jobs won" tiles read
 * 0 / 0 / $0.00 on a fresh sign-in for an account with eight live jobs, while
 * "Earned this month" beside them showed the right figure.
 *
 * Cause: those three counted the legacy `quotes` collection, which populates
 * after `documents` (and drifts once a quote is converted to an invoice — the
 * legacy status leaves accepted/completed, so a won job stops counting).
 *
 * An empty-looking dashboard on an account full of work reads as "this app
 * lost my jobs", so these pin the source of truth and the stage boundaries.
 */
import { describe, it, expect } from 'vitest';

import { quickStats } from './quickStats';

function doc(over: Record<string, any> = {}): any {
  return { id: 'd1', type: 'quote', stage: 'draft', total: 1000, payments: [], ...over };
}

/** The seeded demo account that surfaced the bug: 8 jobs across the pipeline. */
const EIGHT_JOBS = [
  doc({ id: 'turf', stage: 'draft', total: 3923.73 }),
  doc({ id: 'wall', stage: 'quote_sent', total: 7355.43 }),
  doc({ id: 'fence', stage: 'quote_accepted', total: 7098.86 }),
  doc({ id: 'paving', stage: 'quote_accepted', total: 8281.29 }),
  doc({ id: 'pergola', stage: 'quote_accepted', total: 5286.70 }),
  doc({ id: 'colorbond', type: 'invoice', stage: 'invoice_sent', total: 3773.05 }),
  doc({ id: 'deck', type: 'invoice', stage: 'partially_paid', total: 10529.71 }),
  doc({ id: 'merbau', type: 'invoice', stage: 'paid', total: 11365.78 }),
];

describe('quickStats', () => {
  it('REGRESSION: reports the real figures for an account with eight live jobs', () => {
    expect(quickStats(EIGHT_JOBS)).toEqual({
      sentQuotes: 1,
      pipelineValue: 7355.43,
      acceptedQuotes: 6,
    });
  });

  it('counts an invoiced job as won — the drift the legacy status could not express', () => {
    const converted = [doc({ type: 'invoice', stage: 'invoice_sent', total: 4000 })];
    expect(quickStats(converted).acceptedQuotes).toBe(1);
  });

  it('counts a fully paid job as won', () => {
    expect(quickStats([doc({ type: 'invoice', stage: 'paid' })]).acceptedQuotes).toBe(1);
  });

  it('does not count a cancelled job as won, despite it outranking paid', () => {
    expect(quickStats([doc({ stage: 'cancelled' })]).acceptedQuotes).toBe(0);
  });

  it('does not count a rejected quote as awaiting — rejection is an answer', () => {
    const stats = quickStats([doc({ stage: 'quote_rejected', total: 9000 })]);
    expect(stats.sentQuotes).toBe(0);
    expect(stats.pipelineValue).toBe(0);
  });

  it('leaves drafts out of both counts', () => {
    const stats = quickStats([doc({ stage: 'draft', total: 5000 })]);
    expect(stats).toEqual({ sentQuotes: 0, pipelineValue: 0, acceptedQuotes: 0 });
  });

  it('sums the value of several unanswered quotes', () => {
    const stats = quickStats([
      doc({ id: 'a', stage: 'quote_sent', total: 1200.55 }),
      doc({ id: 'b', stage: 'quote_sent', total: 800.45 }),
    ]);
    expect(stats.sentQuotes).toBe(2);
    expect(stats.pipelineValue).toBe(2001);
  });

  it('rounds the pipeline to cents rather than showing float noise', () => {
    const stats = quickStats([
      doc({ id: 'a', stage: 'quote_sent', total: 0.1 }),
      doc({ id: 'b', stage: 'quote_sent', total: 0.2 }),
    ]);
    expect(stats.pipelineValue).toBe(0.3);
  });

  it('treats a missing total as zero rather than NaN', () => {
    const stats = quickStats([doc({ stage: 'quote_sent', total: undefined })]);
    expect(stats.sentQuotes).toBe(1);
    expect(stats.pipelineValue).toBe(0);
  });

  it('survives an empty or ragged document list', () => {
    const empty = { sentQuotes: 0, pipelineValue: 0, acceptedQuotes: 0 };
    expect(quickStats([])).toEqual(empty);
    expect(quickStats(undefined as any)).toEqual(empty);
    expect(quickStats([null as any])).toEqual(empty);
  });
});

describe('a job quoted two ways', () => {
  const opt = (over: Record<string, any> = {}): any => ({
    id: 'q1', type: 'quote', stage: 'quote_sent', jobId: 'job-1', total: 100, ...over,
  });

  it('counts one opportunity, not one per option', () => {
    const stats = quickStats([
      opt({ id: 'a', total: 972.4, updatedAt: 2 }),
      opt({ id: 'b', total: 1458.6, updatedAt: 1 }),
    ]);

    expect(stats.sentQuotes).toBe(1);
  });

  it('values it at one option, never the sum', () => {
    // 972.40 + 1458.60 = 2,431.00 — money the customer will never pay, on a
    // job whose dearest option is 1,458.60.
    const stats = quickStats([
      opt({ id: 'a', total: 972.4, updatedAt: 2 }),
      opt({ id: 'b', total: 1458.6, updatedAt: 1 }),
    ]);

    expect(stats.pipelineValue).toBe(972.4);
    expect(stats.pipelineValue).not.toBe(2431);
  });

  it('still counts quotes on DIFFERENT jobs separately', () => {
    const stats = quickStats([
      opt({ id: 'a', jobId: 'job-1', total: 100 }),
      opt({ id: 'b', jobId: 'job-2', total: 200 }),
    ]);

    expect(stats.sentQuotes).toBe(2);
    expect(stats.pipelineValue).toBe(300);
  });

  it('treats a quote with no job as standing alone', () => {
    // No siblings, so nothing for it to be an alternative to.
    const stats = quickStats([
      opt({ id: 'a', jobId: undefined, total: 100 }),
      opt({ id: 'b', jobId: undefined, total: 200 }),
    ]);

    expect(stats.sentQuotes).toBe(2);
    expect(stats.pipelineValue).toBe(300);
  });
});
