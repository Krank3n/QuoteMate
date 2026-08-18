/**
 * Two surfaces offer a status change — the timeline pill's JobStageSheet
 * and the kebab's "Change status" submenu. They share this helper so they
 * can't drift; these pin the rules that make sharing safe.
 */
import { describe, it, expect } from 'vitest';

import {
  legalStageTargets,
  shouldOfferReschedule,
  shouldOfferSchedule,
} from './jobStageTargets';

describe('legalStageTargets', () => {
  it('never offers the stage the job is already on', () => {
    for (const stage of ['inquiry', 'quoted', 'accepted', 'in_progress'] as const) {
      expect(legalStageTargets(stage)).not.toContain(stage);
    }
  });

  // Leaps are the point: a tradie who did the work and got paid without
  // touching the app shouldn't tap through four intermediate stages.
  it('lets a job jump ahead past the adjacent edges', () => {
    const targets = legalStageTargets('quoted');
    expect(targets).toContain('accepted');   // adjacent
    expect(targets).toContain('completed');  // a leap
    expect(targets).toContain('paid');       // a bigger leap
  });

  it('lets a job go backwards when the tradie taps the wrong thing', () => {
    expect(legalStageTargets('completed')).toContain('quoted');
  });

  it('offers every other stage by default', () => {
    // 9 stages in the lifecycle, minus the one you are on.
    expect(legalStageTargets('inquiry')).toHaveLength(8);
  });

  // `scheduled` used to be carved out of this list whenever the caller drew
  // its own "Schedule…" row, so the status list a tradie scanned had no
  // Scheduled in it at all. The row is a stage row now — it just opens the
  // date picker on the way (see shouldOfferSchedule).
  it('offers `scheduled` like any other stage', () => {
    for (const stage of ['inquiry', 'quoted', 'accepted', 'in_progress'] as const) {
      expect(legalStageTargets(stage)).toContain('scheduled');
    }
  });

  // The money firewall: once a deposit has been paid, an accepted job
  // can't drop back to quoted without an explicit cancel. Both surfaces
  // must hide that row, not just the one that happened to pass the flag.
  it('hides accepted → quoted once a deposit has been paid', () => {
    expect(legalStageTargets('accepted', { depositPaid: true })).not.toContain('quoted');
  });

  it('still offers accepted → quoted while the acceptance is soft', () => {
    expect(legalStageTargets('accepted', { depositPaid: false })).toContain('quoted');
    expect(legalStageTargets('accepted')).toContain('quoted');
  });

  it('the deposit flag removes only that edge, leaving every other leap open', () => {
    const paid = legalStageTargets('accepted', { depositPaid: true });
    const soft = legalStageTargets('accepted', { depositPaid: false });
    expect(paid).toEqual(soft.filter((s) => s !== 'quoted'));
    expect(paid).toContain('scheduled');
    expect(paid).toContain('cancelled');
    expect(paid).toContain('paid');
  });

  // The firewall is the ONLY thing that survives opening up the graph —
  // if this stops holding, a paid deposit can be silently walked back.
  it('is the only rule that blocks a target', () => {
    const everyStage = legalStageTargets('accepted', { depositPaid: false });
    const firewalled = legalStageTargets('accepted', { depositPaid: true });
    expect(everyStage).toHaveLength(8);
    expect(firewalled).toHaveLength(7);
  });

  it('returns a fresh array each call, so a caller cannot poison the next', () => {
    const first = legalStageTargets('inquiry');
    first.push('paid');
    expect(legalStageTargets('inquiry')).not.toBe(first);
    expect(legalStageTargets('inquiry').filter((s) => s === 'paid').length).toBeLessThanOrEqual(1);
  });
});

/**
 * Opening up leaps had a side effect: a job whose document is already an
 * invoice was still offered "Mark as Quoted". Taking it wouldn't touch the
 * invoice — applyJobStageChange only propagates onto docs still in the
 * quote lifecycle — so it just left the job contradicting its document.
 */
