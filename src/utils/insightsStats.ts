/**
 * The maths behind the Insights charts.
 *
 * Every one of them used to read the legacy `quotes` collection and treat
 * `status === 'accepted' || 'completed'` as "won" — the same bug the dashboard
 * tiles had (see quickStats): nothing counts until the legacy mirror catches
 * up, and a job stops counting as won the moment you invoice it.
 *
 * Two of these charts are also labelled as money — "Revenue Trend" and
 * "Revenue Earned" — but summed the TOTAL of accepted quotes. That's accepted
 * value, not revenue: a quote accepted with nothing paid counted in full, and
 * it disagreed with the dashboard's "Earned this month" on the same month.
 * Money now comes from the payment ledger via earnedInMonth, so the two
 * screens agree.
 *
 * Kept as pure functions so the numbers are testable without rendering.
 */

import { endOfMonth, format, isWithinInterval, startOfMonth, subMonths } from 'date-fns';

import type { Document } from '../types/document';
import { countsInPipeline, isWon, wonAt } from './documentStages';
import { earnedInMonth } from './monthlyEarnings';

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- pipeline

export type PipelineKey = 'draft' | 'sent' | 'accepted' | 'invoiced' | 'paid' | 'rejected';

export interface PipelineBucket {
  key: PipelineKey;
  count: number;
  /** Share of the (non-cancelled) pipeline, 0–1. */
  ratio: number;
}

export interface PipelineSummary {
  buckets: PipelineBucket[];
  /** Documents counted — cancelled work is excluded. */
  total: number;
  /** Won as a percentage of decided (won + rejected). 0 when nothing decided. */
  winRate: number;
}

const PIPELINE_ORDER: PipelineKey[] = ['draft', 'sent', 'accepted', 'invoiced', 'paid', 'rejected'];

/**
 * There is no 'completed' document stage — the legacy funnel's Draft/Sent/
 * Accepted/Completed/Rejected becomes the lifecycle the rest of the app
 * already shows: invoiced and paid are distinct steps past accepted.
 */
function pipelineKey(stage: Document['stage']): PipelineKey | null {
  switch (stage) {
    case 'draft': return 'draft';
    case 'quote_sent': return 'sent';
    case 'quote_accepted': return 'accepted';
    case 'invoice_sent':
    case 'partially_paid': return 'invoiced';
    case 'paid': return 'paid';
    case 'quote_rejected': return 'rejected';
    default: return null; // cancelled
  }
}

export function pipelineSummary(documents: Document[]): PipelineSummary {
  const counts = new Map<PipelineKey, number>(PIPELINE_ORDER.map((k) => [k, 0]));
  let total = 0;
  let won = 0;
  let rejected = 0;

  for (const doc of documents || []) {
    if (!countsInPipeline(doc)) continue;
    const key = pipelineKey(doc.stage);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
    if (isWon(doc.stage)) won++;
    if (key === 'rejected') rejected++;
  }

  const decided = won + rejected;
  return {
    buckets: PIPELINE_ORDER.map((key) => {
      const count = counts.get(key) ?? 0;
      return { key, count, ratio: total > 0 ? count / total : 0 };
    }),
    total,
    winRate: decided > 0 ? Math.round((won / decided) * 100) : 0,
  };
}

// ----------------------------------------------------------- revenue trend

export interface MonthRevenue {
  label: string;       // "August 2026"
  shortLabel: string;  // "Aug"
  revenue: number;     // money actually received that month
  count: number;       // jobs won that month
  start: Date;
  end: Date;
}

export function monthlyRevenue(
  documents: Document[],
  now: Date | number = Date.now(),
  monthsBack = 6,
): MonthRevenue[] {
  const ref = now instanceof Date ? now : new Date(now);
  const months: MonthRevenue[] = [];

  for (let i = monthsBack - 1; i >= 0; i--) {
    const monthDate = subMonths(ref, i);
    const start = startOfMonth(monthDate);
    const end = endOfMonth(monthDate);

    let count = 0;
    for (const doc of documents || []) {
      if (!doc || !isWon(doc.stage)) continue;
      const at = wonAt(doc);
      if (at && isWithinInterval(new Date(at), { start, end })) count++;
    }

    months.push({
      label: format(monthDate, 'MMMM yyyy'),
      shortLabel: format(monthDate, 'MMM'),
      revenue: earnedInMonth(documents, monthDate),
      count,
      start,
      end,
    });
  }

  return months;
}

// -------------------------------------------------------- month comparison

export interface MonthTotals {
  quotesCreated: number;
  jobsWon: number;
  /** Money received in the month. */
  revenueEarned: number;
  /** Average value of the jobs won that month (job value, not cash). */
  avgJobValue: number;
}

function totalsForMonth(documents: Document[], monthDate: Date): MonthTotals {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const within = (ms: number) => !!ms && isWithinInterval(new Date(ms), { start, end });

  let quotesCreated = 0;
  let jobsWon = 0;
  let wonValue = 0;

  for (const doc of documents || []) {
    if (!doc) continue;
    if (within(Number(doc.createdAt))) quotesCreated++;
    if (isWon(doc.stage) && within(wonAt(doc))) {
      jobsWon++;
      wonValue += Number(doc.total) || 0;
    }
  }

  return {
    quotesCreated,
    jobsWon,
    revenueEarned: earnedInMonth(documents, monthDate),
    avgJobValue: jobsWon > 0 ? round2(wonValue / jobsWon) : 0,
  };
}

export function monthComparison(
  documents: Document[],
  now: Date | number = Date.now(),
): { current: MonthTotals; previous: MonthTotals } {
  const ref = now instanceof Date ? now : new Date(now);
  return {
    current: totalsForMonth(documents, ref),
    previous: totalsForMonth(documents, subMonths(ref, 1)),
  };
}

// --------------------------------------------------------- cost breakdown

export interface CostBreakdown {
  materials: number;
  labor: number;
  markup: number;
  /** Sum of the three, floored at 1 so callers can divide safely. */
  total: number;
  jobCount: number;
}

export function costBreakdown(documents: Document[]): CostBreakdown {
  let materials = 0;
  let labor = 0;
  let markup = 0;
  let jobCount = 0;

  for (const doc of documents || []) {
    if (!doc || !isWon(doc.stage)) continue;
    materials += Number(doc.materialsSubtotal) || 0;
    labor += Number(doc.laborTotal) || 0;
    markup += Number(doc.markupAmount) || 0;
    jobCount++;
  }

  return {
    materials: round2(materials),
    labor: round2(labor),
    markup: round2(markup),
    total: Math.max(round2(materials + labor + markup), 1),
    jobCount,
  };
}
