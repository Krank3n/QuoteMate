/**
 * The timeline rail measures WORK, not money.
 *
 * `paid` used to own the rail's last slot, with `completed` squatting in it
 * — so marking a job paid slid the pill to the end of the job and lit the
 * finish line, on the same rail that had a dot for "In Progress" the job had
 * never reached. On the jobs tradies get paid for up front, the pill claimed
 * finished work that was still a date in the diary.
 *
 * PaymentChip owns the money axis (see its header, and invoiceWording in
 * jobTimeline). These pin the rail to the other one.
 */
import { describe, it, expect } from 'vitest';

import { getJobSubStatus, isSlotReached, jobWorkIsDone } from './jobTimeline';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 7, 18, 9).getTime();

function job(over: Record<string, any> = {}): any {
  return { id: 'j1', stage: 'paid', ...over };
}

describe('getJobSubStatus — a paid job shows where the WORK got to', () => {
  it('never puts the word "Paid" on the rail', () => {
    const cases = [
      job(),
      job({ completedAt: NOW - DAY }),
      job({ scheduledStartDate: NOW + 7 * DAY }),
      job({ inProgressAt: NOW - DAY }),
    ];
    for (const j of cases) {
      expect(getJobSubStatus(j, null).label).not.toMatch(/paid/i);
    }
  });

  it('reads "Completed" once the work is actually finished', () => {
    expect(getJobSubStatus(job({ completedAt: NOW - DAY }), null)).toMatchObject({
      slot: 'completed',
      label: 'Completed',
    });
  });

  // completedDate is the older field the sticky bar's Mark Complete writes.
  it('accepts the legacy completion field too', () => {
    expect(getJobSubStatus(job({ completedDate: NOW - DAY }), null).slot).toBe('completed');
  });

  // The case the whole change exists for: money in, work still to come.
  it('shows the booking on a job paid up front', () => {
    const status = getJobSubStatus(job({ scheduledStartDate: NOW + 7 * DAY }), null);
    expect(status.slot).toBe('scheduled');
    expect(status.label).toMatch(/25 Aug/);
  });

  it('shows the work in hand when it started but never finished', () => {
    expect(getJobSubStatus(job({ inProgressAt: NOW - DAY }), null)).toMatchObject({
      slot: 'in_progress',
      label: 'In Progress',
    });
  });

  // Walked from the far end back, so the furthest point wins.
  it('prefers the furthest point reached when several stamps are set', () => {
    const j = job({
      acceptedAt: NOW - 5 * DAY,
      scheduledStartDate: NOW - 3 * DAY,
      inProgressAt: NOW - 2 * DAY,
      completedAt: NOW - DAY,
    });
    expect(getJobSubStatus(j, null).slot).toBe('completed');
  });

  it('falls back to Accepted for a job paid straight off the quote', () => {
    expect(getJobSubStatus(job(), null)).toMatchObject({
      slot: 'accepted',
      label: 'Accepted',
    });
  });

  it('still reads "Completed" for a job at the completed stage', () => {
    expect(getJobSubStatus(job({ stage: 'completed' }), null)).toMatchObject({
      slot: 'completed',
      label: 'Completed',
    });
  });
});

describe('isSlotReached — money never lights a work dot', () => {
  it('leaves the finish line dark on a job paid before the work', () => {
    const booked = job({ scheduledStartDate: NOW + 7 * DAY, scheduledAt: NOW });
    expect(isSlotReached(booked, 'completed')).toBe(false);
    // ...and the dot AFTER the pill stays dark too: `paid` outranks
    // `in_progress` on the stage ladder, which used to light it.
    expect(isSlotReached(booked, 'in_progress')).toBe(false);
    expect(isSlotReached(booked, 'scheduled')).toBe(true);
  });

  it('lights the finish line once the work is done', () => {
    expect(isSlotReached(job({ completedAt: NOW }), 'completed')).toBe(true);
    expect(isSlotReached(job({ completedDate: NOW }), 'completed')).toBe(true);
    expect(isSlotReached(job({ stage: 'completed' }), 'completed')).toBe(true);
  });

  // The ordinal fallback is what makes a stage-leap still light the dots it
  // skipped — that has to keep working for every stage that isn't `paid`.
  it('still lights skipped dots on an ordinary stage leap', () => {
    const leapt = job({ stage: 'in_progress' });
    expect(isSlotReached(leapt, 'quote')).toBe(true);
    expect(isSlotReached(leapt, 'accepted')).toBe(true);
    expect(isSlotReached(leapt, 'scheduled')).toBe(true);
    expect(isSlotReached(leapt, 'completed')).toBe(false);
  });

  it('lights a dot the job holds a stamp for, whatever the stage says', () => {
    expect(isSlotReached(job({ inProgressAt: NOW - DAY }), 'in_progress')).toBe(true);
  });
});

describe('jobWorkIsDone', () => {
  it('is false for a paid job with no completion evidence', () => {
    expect(jobWorkIsDone(job())).toBe(false);
  });

  it('is true on either completion field, or the stage itself', () => {
    expect(jobWorkIsDone(job({ completedAt: NOW }))).toBe(true);
    expect(jobWorkIsDone(job({ completedDate: NOW }))).toBe(true);
    expect(jobWorkIsDone(job({ stage: 'completed' }))).toBe(true);
  });
});
