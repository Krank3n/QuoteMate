/**
 * The "Currently …" line on both status doors.
 *
 * The pill door prints this a centimetre under the pill you just tapped, so
 * naming the raw job stage made them contradict each other out loud: an
 * `in_progress` job under a sent invoice shows "Invoice Sent" on the pill,
 * and the sheet it opened said "Currently In Progress".
 */
import { describe, it, expect } from 'vitest';

import { getJobSubStatus, jobStatusLabel } from './jobTimeline';
import type { Job } from '../../shared/job/types';
import type { Document } from '../types/document';

const job = (stage: string, extra: Record<string, unknown> = {}) =>
  ({ id: 'j1', stage, createdAt: 1, updatedAt: 1, ...extra }) as unknown as Job;
const doc = (stage: string, extra: Record<string, unknown> = {}) =>
  ({ id: 'd1', type: 'invoice', stage, invoicedAt: 1, ...extra }) as unknown as Document;

describe('jobStatusLabel', () => {
  it('says what the pill says', () => {
    // The whole point: same input, same words as the card's timeline pill.
    const cases: Array<[Job, Document | null]> = [
      [job('in_progress'), doc('invoice_sent')],
      [job('in_progress'), null],
      [job('accepted'), null],
      [job('accepted'), doc('draft', { type: 'quote', invoicedAt: 0, depositPaid: 50 })],
      [job('completed'), null],
      [job('paid'), null],
    ];
    for (const [j, d] of cases) {
      expect(jobStatusLabel(j, d)).toBe(getJobSubStatus(j, d).label);
    }
  });

  it('puts the bare-noun markers into sentence form', () => {
    // The pill marks "a quote exists" as just "Quote" — fine as a step
    // marker on the rail, reads as a typo after "Currently".
    expect(getJobSubStatus(job('quoted'), null).label).toBe('Quote');
    expect(jobStatusLabel(job('quoted'), null)).toBe('Quoted');
    expect(jobStatusLabel(job('quoted'), doc('draft'))).toBe('Invoiced');
    // Anything already phrased as a status is left alone.
    expect(jobStatusLabel(job('quoted'), { type: 'quote', stage: 'quote_sent' } as any)).toBe(
      'Quote Sent',
    );
  });

  it('names the document once it has outrun the job stage', () => {
    // The bug this replaced: "Currently Quoted" under a converted invoice.
    expect(jobStatusLabel(job('quoted'), doc('invoice_sent'))).toBe('Invoice Sent');
    expect(jobStatusLabel(job('in_progress'), doc('partially_paid'))).toBe('Invoice Sent');
  });

  it('uses the stage word for terminal jobs', () => {
    // No pill on a terminal card, and getJobSubStatus falls through to
    // "Draft" for them — which would be a flat lie on a cancelled job.
    expect(jobStatusLabel(job('cancelled'), null)).toBe('Cancelled');
    expect(jobStatusLabel(job('closed'), null)).toBe('Closed');
    expect(jobStatusLabel(job('cancelled'), doc('invoice_sent'))).toBe('Cancelled');
  });

  it('says "Scheduled" rather than reading back the date', () => {
    // The pill prints "Fri 5 Sep · 9am"; "Currently Fri 5 Sep · 9am" isn't
    // a sentence.
    const scheduled = job('scheduled', { scheduledStartDate: Date.UTC(2026, 8, 5, 23, 0) });
    expect(getJobSubStatus(scheduled, null).label).not.toBe('Scheduled');
    expect(jobStatusLabel(scheduled, null)).toBe('Scheduled');
  });
});
