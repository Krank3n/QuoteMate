/**
 * Every Insights chart counted the legacy `quotes` collection and treated
 * `status === 'accepted' || 'completed'` as won — so nothing showed until the
 * legacy mirror caught up, and a job dropped out of "won" the moment it was
 * invoiced. Two of them were labelled as money ("Revenue Trend", "Revenue
 * Earned") but summed accepted quote TOTALS, so Insights and the dashboard
 * reported different figures for the same month.
 *
 * These pin the source of truth, the stage boundaries, and the money/value
 * distinction that the two revenue charts got wrong.
 */
import { describe, it, expect } from 'vitest';

import {
  costBreakdown,
  monthComparison,
  monthlyRevenue,
  pipelineSummary,
} from './insightsStats';

const AUG = new Date(2026, 7, 14);
const AUG_5 = new Date(2026, 7, 5).getTime();
const AUG_20 = new Date(2026, 7, 20).getTime();
const JUL_10 = new Date(2026, 6, 10).getTime();

function doc(over: Record<string, any> = {}): any {
  return {
    id: 'd1',
    type: 'quote',
    stage: 'draft',
    total: 1000,
    materialsSubtotal: 600,
    laborTotal: 300,
    markupAmount: 100,
    createdAt: AUG_5,
    updatedAt: AUG_5,
    payments: [],
    ...over,
  };
}

const paid = (amount: number, at: number) => [{ id: 'p', amount, paidAt: at }];

describe('pipelineSummary', () => {
  it('REGRESSION: an invoiced job still counts as won', () => {
    const summary = pipelineSummary([
      doc({ id: 'a', stage: 'invoice_sent' }),
      doc({ id: 'b', stage: 'quote_rejected' }),
    ]);
    expect(summary.winRate).toBe(50);
  });

  it('splits accepted, invoiced and paid into their own buckets', () => {
    const summary = pipelineSummary([
      doc({ id: 'a', stage: 'quote_accepted' }),
      doc({ id: 'b', stage: 'invoice_sent' }),
      doc({ id: 'c', stage: 'partially_paid' }),
      doc({ id: 'd', stage: 'paid' }),
    ]);
    const counts = Object.fromEntries(summary.buckets.map((b) => [b.key, b.count]));
    expect(counts).toMatchObject({ accepted: 1, invoiced: 2, paid: 1 });
    expect(summary.winRate).toBe(100);
  });

  it('leaves cancelled work out of the funnel and its denominator', () => {
    const summary = pipelineSummary([
      doc({ id: 'a', stage: 'draft' }),
      doc({ id: 'b', stage: 'cancelled' }),
    ]);
    expect(summary.total).toBe(1);
    expect(summary.buckets.find((b) => b.key === 'draft')!.ratio).toBe(1);
  });

  it('reports a 0% win rate when nothing has been decided', () => {
    expect(pipelineSummary([doc({ stage: 'quote_sent' })]).winRate).toBe(0);
  });

  it('survives an empty list', () => {
    const summary = pipelineSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.winRate).toBe(0);
    expect(summary.buckets.every((b) => b.count === 0 && b.ratio === 0)).toBe(true);
  });
});

describe('monthlyRevenue', () => {
  it('REGRESSION: reports money received, not the value of accepted quotes', () => {
    const docs = [
      doc({ id: 'a', stage: 'quote_accepted', total: 50000, acceptedAt: AUG_5 }),
      doc({ id: 'b', stage: 'paid', total: 900, acceptedAt: AUG_5, payments: paid(900, AUG_5) }),
    ];
    const august = monthlyRevenue(docs, AUG).at(-1)!;
    expect(august.revenue).toBe(900);
  });

  it('counts jobs won in the month alongside the money', () => {
    const docs = [
      doc({ id: 'a', stage: 'quote_accepted', acceptedAt: AUG_5 }),
      doc({ id: 'b', stage: 'paid', acceptedAt: JUL_10, payments: paid(500, JUL_10) }),
    ];
    const months = monthlyRevenue(docs, AUG);
    expect(months.at(-1)!.count).toBe(1);
    expect(months.at(-2)!.count).toBe(1);
    expect(months.at(-2)!.revenue).toBe(500);
  });

  it('returns the requested number of months, oldest first', () => {
    const months = monthlyRevenue([], AUG, 6);
    expect(months).toHaveLength(6);
    expect(months.at(-1)!.shortLabel).toBe('Aug');
    expect(months[0].shortLabel).toBe('Mar');
  });

  it('falls back to updatedAt for documents predating acceptedAt', () => {
    const legacy = [doc({ stage: 'quote_accepted', acceptedAt: undefined, updatedAt: AUG_20 })];
    expect(monthlyRevenue(legacy, AUG).at(-1)!.count).toBe(1);
  });
});

describe('monthComparison', () => {
  it('REGRESSION: revenue is money received, and an invoiced job still counts as won', () => {
    const docs = [
      doc({ id: 'a', stage: 'invoice_sent', total: 4000, acceptedAt: AUG_5 }),
      doc({ id: 'b', stage: 'paid', total: 1000, acceptedAt: AUG_5, payments: paid(1000, AUG_5) }),
    ];
    const { current } = monthComparison(docs, AUG);
    expect(current.jobsWon).toBe(2);
    expect(current.revenueEarned).toBe(1000);
  });

  it('averages the VALUE of jobs won, not the cash collected', () => {
    const docs = [
      doc({ id: 'a', stage: 'quote_accepted', total: 3000, acceptedAt: AUG_5 }),
      doc({ id: 'b', stage: 'quote_accepted', total: 1000, acceptedAt: AUG_5 }),
    ];
    expect(monthComparison(docs, AUG).current.avgJobValue).toBe(2000);
  });

  it('counts quotes created in the month regardless of stage', () => {
    const docs = [doc({ createdAt: AUG_5 }), doc({ id: 'b', createdAt: JUL_10 })];
    const { current, previous } = monthComparison(docs, AUG);
    expect(current.quotesCreated).toBe(1);
    expect(previous.quotesCreated).toBe(1);
  });

  it('reports zeros for a month with nothing in it', () => {
    expect(monthComparison([], AUG).current).toEqual({
      quotesCreated: 0, jobsWon: 0, revenueEarned: 0, avgJobValue: 0,
    });
  });
});

describe('costBreakdown', () => {
  it('REGRESSION: includes an invoiced job, which the legacy status dropped', () => {
    const breakdown = costBreakdown([doc({ stage: 'invoice_sent' })]);
    expect(breakdown.jobCount).toBe(1);
    expect(breakdown.materials).toBe(600);
    expect(breakdown.labor).toBe(300);
    expect(breakdown.markup).toBe(100);
  });

  it('ignores quotes that were never won', () => {
    const breakdown = costBreakdown([doc({ stage: 'draft' }), doc({ id: 'b', stage: 'quote_sent' })]);
    expect(breakdown.jobCount).toBe(0);
  });

  it('floors the total at 1 so callers can divide by it', () => {
    expect(costBreakdown([]).total).toBe(1);
  });

  it('treats missing cost fields as zero rather than NaN', () => {
    const breakdown = costBreakdown([
      doc({ stage: 'paid', materialsSubtotal: undefined, laborTotal: undefined, markupAmount: undefined }),
    ]);
    expect(breakdown.materials).toBe(0);
    expect(breakdown.jobCount).toBe(1);
  });
});
