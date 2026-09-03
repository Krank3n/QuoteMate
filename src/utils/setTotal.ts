/**
 * Set a document's customer-facing total to a figure the tradie said.
 *
 * "Make the total one thousand two hundred and thirty-two" is how a tradie
 * prices a job: they know the number, the breakdown is bookkeeping. Before
 * this, Mate could only reach the total sideways — through markup and rates —
 * and in a real invoice conversation (an electrician, 3 Sep 2026) it read out
 * $1,260 and then $1,416 while the tradie wanted $1,232, and the invoice went
 * out at $1,360.80 after they gave up and edited it by hand.
 *
 * Mechanism, in order:
 *   1. Labour absorbs the difference when the document has labour — that is
 *      what a tradie does themselves. Hourly labour moves through
 *      `laborExtraHours` (the existing "nudge the labour without rebalancing
 *      the sections" primitive, already rendered as "Labour adjustment" on
 *      the customer copy) or `laborHours` when there are no sections; labour
 *      that is all lump sums moves the largest lump-sum section's typed
 *      figure. Labour never goes below zero.
 *   2. Otherwise a lump-sum work item named "Price adjustment" carries the
 *      difference (negative for a discount). One such line per document — a
 *      second set-total moves it rather than stacking another.
 *
 * The target is what the customer reads: in exclusive mode the pre-GST figure
 * is target ÷ 1.1, in inclusive mode and for a non-registered business it is
 * the target itself. Markup never applies to the moved money (a lump sum is a
 * price the tradie typed — shared/document/lumpSum.ts), but labour markup and
 * the travel percentage DO scale an hourly-labour move, so the move is solved
 * for the exact total rather than applied naively.
 *
 * A target below the materials alone is refused: below that the tradie loses
 * money on gear, which is never what "make it $X" meant.
 *
 * Pure. The store applies the returned patch and recalculates.
 */
import type { Material, QuoteSection } from '../types';
import { calculateDocumentTotals, roundToTwoDecimals } from './documentCalculator';
import { resolveGstMode } from '../../shared/document/gstMode';
import { isLumpSumSection, isWorkItem, lumpSumLabourTotal } from '../../shared/document/lumpSum';
import { generateId } from './generateId';
import { withOrigin } from './materialOrigin';
import { formatCurrency } from './documentCalculator';

export const PRICE_ADJUSTMENT_NAME = 'Price adjustment';

/** Loose on purpose: a legacy Quote, an Invoice and a unified Document all fit. */
export interface SetTotalSource {
  materials?: Material[] | null;
  sections?: QuoteSection[] | null;
  laborRate?: number;
  laborHours?: number;
  laborExtraHours?: number;
  markup?: number;
  laborMarkup?: number;
  travelAdjustment?: number;
  pricesIncludeGst?: boolean;
  gstRegistered?: boolean;
}

export type SetTotalPlan =
  | { mechanism: 'none'; currentTotal: number; targetTotal: number }
  | {
      mechanism: 'labour';
      currentTotal: number;
      targetTotal: number;
      /** The document's labour subtotal before and after, in its own GST basis. */
      labourBefore: number;
      labourAfter: number;
      via: 'extraHours' | 'hours' | 'lumpSum';
      sectionId?: string;
    }
  | {
      mechanism: 'adjustment';
      currentTotal: number;
      targetTotal: number;
      /** The adjustment line's price after the move, in the document's GST basis. */
      amount: number;
      /** True when a "Price adjustment" line already exists and is being moved. */
      existing: boolean;
    };

export type SetTotalPlanResult =
  | { ok: true; plan: SetTotalPlan }
  | { ok: false; reason: 'bad_target' | 'below_materials'; message: string; floor?: number };

/** The fields the store merges onto the document before recalculating. */
export interface SetTotalPatch {
  laborExtraHours?: number;
  laborHours?: number;
  sections?: QuoteSection[];
  materials?: Material[];
}

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const CENT = 0.005;

function totalsOf(source: SetTotalSource) {
  return calculateDocumentTotals(
    (source.materials ?? []) as Material[],
    num(source.laborRate),
    num(source.laborHours),
    num(source.markup),
    num(source.travelAdjustment),
    (source.sections ?? undefined) as QuoteSection[] | undefined,
    num(source.laborMarkup ?? source.markup),
    num(source.laborExtraHours),
    source.pricesIncludeGst === true,
    source.gstRegistered !== false,
  );
}