describe('legalStageTargets — quote stages once a document is an invoice', () => {
  it('drops the quote-phase stages', () => {
    const targets = legalStageTargets('quoted', { documentIsInvoice: true });
    expect(targets).not.toContain('quoted');
    expect(targets).not.toContain('inquiry');
  });

  it('keeps every stage the job could genuinely move to', () => {
    const targets = legalStageTargets('quoted', { documentIsInvoice: true });
    expect(targets).toContain('accepted');
    expect(targets).toContain('in_progress');
    expect(targets).toContain('completed');
    expect(targets).toContain('paid');
    expect(targets).toContain('cancelled');
  });

  it('leaves the list alone while the document is still a quote', () => {
    expect(legalStageTargets('quoted', { documentIsInvoice: false })).toContain('inquiry');
    expect(legalStageTargets('completed', { documentIsInvoice: false })).toContain('quoted');
  });

  // "Back to a quote…" reverts the document, so the stages come back by
  // themselves — no separate re-enable to keep in sync.
  it('restores them once the document is a quote again', () => {
    const asInvoice = legalStageTargets('completed', { documentIsInvoice: true });
    const asQuote = legalStageTargets('completed', { documentIsInvoice: false });
    expect(asInvoice).not.toContain('quoted');
    expect(asQuote).toContain('quoted');
  });
});

describe('shouldOfferSchedule', () => {
  it('offers a date on jobs that still have work ahead of them', () => {
    for (const stage of ['inquiry', 'quoted', 'accepted', 'scheduled', 'in_progress'] as const) {
      expect(shouldOfferSchedule({ stage })).toBe(true);
    }
  });

  it('hides it once the work is done or the job is dead', () => {
    for (const stage of ['completed', 'paid', 'closed', 'cancelled'] as const) {
      expect(shouldOfferSchedule({ stage })).toBe(false);
    }
  });

  // A job paid up front is `paid` with next Tuesday still sitting on it.
  // Hiding the picker locked the tradie out of their own booking: the date
  // couldn't be moved, and clearing it — which is what takes the calendar
  // event down — was impossible without dropping the stage back first.
  it('always offers the picker on a job that already has a date', () => {
    for (const stage of ['completed', 'paid', 'closed', 'cancelled'] as const) {
      expect(shouldOfferSchedule({ stage, scheduledStartDate: 1 })).toBe(true);
    }
  });
});

describe('shouldOfferReschedule', () => {
  // The ladder never offers the stage you're standing on, so a scheduled
  // job has no `scheduled` row to open the picker from.
  it('gives a scheduled job its own date row', () => {
    expect(shouldOfferReschedule({ stage: 'scheduled', scheduledStartDate: 1 })).toBe(true);
  });

  it('gives a paid job with a booking its own date row', () => {
    expect(shouldOfferReschedule({ stage: 'paid', scheduledStartDate: 1 })).toBe(true);
  });

  // Two rows opening the same picker is one row too many: an in-progress
  // job's `scheduled` row already IS the date door (opensPicker), and it
  // carries the demote prompt with it.
  it('stays out of the way when the ladder already carries the date door', () => {
    expect(shouldOfferReschedule({ stage: 'in_progress', scheduledStartDate: 1 })).toBe(false);
    expect(shouldOfferReschedule({ stage: 'accepted', scheduledStartDate: 1 })).toBe(false);
  });

  it('offers nothing to reschedule when no date has been picked', () => {
    for (const stage of ['accepted', 'paid', 'completed', 'cancelled'] as const) {
      expect(shouldOfferReschedule({ stage })).toBe(false);
    }
  });

  // A bare stage flip can leave a job marked Scheduled with no date on it.
  // The ladder still can't offer the stage it's on, so this row is the only
  // way that job ever gets a date.
  it('still opens the picker for a scheduled job that never got a date', () => {
    expect(shouldOfferReschedule({ stage: 'scheduled' })).toBe(true);
  });
});
