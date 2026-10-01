import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildProposal, MAX_LOG_DAYS_AGO } from '../proposalTools';
import { setRenderableQuoteProbe } from '../showQuoteGate';
import { registerQuotingProfileSource } from '../quotingProfileContext';
import { dateKeyDaysAgo } from '../../../../shared/time/hours';
import { logTimeHeadline } from '../../../components/assistant/proposalCardCopy';
import type { LogTimeProposal } from '../../../types/assistant';

const build = (input: Record<string, unknown>) =>
  buildProposal('propose_log_time', 'tool_lt', { quoteId: 'doc_1', ...input }) as {
    proposal?: LogTimeProposal;
    error?: string;
  };

afterEach(() => {
  vi.useRealTimers();
});

describe('propose_log_time', () => {
  it('builds a card for today by default, billable', () => {
    const { proposal, error } = build({ hours: 3, displayName: 'Back deck' });
    expect(error).toBeUndefined();
    expect(proposal).toMatchObject({
      type: 'propose_log_time',
      quoteId: 'doc_1',
      hours: 3,
      date: dateKeyDaysAgo(0),
      billable: true,
      displayName: 'Back deck',
    });
  });

  it('counts daysAgo back from today — "yesterday" is 1', () => {
    expect(build({ hours: 7.5, daysAgo: 1 }).proposal?.date).toBe(dateKeyDaysAgo(1));
  });

  it('takes hours said as "7:30" or a numeric string', () => {
    expect(build({ hours: '7:30' }).proposal?.hours).toBe(7.5);
    expect(build({ hours: '6' }).proposal?.hours).toBe(6);
  });

  it('refuses hours that are missing, zero, negative or over a day', () => {
    for (const hours of [undefined, 0, -1, 25, 'a few']) {
      const { proposal, error } = build({ hours });
      expect(proposal, String(hours)).toBeUndefined();
      expect(error).toMatch(/hours/);
    }
  });

  it('refuses a day in the future or a fractional day', () => {
    expect(build({ hours: 2, daysAgo: -1 }).error).toMatch(/future/);
    expect(build({ hours: 2, daysAgo: 1.5 }).error).toMatch(/whole number/);
  });

  it('sends anything older than the limit to the job screen', () => {
    expect(build({ hours: 2, daysAgo: MAX_LOG_DAYS_AGO }).proposal).toBeDefined();
    expect(build({ hours: 2, daysAgo: MAX_LOG_DAYS_AGO + 1 }).error).toMatch(/job screen/);
  });

  it('billable: false keeps it off the invoice', () => {
    expect(build({ hours: 2, billable: false }).proposal?.billable).toBe(false);
  });

  it('trims the note and drops an empty one', () => {
    expect(build({ hours: 2, note: '  second fix ' }).proposal?.note).toBe('second fix');
    expect(build({ hours: 2, note: '   ' }).proposal?.note).toBeUndefined();
  });

  it('refuses an unknown job — a quote id that is not on this phone', () => {
    setRenderableQuoteProbe((id) => (id === 'doc_known' ? id : null));
    try {
      expect(build({ quoteId: 'doc_invented', hours: 2 }).error).toContain('never invent a quoteId');
      expect(build({ quoteId: 'doc_known', hours: 2 }).proposal?.quoteId).toBe('doc_known');
    } finally {
      setRenderableQuoteProbe(null);
    }
  });
});

describe('propose_log_time for the crew', () => {
  afterEach(() => registerQuotingProfileSource(() => null));
  const withCrew = () =>
    registerQuotingProfileSource(() => ({ crew: [{ id: 'c1', name: 'Jake Smith', createdAt: 1 }, { id: 'c2', name: 'Priya', createdAt: 1 }] }) as any);

  it("puts a crew member's hours under them", () => {
    withCrew();
    const { proposal, error } = build({ hours: 6, daysAgo: 1, crewName: 'jake' });
    expect(error).toBeUndefined();
    expect(proposal).toMatchObject({ crewMemberId: 'c1', crewName: 'Jake Smith', hours: 6 });
  });

  it("refuses a name that isn't on the crew, naming who is", () => {
    withCrew();
    const { proposal, error } = build({ hours: 6, crewName: 'Dave' });
    expect(proposal).toBeUndefined();
    expect(error).toMatch(/Jake Smith, Priya/);
  });

  it("leaves the tradie's own time alone", () => {
    withCrew();
    expect(build({ hours: 3 }).proposal?.crewMemberId).toBeUndefined();
  });
});

describe('the log-time card headline', () => {
  const now = new Date(2026, 8, 30, 10);
  it('says today / yesterday, then the weekday and date', () => {
    expect(logTimeHeadline({ hours: 3, date: '2026-09-30' }, now)).toBe('3 h today');
    expect(logTimeHeadline({ hours: 7.5, date: '2026-09-29' }, now)).toBe('7.5 h yesterday');
    expect(logTimeHeadline({ hours: 2, date: '2026-09-23' }, now)).toBe('2 h on Wed 23 Sep');
    expect(logTimeHeadline({ hours: 6, date: '2026-09-29', crewName: 'Jake Smith' }, now)).toBe('Jake Smith · 6 h yesterday');
  });
});