/** ×1.1 between the document's own basis and what the customer reads, or ×1. */
function gstFactor(source: SetTotalSource): number {
  return resolveGstMode(source) === 'exclusive' ? 1.1 : 1;
}

/** Σ real materials (not work items, not a previous adjustment) — what the gear costs. */
function materialsCost(materials: Material[]): number {
  return materials.reduce((sum, m) => (isWorkItem(m) ? sum : sum + num(m.totalPrice)), 0);
}

function findAdjustment(materials: Material[]): Material | undefined {
  return materials.find((m) => isWorkItem(m) && m.name === PRICE_ADJUSTMENT_NAME);
}

/**
 * Work out how the document gets to `targetTotal`, without changing it. The
 * card shows this; the validator refuses on it.
 */
export function planSetTotal(source: SetTotalSource, targetTotal: number): SetTotalPlanResult {
  const target = Number(targetTotal);
  if (!Number.isFinite(target) || target <= 0) {
    return { ok: false, reason: 'bad_target', message: 'The total has to be a dollar figure above zero.' };
  }
  const materials = (source.materials ?? []) as Material[];
  const sections = (source.sections ?? []) as QuoteSection[];
  const factor = gstFactor(source);
  const totals = totalsOf(source);
  const currentTotal = totals.total;
  const targetRounded = roundToTwoDecimals(target);

  const floor = roundToTwoDecimals(materialsCost(materials) * factor);
  if (targetRounded < floor - CENT) {
    return {
      ok: false,
      reason: 'below_materials',
      floor,
      message: `That's under the materials — they come to ${formatCurrency(floor)} on their own, so ${formatCurrency(floor)} is as low as this one goes.`,
    };
  }

  const delta = roundToTwoDecimals(targetRounded - currentTotal);
  if (Math.abs(delta) < CENT) {
    return { ok: true, plan: { mechanism: 'none', currentTotal, targetTotal: targetRounded } };
  }
  const deltaPre = delta / factor;
  const travelPct = num(source.travelAdjustment) / 100;
  const labourMarkupPct = num(source.laborMarkup ?? source.markup) / 100;
  const rate = num(source.laborRate);
  const labourTotal = totals.laborTotal;
  const lumpLabour = lumpSumLabourTotal(sections);
  const hourlyLabour = Math.max(0, labourTotal - lumpLabour);

  // 1a. Hourly labour, moved through extra hours (sections) or the hours field.
  if (hourlyLabour > 0 && rate > 0) {
    const deltaLabour = deltaPre / (1 + labourMarkupPct + travelPct);
    if (hourlyLabour + deltaLabour >= -CENT) {
      return {
        ok: true,
        plan: {
          mechanism: 'labour',
          currentTotal,
          targetTotal: targetRounded,
          labourBefore: roundToTwoDecimals(labourTotal),
          labourAfter: roundToTwoDecimals(labourTotal + deltaLabour),
          via: sections.length > 0 ? 'extraHours' : 'hours',
        },
      };
    }
  }

  // 1b. Labour that is all lump sums: move the biggest one (it's a typed figure).
  if (lumpLabour > 0) {
    const biggest = sections
      .filter((s) => isLumpSumSection(s))
      .sort((a, b) => num(b.laborTotal) - num(a.laborTotal))[0];
    const deltaLump = deltaPre / (1 + travelPct);
    if (biggest && num(biggest.laborTotal) + deltaLump >= -CENT) {
      return {
        ok: true,
        plan: {
          mechanism: 'labour',
          currentTotal,
          targetTotal: targetRounded,
          labourBefore: roundToTwoDecimals(labourTotal),
          labourAfter: roundToTwoDecimals(labourTotal + deltaLump),
          via: 'lumpSum',
          sectionId: biggest.id,
        },
      };
    }
  }

  // 2. A lump-sum "Price adjustment" line carries it.
  const existing = findAdjustment(materials);
  const amount = roundToTwoDecimals(num(existing?.price) + deltaPre / (1 + travelPct));
  return {
    ok: true,
    plan: { mechanism: 'adjustment', currentTotal, targetTotal: targetRounded, amount, existing: !!existing },
  };
}

