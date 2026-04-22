import {
  JOB_STAGE_TRANSITIONS,
  canTransition,
  assertTransition,
  deriveJobStageFromDocs,
} from './stage';
import type { JobDocument } from './types';

describe('job stage machine', () => {
  describe('canTransition', () => {
    it('allows legal forward transitions per the table', () => {
      expect(canTransition('inquiry', 'quoted')).toBe(true);
      expect(canTransition('quoted', 'accepted')).toBe(true);
      expect(canTransition('accepted', 'scheduled')).toBe(true);
      expect(canTransition('accepted', 'in_progress')).toBe(true);
      expect(canTransition('scheduled', 'in_progress')).toBe(true);
      expect(canTransition('in_progress', 'completed')).toBe(true);
      expect(canTransition('completed', 'paid')).toBe(true);
      expect(canTransition('paid', 'closed')).toBe(true);
    });

    it('rejects illegal jumps', () => {
      expect(canTransition('inquiry', 'accepted')).toBe(false);
      expect(canTransition('quoted', 'in_progress')).toBe(false);
      expect(canTransition('completed', 'inquiry')).toBe(false);
      expect(canTransition('paid', 'in_progress')).toBe(false);
    });

    it('treats no-op self-transitions as legal', () => {
      expect(canTransition('quoted', 'quoted')).toBe(true);
      expect(canTransition('closed', 'closed')).toBe(true);
    });

    it('treats closed and cancelled as terminal', () => {
      expect(JOB_STAGE_TRANSITIONS.closed).toEqual([]);
      expect(JOB_STAGE_TRANSITIONS.cancelled).toEqual([]);
      expect(canTransition('closed', 'paid')).toBe(false);
      expect(canTransition('cancelled', 'inquiry')).toBe(false);
    });

    it('allows cancelling from any non-terminal stage', () => {
      for (const from of [
        'inquiry',
        'quoted',
        'accepted',
        'scheduled',
        'in_progress',
        'completed',
      ] as const) {
        expect(canTransition(from, 'cancelled')).toBe(true);
      }
    });
  });

  describe('assertTransition', () => {
    it('throws on illegal transitions', () => {
      expect(() => assertTransition('inquiry', 'paid')).toThrow(/Illegal job stage/);
    });
    it('does not throw on legal transitions', () => {
      expect(() => assertTransition('quoted', 'accepted')).not.toThrow();
    });
  });
});

describe('deriveJobStageFromDocs (backfill mapping over unified Documents)', () => {
  const doc = (over: Partial<JobDocument> = {}): JobDocument => ({
    id: 'd' + Math.random(),
    type: 'quote',
    stage: 'draft',
    total: 1000,
    paidTotal: 0,
    balanceDue: 0,
    ...over,
  });

  it('empty → inquiry', () => {
    expect(deriveJobStageFromDocs([])).toBe('inquiry');
  });

  it('draft docs only → inquiry', () => {
    expect(deriveJobStageFromDocs([doc({ stage: 'draft' })])).toBe('inquiry');
  });

  it('sent quote → quoted', () => {
    expect(deriveJobStageFromDocs([doc({ stage: 'quote_sent' })])).toBe('quoted');
  });

  it('rejected-only → inquiry (re-pitch path)', () => {
    expect(deriveJobStageFromDocs([doc({ stage: 'quote_rejected' })])).toBe('inquiry');
  });

  it('accepted quote → accepted', () => {
    expect(deriveJobStageFromDocs([doc({ stage: 'quote_accepted' })])).toBe('accepted');
  });

  it('invoice sent → in_progress', () => {
    expect(deriveJobStageFromDocs([doc({ type: 'invoice', stage: 'invoice_sent' })])).toBe(
      'in_progress',
    );
  });

  it('partially paid → in_progress', () => {
    expect(deriveJobStageFromDocs([doc({ type: 'invoice', stage: 'partially_paid' })])).toBe(
      'in_progress',
    );
  });

  it('all paid → paid', () => {
    expect(
      deriveJobStageFromDocs([
        doc({ type: 'invoice', stage: 'paid' }),
        doc({ type: 'invoice', stage: 'paid' }),
      ]),
    ).toBe('paid');
  });

  it('cancelled docs are ignored when deriving from active ones', () => {
    expect(
      deriveJobStageFromDocs([
        doc({ type: 'invoice', stage: 'paid' }),
        doc({ stage: 'cancelled' }),
      ]),
    ).toBe('paid');
  });

  it('only cancelled → cancelled', () => {
    expect(deriveJobStageFromDocs([doc({ stage: 'cancelled' })])).toBe('cancelled');
  });
});
