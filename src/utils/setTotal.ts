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
import type { Document } from '../types/document';
import { finiteNumber as num, formatCurrency, roundToTwoDecimals, updateDocumentCalculations } from './documentCalculator';
import { resolveGstMode, type GstMode } from '../../shared/document/gstMode';
import { isLumpSumSection, isWorkItem, lumpSumLabourTotal, markupableMaterialsTotal } from '../../shared/document/lumpSum';
import { generateId } from './generateId';
import { withOrigin } from './materialOrigin';

/**
 * The customer reads the line, so it is named for what it is to them: money
 * off is a "Discount"; money on is a "Price adjustment" (the tradie can rename
 * it once they say what it's for). Both names are recognised as THE
 * adjustment line, so a second set-total moves it rather than stacking one.
 */
export const PRICE_ADJUSTMENT_NAME = 'Price adjustment';
export const DISCOUNT_NAME = 'Discount';
const ADJUSTMENT_NAMES: ReadonlySet<string> = new Set([PRICE_ADJUSTMENT_NAME, DISCOUNT_NAME]);
export const adjustmentLineName = (amount: number): string => (amount < 0 ? DISCOUNT_NAME : PRICE_ADJUSTMENT_NAME);

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
      /** The document's labour subtotal before and after, in its own GST basis — rounded, for display. */
      labourBefore: number;
      labourAfter: number;
      /** The exact dollars to move, unrounded — the patch is derived from this, never from the display figures. */
      deltaLabour: number;
      via: 'extraHours' | 'hours' | 'lumpSum';
      sectionId?: string;
    }
  | {
      mechanism: 'adjustment';
      currentTotal: number;
      targetTotal: number;
      /** The adjustment line's price after the move, in the document's GST basis. */
      amount: number;
      /** True when an adjustment line already exists and is being moved. */
      existing: boolean;
    };

export type SetTotalPlanResult =
  | { ok: true; plan: SetTotalPlan }
  | { ok: false; reason: 'bad_target' | 'below_materials'; message: string; floor?: number };

/** The fields the store merges onto the document before recalculating. */
export interface SetTotalPatch {
  laborExtraHours?: number;
  laborHours?: number;
  /** Stamped only when the document's own rate was 0 and the sections carry one. */
  laborRate?: number;
  sections?: QuoteSection[];
  materials?: Material[];
}

/**
 * The $/hour the extra-hours move runs at: the document's rate, or — when
 * that was never stamped — the rate the hourly sections carry. The calculator
 * prices extra hours at the DOCUMENT rate, so a 0 there would have sent a
 * document with $702 of sectioned labour to a visible Discount line instead.
 */
function effectiveRate(source: SetTotalSource, sections: QuoteSection[]): number {
  const own = num(source.laborRate);
  if (own > 0) return own;
  const section = sections.find((s) => !isLumpSumSection(s) && num(s.laborRate) > 0);
  return section ? num(section.laborRate) : 0;
}

const CENT = 0.005;

/** The totals exactly as the store will persist them — the same function, so plan and verify can't drift from the save. */
const totalsOf = (source: SetTotalSource) => updateDocumentCalculations(source as unknown as Document);

/** ×1.1 between the document's own basis and what the customer reads, or ×1. */
function gstFactor(source: SetTotalSource): number {
  return resolveGstMode(source) === 'exclusive' ? 1.1 : 1;
}

function findAdjustment(materials: Material[]): Material | undefined {
  return materials.find((m) => isWorkItem(m) && ADJUSTMENT_NAMES.has(m.name));
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

  // Σ real materials — work items (and a previous adjustment) are not gear.
  const floor = roundToTwoDecimals(markupableMaterialsTotal(totals.materialsSubtotal, materials) * factor);
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
  const rate = effectiveRate(source, sections);
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
          deltaLabour,
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
          deltaLabour: deltaLump,
          via: 'lumpSum',
          sectionId: biggest.id,
        },
      };
    }
  }

  // 2. A lump-sum "Price adjustment" line carries it.
  const existing = findAdjustment(materials);
  // What the line contributes today is its total (a legacy row can carry a
  // quantity); the new line is always minted at quantity 1.
  const amount = roundToTwoDecimals(num(existing?.totalPrice) + deltaPre / (1 + travelPct));
  return {
    ok: true,
    plan: { mechanism: 'adjustment', currentTotal, targetTotal: targetRounded, amount, existing: !!existing },
  };
}