function adjustmentLine(price: number, existing: Material | undefined): Material {
  if (existing) return { ...existing, price, totalPrice: price, quantity: 1, unit: 'each' };
  return withOrigin(
    {
      id: generateId(),
      name: PRICE_ADJUSTMENT_NAME,
      kind: 'work',
      quantity: 1,
      unit: 'each',
      price,
      totalPrice: price,
      manualPriceOverride: true,
      pricingSource: 'manual',
    } as Material,
    'manual',
  );
}

function patchFor(source: SetTotalSource, plan: SetTotalPlan, typedFigure: number): SetTotalPatch {
  const materials = (source.materials ?? []) as Material[];
  const sections = (source.sections ?? []) as QuoteSection[];
  if (plan.mechanism === 'none') return {};
  if (plan.mechanism === 'adjustment') {
    const existing = findAdjustment(materials);
    const line = adjustmentLine(typedFigure, existing);
    return {
      materials: existing ? materials.map((m) => (m.id === existing.id ? line : m)) : [...materials, line],
    };
  }
  if (plan.via === 'lumpSum') {
    return {
      sections: sections.map((s) =>
        s.id === plan.sectionId ? { ...s, laborTotal: typedFigure, laborHours: 0, laborHoursTotal: 0, laborRate: 0 } : s,
      ),
    };
  }
  const rate = num(source.laborRate);
  const deltaLabour = plan.labourAfter - plan.labourBefore;
  if (plan.via === 'extraHours') {
    return { laborExtraHours: num(source.laborExtraHours) + deltaLabour / rate };
  }
  return { laborHours: Math.max(0, num(source.laborHours) + deltaLabour / rate) };
}

/** One clause for the "[context]" line and the voice read-back: what moved. */
export function describeSetTotalPlan(plan: SetTotalPlan): string {
  if (plan.mechanism === 'labour') {
    return `labour ${formatCurrency(plan.labourBefore)} → ${formatCurrency(plan.labourAfter)}`;
  }
  if (plan.mechanism === 'adjustment') {
    return `${plan.existing ? 'the' : 'a new'} "${PRICE_ADJUSTMENT_NAME}" line at ${formatCurrency(plan.amount)}`;
  }
  return 'nothing — it was already there';
}

export type SetTotalApplyResult =
  | { ok: true; plan: SetTotalPlan; patch: SetTotalPatch; total: number }
  | { ok: false; reason: 'bad_target' | 'below_materials'; message: string; floor?: number };

/**
 * Plan, apply and verify. The typed figures (a lump sum, an adjustment line)
 * are rounded to cents, so the naive solution can land a cent off the target
 * after GST and travel — the candidates a cent either side are tried and the
 * one that reproduces the target exactly wins.
 */
export function applySetTotal(source: SetTotalSource, targetTotal: number): SetTotalApplyResult {
  const planned = planSetTotal(source, targetTotal);
  if (!planned.ok) return planned;
  const { plan } = planned;
  if (plan.mechanism === 'none') return { ok: true, plan, patch: {}, total: plan.currentTotal };

  const base =
    plan.mechanism === 'adjustment'
      ? plan.amount
      : plan.via === 'lumpSum'
        ? roundToTwoDecimals(
            num((source.sections ?? []).find((s) => s.id === plan.sectionId)?.laborTotal) + (plan.labourAfter - plan.labourBefore),
          )
        : plan.labourAfter;
  const typed = plan.mechanism === 'labour' && plan.via !== 'lumpSum';
  const candidates = typed ? [base] : [base, base - 0.01, base + 0.01, base - 0.02, base + 0.02];

  let best: { patch: SetTotalPatch; total: number; miss: number } | undefined;
  for (const candidate of candidates) {
    const figure = roundToTwoDecimals(candidate);
    const patch = patchFor(source, plan, figure);
    const total = totalsOf({ ...source, ...patch }).total;
    const miss = Math.abs(total - plan.targetTotal);
    if (!best || miss < best.miss) best = { patch, total, miss };
    if (miss < CENT) break;
  }
  return { ok: true, plan, patch: best!.patch, total: best!.total };
}
