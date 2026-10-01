/**
 * What labour really cost — costing, not payroll.
 *
 * A crew member's cost per hour, plus super and any on-costs (workers comp,
 * payroll tax, leave) as a loading on top. Contractors invoice their whole
 * cost, so they carry no loading. The owner's own hours aren't costed: for
 * a sole trader that time is the profit, so it's counted apart.
 *
 * Super is applied to every hour (strictly it's on ordinary time only) —
 * close enough for costing a job, and the app says "about".
 *
 * Only counted (approved) time costs anything. Time that isn't charged to
 * the customer still costs wages, so it's in.
 */

import type { CrewMember, TimeEntry } from './types';
import { crewIdOf, isCounted } from './hours';

/** The super guarantee rate (from 1 July 2025). */
export const DEFAULT_SUPER_PERCENT = 12;

export interface LabourCostSettings {
  /** Absent = DEFAULT_SUPER_PERCENT. */
  crewSuperPercent?: number;
  /** Workers comp, payroll tax, leave… Absent = 0. */
  crewOnCostPercent?: number;
}

export interface CostStamp {
  rate: number;
  /** Super + on-costs as a fraction of the rate: 0.17 for 12% + 5%. */
  loading: number;
}

export interface LabourCost {
  /** Hours × rate. */
  wages: number;
  /** Super and on-costs on top of the wages. */
  superAndOnCosts: number;
  total: number;
  costedHours: number;
  /** The owner's own hours — counted, never costed. */
  ownerHours: number;
  /** Crew hours with no cost rate to go on. */
  uncostedCrewHours: number;
  /** Who those hours belong to, so the app can say whose rate is missing. */
  uncostedNames: string[];
}

type CrewForCost = Pick<CrewMember, 'id' | 'name' | 'costRate' | 'contractor'>;
type EntryForCost = Pick<TimeEntry, 'hours' | 'workerId' | 'status' | 'cost'> & { workerName?: string };

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : fallback);

export function superPercentOf(settings: LabourCostSettings | undefined): number {
  return pct(settings?.crewSuperPercent, DEFAULT_SUPER_PERCENT);
}

export function onCostPercentOf(settings: LabourCostSettings | undefined): number {
  return pct(settings?.crewOnCostPercent, 0);
}

/** Super + on-costs as a fraction, or 0 for a contractor. */
export function costLoading(member: Pick<CrewMember, 'contractor'>, settings: LabourCostSettings | undefined): number {
  if (member.contractor) return 0;
  return round2(superPercentOf(settings) + onCostPercentOf(settings)) / 100;
}

/** The cost to stamp on a crew member's entry, or undefined (the owner, or no rate set). */
export function costStampFor(
  entry: Pick<TimeEntry, 'workerId'>,
  crew: CrewForCost[] | undefined,
  settings: LabourCostSettings | undefined,
): CostStamp | undefined {
  const id = crewIdOf(entry);
  if (!id) return undefined;
  const member = crew?.find((c) => c.id === id);
  if (!member || !(typeof member.costRate === 'number' && member.costRate > 0)) return undefined;
  return { rate: member.costRate, loading: costLoading(member, settings) };
}

function isUsableStamp(c: unknown): c is CostStamp {
  const s = c as CostStamp | undefined;
  return !!s && typeof s.rate === 'number' && s.rate > 0 && typeof s.loading === 'number' && s.loading >= 0;
}

/** What a set of entries cost. The stamp on an entry wins over today's rate. */
export function labourCostOf(
  entries: EntryForCost[],
  crew: CrewForCost[] | undefined,
  settings: LabourCostSettings | undefined,
): LabourCost {
  let wages = 0;
  let extra = 0;
  let costedHours = 0;
  let ownerHours = 0;
  let uncostedCrewHours = 0;
  const uncosted = new Set<string>();
  for (const e of entries) {
    if (!isCounted(e) || !(e.hours > 0)) continue;
    const id = crewIdOf(e);
    if (!id) {
      ownerHours += e.hours;
      continue;
    }
    const stamp = isUsableStamp(e.cost) ? e.cost : costStampFor(e, crew, settings);
    if (!stamp) {
      uncostedCrewHours += e.hours;
      uncosted.add(crew?.find((c) => c.id === id)?.name || e.workerName || 'Crew');
      continue;
    }
    const w = e.hours * stamp.rate;
    wages += w;
    extra += w * stamp.loading;
    costedHours += e.hours;
  }
  const w = round2(wages);
  const x = round2(extra);
  return {
    wages: w,
    superAndOnCosts: x,
    total: round2(w + x),
    costedHours: round2(costedHours),
    ownerHours: round2(ownerHours),
    uncostedCrewHours: round2(uncostedCrewHours),
    uncostedNames: [...uncosted],
  };
}

/**
 * The cost an entry should carry after a write. Hours that already counted
 * for the same person keep their stamp (an edit to the note or the hours
 * isn't a pay rise); hours that start counting now, or move to someone
 * else, take today's rate. Waiting hours carry nothing until approved.
 */
export function stampedCost(
  next: Pick<TimeEntry, 'workerId' | 'status'>,
  prev: Pick<TimeEntry, 'workerId' | 'status' | 'cost'> | undefined,
  crew: CrewForCost[] | undefined,
  settings: LabourCostSettings | undefined,
): CostStamp | undefined {
  if (!isCounted(next)) return undefined;
  if (prev && isCounted(prev) && prev.workerId === next.workerId && isUsableStamp(prev.cost)) return prev.cost;
  return costStampFor(next, crew, settings);
}
