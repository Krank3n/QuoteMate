/**
 * The cost line on a job's Log time sheet: what the crew's approved hours
 * cost (super and on-costs in) against the labour on the job's quote or
 * invoice. Costing only — the owner's own hours aren't costed, and the
 * line says so rather than letting a part-costed job look cheap.
 */

import type { CrewMember, TimeEntry } from '../../shared/time/types';
import { formatHours } from '../../shared/time/hours';
import { labourCostOf, onCostPercentOf, type LabourCostSettings } from '../../shared/time/labourCost';
import { formatCurrency } from './documentCalculator';

export interface JobLabourCostLine {
  /** "Crew cost about $1,310 incl. super · labour invoiced $2,400" */
  headline: string;
  /** "Plus your 12 h, not costed · Mia's 4 h have no cost rate (set it in Crew)" */
  notes: string[];
  /** Crew cost is more than the labour on the quote or invoice. */
  overCharged: boolean;
}

export function jobLabourCostLine(
  entries: TimeEntry[],
  crew: CrewMember[] | undefined,
  settings: LabourCostSettings | undefined,
  doc: { laborTotal?: number; type?: string } | null | undefined,
): JobLabourCostLine | null {
  const cost = labourCostOf(entries, crew, settings);
  // Nothing to say until some crew time has a cost — an owner-only job
  // has no wages in it.
  if (cost.costedHours === 0 && cost.uncostedCrewHours === 0) return null;
  const charged = Number(doc?.laborTotal) || 0;
  const loadingWord = onCostPercentOf(settings) > 0 ? 'super & on-costs' : 'super';
  const parts = [
    cost.costedHours === 0
      ? 'Crew cost unknown'
      : cost.superAndOnCosts > 0
        ? `Crew cost about ${formatCurrency(cost.total)} incl. ${loadingWord}`
        : `Crew cost ${formatCurrency(cost.total)}`,
  ];
  if (charged > 0 && cost.costedHours > 0) parts.push(`${doc?.type === 'invoice' ? 'labour invoiced' : 'labour quoted'} ${formatCurrency(charged)}`);
  const notes: string[] = [];
  if (cost.ownerHours > 0) notes.push(`Plus your ${formatHours(cost.ownerHours)}, not costed`);
  if (cost.uncostedCrewHours > 0) {
    const who = cost.uncostedNames.length === 1 ? `${cost.uncostedNames[0]}'s` : `${cost.uncostedNames.join(' and ')}'s`;
    notes.push(`${who} ${formatHours(cost.uncostedCrewHours)} ${cost.uncostedCrewHours === 1 ? 'has' : 'have'} no cost rate — set it in Settings → Crew`);
  }
  return { headline: parts.join(' · '), notes, overCharged: charged > 0 && cost.total > charged };
}
