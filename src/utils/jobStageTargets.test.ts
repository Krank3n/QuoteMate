/**
 * Two surfaces offer a status change — the timeline pill's JobStageSheet
 * and the kebab's "Change status" submenu. They share this helper so they
 * can't drift; these pin the rules that make sharing safe.
 */
import { describe, it, expect } from 'vitest';

import { legalStageTargets, shouldOfferSchedule } from './jobStageTargets';

describe('legalStageTargets', () => {
  it('never offers the stage the job is already on', () => {
    for (const stage of ['inquiry', 'quoted', 'accepted', 'in_progress'] as const) {
      expect(legalStageTargets(stage)).not.toContain(stage);
    }
  });

  it('offers only legal edges from the shared state machine', () => {
    // Whatever the machine permits, nothing more — a stage the server
    // would reject must not be tappable (it used to fail silently).
    const targets = legalStageTargets('inquiry');
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).toContain('quoted');
  });

  it('drops `scheduled` when the caller renders its own Schedule row', () => {
    const withRow = legalStageTargets('accepted', { excludeScheduled: true });
    const withoutRow = legalStageTargets('accepted', { excludeScheduled: false });

    expect(withoutRow).toContain('scheduled');
    expect(withRow).not.toContain('scheduled');
    // Dropping the duplicate must not drop anything else with it.
    expect(withRow).toEqual(withoutRow.filter((s) => s !== 'scheduled'));
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

  it('the deposit flag removes only that edge, leaving the execution lane open', () => {
    const paid = legalStageTargets('accepted', { depositPaid: true });
    const soft = legalStageTargets('accepted', { depositPaid: false });
    expect(paid).toEqual(soft.filter((s) => s !== 'quoted'));
    expect(paid).toContain('scheduled');
    expect(paid).toContain('cancelled');
  });

  it('returns a fresh array each call, so a caller cannot poison the next', () => {
    const first = legalStageTargets('inquiry');
    first.push('paid');
    expect(legalStageTargets('inquiry')).not.toBe(first);
    expect(legalStageTargets('inquiry').filter((s) => s === 'paid').length).toBeLessThanOrEqual(1);
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
});
