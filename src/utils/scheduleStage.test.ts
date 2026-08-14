/**
 * The bug these pin: picking a date on a job that had only been quoted
 * saved the date and left the stage alone, so the status never became
 * Scheduled. Only `accepted` was promoted.
 */
import { describe, it, expect } from 'vitest';

import { stageAfterScheduling, stageAfterClearingDate } from './scheduleStage';

describe('stageAfterScheduling', () => {
  it('promotes every stage that still has the work ahead of it', () => {
    // 'quoted' is the regression: the customer rings up and books a day
    // while the quote is still out, which is the ordinary path.
    expect(stageAfterScheduling('quoted')).toBe('scheduled');
    expect(stageAfterScheduling('inquiry')).toBe('scheduled');
    expect(stageAfterScheduling('accepted')).toBe('scheduled');
  });

  it('leaves a started job in progress', () => {
    // Editing the date on a job you're already on site for must not walk
    // the stage backwards — that's what the demote prompt is for.
    expect(stageAfterScheduling('in_progress')).toBe('in_progress');
  });

  it('drops an in-progress job back only when the tradie asked for it', () => {
    expect(stageAfterScheduling('in_progress', { demote: true })).toBe('scheduled');
  });

  it('never un-finishes work that is done or dead', () => {
    for (const stage of ['completed', 'paid', 'closed', 'cancelled'] as const) {
      expect(stageAfterScheduling(stage)).toBe(stage);
      // The demote answer only ever applies to an in-progress job.
      expect(stageAfterScheduling(stage, { demote: true })).toBe(stage);
    }
  });

  it('is a no-op on a job that is already scheduled', () => {
    expect(stageAfterScheduling('scheduled')).toBe('scheduled');
  });
});

describe('stageAfterClearingDate', () => {
  it('drops a scheduled job back to accepted — no date, no schedule', () => {
    expect(stageAfterClearingDate('scheduled')).toBe('accepted');
  });

  it('leaves every other stage where it is', () => {
    for (const stage of ['inquiry', 'quoted', 'accepted', 'in_progress', 'completed'] as const) {
      expect(stageAfterClearingDate(stage)).toBe(stage);
    }
  });
});
