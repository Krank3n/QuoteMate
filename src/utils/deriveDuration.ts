/**
 * Derive a Job's calendar-event duration (days + hours/day) from the
 * labor fields on its primary Document.
 *
 * Why derive instead of store on the Job:
 * The tradie already entered "this is X hours / X days of work" on the
 * quote. Storing duration on the Job would mean two places to edit and
 * the inevitable drift. Cheaper to compute it each time we need to size
 * the GCal event or display the duration string.
 *
 * Defaults when no labor info is available: 1 day, 8 hours.
 */

import type { LaborUnit } from '../types';

export interface DerivedDuration {
  durationDays: number;
  hoursPerDay: number;
}

interface LaborSource {
  laborHours?: number;
  laborUnit?: LaborUnit;
  laborExtraHours?: number;
}

const DEFAULT: DerivedDuration = { durationDays: 1, hoursPerDay: 8 };
const STANDARD_DAY_HOURS = 8;

export function deriveDuration(doc?: LaborSource | null): DerivedDuration {
  if (!doc) return DEFAULT;
  const unit: LaborUnit = doc.laborUnit ?? 'hours';
  const base = Number(doc.laborHours) || 0;
  const extra = Number(doc.laborExtraHours) || 0;
  const total = base + extra;
  if (total <= 0) return DEFAULT;

  if (unit === 'days') {
    // Treat the value as a count of standard 8h days. Round up — half-days
    // round to a full day for scheduling purposes.
    return { durationDays: Math.max(1, Math.ceil(total)), hoursPerDay: STANDARD_DAY_HOURS };
  }

  // Hours unit. Anything up to ~one long day stays in a single calendar day
  // so the GCal event reads naturally; longer jobs get spread across
  // STANDARD_DAY_HOURS chunks.
  if (total <= 12) {
    return { durationDays: 1, hoursPerDay: Math.max(1, Math.round(total)) };
  }
  return {
    durationDays: Math.max(1, Math.ceil(total / STANDARD_DAY_HOURS)),
    hoursPerDay: STANDARD_DAY_HOURS,
  };
}
