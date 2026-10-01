import { describe, it, expect } from 'vitest';
import { buildHoursComparison } from './hoursComparison';

const doc = (id: string, jobId: string, laborHours: number, extra: Record<string, unknown> = {}) =>
  ({ id, jobId, laborHours, laborRate: 100, laborUnit: 'hours', ...extra }) as any;

const entry = (jobId: string, hours: number, date = '2026-09-20', billable = true) => ({ jobId, hours, date, billable });

describe('quoted vs logged hours', () => {
  it('compares each job with both sides, newest logging first', () => {
    const result = buildHoursComparison(
      [entry('deck', 12, '2026-09-10'), entry('fence', 4, '2026-09-28'), entry('fence', 2, '2026-09-29')],
      [
        { id: 'deck', name: 'Back deck', customerName: 'Gigar', primaryDocumentId: 'q-deck', stage: 'completed' },
        { id: 'fence', name: 'Side fence', primaryDocumentId: 'q-fence', stage: 'paid' },
      ],
      [doc('q-deck', 'deck', 10), doc('q-fence', 'fence', 8)],
    );
    expect(result.rows.map((r) => [r.jobId, r.loggedHours, r.quotedHours, r.overPercent])).toEqual([
      ['fence', 6, 8, -25],
      ['deck', 12, 10, 20],
    ]);
    expect(result.totalLogged).toBe(18);
    expect(result.totalQuoted).toBe(18);
    expect(result.overallOverPercent).toBe(0);
    expect(result.jobsOver).toBe(1);
  });

  it('leaves out jobs with no time logged, and lump-sum quotes', () => {
    const result = buildHoursComparison(
      [entry('lump', 5)],
      [
        { id: 'lump', name: 'Set price job', primaryDocumentId: 'q-lump', stage: 'completed' },
        { id: 'idle', name: 'Nothing logged', primaryDocumentId: 'q-idle', stage: 'completed' },
      ],
      [doc('q-lump', 'lump', 0, { laborRate: 0 }), doc('q-idle', 'idle', 10)],
    );
    expect(result.rows).toEqual([]);
    expect(result.overallOverPercent).toBeNull();
  });

  it('only counts billable time against the quote', () => {
    const result = buildHoursComparison(
      [entry('deck', 10), entry('deck', 3, '2026-09-21', false)],
      [{ id: 'deck', name: 'Deck', primaryDocumentId: 'q', stage: 'completed' }],
      [doc('q', 'deck', 10)],
    );
    expect(result.rows[0].loggedHours).toBe(10);
    expect(result.rows[0].overPercent).toBe(0);
  });

  it("finds the job's quote by jobId when the job has no primary document", () => {
    const result = buildHoursComparison(
      [entry('deck', 5)],
      [{ id: 'deck', name: 'Deck', stage: 'completed' }],
      [doc('q-cancelled', 'deck', 1, { stage: 'cancelled' }), doc('q', 'deck', 4)],
    );
    expect(result.rows[0].quotedHours).toBe(4);
  });

  it('leaves out work still under way — unless it has already been invoiced', () => {
    const result = buildHoursComparison(
      [entry('wip', 2), entry('invoiced', 9)],
      [
        { id: 'wip', name: 'Half done', primaryDocumentId: 'q-wip', stage: 'in_progress' },
        { id: 'invoiced', name: 'Billed', primaryDocumentId: 'i-1', stage: 'in_progress' },
      ],
      [doc('q-wip', 'wip', 12), doc('i-1', 'invoiced', 8, { type: 'invoice' })],
    );
    expect(result.rows.map((r) => r.jobId)).toEqual(['invoiced']);
  });
});