function adjustmentLine(price: number, existing: Material | undefined): Material {
  if (existing) return { ...existing, name: adjustmentLineName(price), price, totalPrice: price, quantity: 1, unit: 'each' };
  return withOrigin(
    {
      id: generateId(),
      name: adjustmentLineName(price),
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

/**
 * The patch for a plan. `figure` is the typed 2-dp dollar figure for the
 * lump-sum and adjustment paths, or the exact (unrounded) labour delta for
 * the hourly paths — those are continuous, so nothing is rounded on the way.
 */
function patchFor(source: SetTotalSource, plan: SetTotalPlan, figure: number): SetTotalPatch {
  const materials = (source.materials ?? []) as Material[];
  const sections = (source.sections ?? []) as QuoteSection[];
  if (plan.mechanism === 'none') return {};
  if (plan.mechanism === 'adjustment') {
    const existing = findAdjustment(materials);
    const line = adjustmentLine(figure, existing);
    return {
      materials: existing ? materials.map((m) => (m.id === existing.id ? line : m)) : [...materials, line],
    };
  }
  if (plan.via === 'lumpSum') {
    return {
      sections: sections.map((s) =>
        s.id === plan.sectionId ? { ...s, laborTotal: figure, laborHours: 0, laborHoursTotal: 0, laborRate: 0 } : s,
      ),
    };
  }
  const rate = effectiveRate(source, sections);
  const stampRate = num(source.laborRate) > 0 ? {} : { laborRate: rate };
  if (plan.via === 'extraHours') {
    return { ...stampRate, laborExtraHours: num(source.laborExtraHours) + figure / rate };
  }
  return { ...stampRate, laborHours: Math.max(0, num(source.laborHours) + figure / rate) };
}

/**
 * One clause for the "[context]" line and the voice read-back: what moved.
 * Labour is named, never quantified — the labour figure the tradie and the
 * customer see rolls the labour markup in, so a base-labour number here
 * would be a third figure nobody can find on the screen.
 */
export function describeSetTotalPlan(plan: SetTotalPlan): string {
  if (plan.mechanism === 'labour') {
    return plan.labourAfter < plan.labourBefore ? 'off the labour' : 'onto the labour';
  }
  if (plan.mechanism === 'adjustment') {
    const name = adjustmentLineName(plan.amount);
    return `${plan.existing ? 'the' : 'a new'} "${name}" line at ${formatCurrency(plan.amount)}`;
  }
  return 'nothing — it was already there';
}

/** The GST basis the target is read in, for the card. */
export function setTotalGstMode(source: SetTotalSource): GstMode {
  return resolveGstMode(source);
}

export type SetTotalApplyResult =
  | { ok: true; plan: SetTotalPlan; patch: SetTotalPatch; total: number }
  | { ok: false; reason: 'bad_target' | 'below_materials'; message: string; floor?: number };

/**
 * Plan, apply and verify.
 *
 * Hourly labour is continuous, so the move is refined against the very
 * totals the store will persist until the stored total equals the target:
 * the first solve works from the ROUNDED current total and lands a cent off
 * whenever labour markup, travel or exclusive GST scale the move, so each
 * pass feeds the residual back through the same factors (three passes cover
 * every case tried; a fourth is a guard).
 *
 * A lump sum and an adjustment line are typed 2-dp figures, so a target can
 * sit between two reachable totals (in exclusive mode a cent on the line is
 * 1.1c at the bottom); the candidates a cent or two either side are tried
 * and the nearest wins. `total` is what will actually be stored — the caller
 * reports that, never the target.
 */
export function applySetTotal(source: SetTotalSource, targetTotal: number): SetTotalApplyResult {
  const planned = planSetTotal(source, targetTotal);
  if (!planned.ok) return planned;
  const { plan } = planned;
  if (plan.mechanism === 'none') return { ok: true, plan, patch: {}, total: plan.currentTotal };

  const settle = (figure: number) => {
    const patch = patchFor(source, plan, figure);
    const total = totalsOf({ ...source, ...patch }).total;
    return { patch, total, miss: Math.abs(total - plan.targetTotal) };
  };

  if (plan.mechanism === 'labour' && plan.via !== 'lumpSum') {
    const factor = gstFactor(source);
    const scale = 1 + num(source.laborMarkup ?? source.markup) / 100 + num(source.travelAdjustment) / 100;
    let figure = plan.deltaLabour;
    let last = settle(figure);
    let best = last;
    for (let pass = 0; pass < 4 && best.miss >= CENT; pass++) {
      figure += (plan.targetTotal - last.total) / factor / scale;
      last = settle(figure);
      if (last.miss < best.miss) best = last;
    }
    return { ok: true, plan, patch: best.patch, total: best.total };
  }

  const base =
    plan.mechanism === 'adjustment'
      ? plan.amount
      : roundToTwoDecimals(num((source.sections ?? []).find((s) => s.id === plan.sectionId)?.laborTotal) + plan.deltaLabour);
  let best: ReturnType<typeof settle> | undefined;
  for (const candidate of [base, base - 0.01, base + 0.01, base - 0.02, base + 0.02]) {
    const next = settle(roundToTwoDecimals(candidate));
    if (!best || next.miss < best.miss) best = next;
    if (best.miss < CENT) break;
  }
  return { ok: true, plan, patch: best!.patch, total: best!.total };
}
