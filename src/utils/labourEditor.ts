/**
 * The labour editor's hydrate → edit → save cycle, as pure functions.
 *
 * LaborMarkupScreen holds its inputs in DISPLAY space (whatever unit the
 * Hours/Days toggle is showing) and the document stores canonical hours. These
 * two functions are the only conversion between them, which is what makes the
 * round trip provable — see labourEditor.test.ts, where the production
 * documents that the old code inflated 8× are run through this cycle ten times
 * and must not move by a cent.
 *
 * The property that matters: hydrate(apply(doc, hydrate(doc))) === hydrate(doc).
 * The old screen broke it by deriving the displayed rate from a stored rate
 * whose unit it had guessed, so each visit could multiply the rate by 8 again.
 */

import { LaborUnit, QuoteSection, StoredLabourUnit } from '../types';
import {
  normaliseLabourToHours,
  resolveDisplayUnit,
  hoursForDisplay,
  rateForDisplay,
  hoursFromDisplay,
  hourlyRateFromDisplay,
} from '../../shared/document/labourUnits';

export interface LabourEditorState {
  /** Unit the inputs below are expressed in. */
  displayUnit: LaborUnit;
  /** Total labour, in displayUnit. */
  totalInput: string;
  /** Rate per displayUnit. */
  rateInput: string;
  /** Per-section totals (section.id → value in displayUnit). */
  sectionTotals: Record<string, string>;
}

interface LabourDocLike {
  laborHours: number;
  laborRate: number;
  laborUnit?: LaborUnit;
  labourDisplayUnit?: LaborUnit;
  laborExtraHours?: number;
  sections?: QuoteSection[];
}

export interface LabourPatch {
  sections?: QuoteSection[];
  laborHours: number;
  laborRate: number;
  /** Always 'hours' — the type makes a day-shaped write impossible. */
  laborUnit: StoredLabourUnit;
  labourDisplayUnit: LaborUnit;
  laborExtraHours: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A section's total hours. Only ever called on canonical (hours) sections, so
 * laborRate is $/hour and laborTotal ÷ laborRate is a number of hours.
 *
 * `laborTotal` wins when it can: it is the authoritative dollar figure, and
 * some legacy records disagree with themselves — `laborHours` was persisted as
 * an already-totalled value while `multiplier` stayed above 1 (the May 2026
 * projectShared bug, see functions/scripts/healInflatedSections.ts). Deriving
 * hours from the fields there would multiply the price by the multiplier again
 * just for opening the editor; deriving them from the money cannot.
 */
function sectionHours(s: QuoteSection): number {
  // A lump-sum section has no hours by construction — its price is a number
  // the tradie typed, not a duration × a rate. Deriving hours from its dollars
  // (total ÷ rate, with rate 0) is a division by zero, and the old code's
  // fallback made the section look like free work: applyLabourEditor would
  // then write laborTotal = 0 and the money would be gone, for nothing more
  // than opening the labour screen.
  if (s.pricing === 'lumpSum') return 0;
  const rate = s.laborRate || 0;
  const total = s.laborTotal || 0;
  if (rate > 0 && total > 0) return total / rate;
  if (typeof s.laborHoursTotal === 'number' && Number.isFinite(s.laborHoursTotal)) {
    return s.laborHoursTotal;
  }
  return (s.laborHours || 0) * (s.multiplier || 1);
}

/** Read a document into editor state. */
export function hydrateLabourEditor(rawDoc: LabourDocLike): LabourEditorState {
  const doc = normaliseLabourToHours(rawDoc);
  const sections = doc.sections || [];
  const hasSections = sections.length > 0;

  let totalHours: number;
  let hourlyRate: number;
  const perSectionHours: Record<string, number> = {};

  if (hasSections) {
    let sum = 0;
    for (const s of sections) {
      const hours = sectionHours(s);
      perSectionHours[s.id] = hours;
      sum += hours;
    }
    // Every section is canonical $/hour, so which one this reads from cannot
    // change the answer. The old code took the first section's rate while the
    // sections disagreed about their unit — that is how a $680/day rate became
    // the quote's hourly rate.
    hourlyRate = sections.find((s) => (s.laborRate || 0) > 0)?.laborRate || doc.laborRate || 0;
    totalHours = sum + (doc.laborExtraHours || 0);
  } else {
    totalHours = doc.laborHours;
    hourlyRate = doc.laborRate;
  }

  const displayUnit = resolveDisplayUnit(doc, totalHours);
  const sectionTotals: Record<string, string> = {};
  for (const [id, hours] of Object.entries(perSectionHours)) {
    sectionTotals[id] = String(round1(hoursForDisplay(hours, displayUnit)));
  }

  return {
    displayUnit,
    totalInput: String(round1(hoursForDisplay(totalHours, displayUnit))),
    rateInput: String(rateForDisplay(hourlyRate, displayUnit)),
    sectionTotals,
  };
}

/**
 * An input the user has not touched still reads back through a 1dp display
 * rounding — and in days mode 0.1 is 48 minutes, so blindly converting it back
 * would quietly shave dollars off a quote just for opening the screen. When
 * the on-screen value still matches what the stored hours render as, keep the
 * stored hours untouched; only a genuinely edited field is converted.
 */
function resolveHours(
  storedHours: number,
  displayed: string | undefined,
  displayUnit: LaborUnit,
): number {
  if (displayed === undefined) return storedHours;
  const typed = parseFloat(displayed);
  if (!Number.isFinite(typed)) return storedHours;
  const unchanged = typed === round1(hoursForDisplay(storedHours, displayUnit));
  return unchanged ? storedHours : hoursFromDisplay(typed, displayUnit);
}

/**
 * A blank or half-typed rate box is not an instruction to work for free — it
 * is a field mid-edit. Keep the stored rate unless the user typed an actual
 * number (including a deliberate 0), matching how quantities behave above.
 */
function resolveRate(storedHourly: number, typedDisplay: string, displayUnit: LaborUnit): number {
  const typed = parseFloat(typedDisplay);
  if (!Number.isFinite(typed)) return storedHourly;
  return hourlyRateFromDisplay(typed, displayUnit);
}

/** Turn editor state back into canonical document fields. */
export function applyLabourEditor(doc: LabourDocLike, state: LabourEditorState): LabourPatch {
  const { displayUnit } = state;
  const canonical = normaliseLabourToHours(doc);
  const storedHourly = (canonical.sections || []).find((s) => (s.laborRate || 0) > 0)?.laborRate
    ?? canonical.laborRate
    ?? 0;
  const hourlyRate = resolveRate(storedHourly, state.rateInput, displayUnit);
  // The screen shows one rate box for the whole document, so saving it applies
  // that rate everywhere — but only when the tradie actually changed it. A
  // section carrying its own rate (a template applied at a different price)
  // keeps it otherwise, instead of being silently repriced by a visit.
  const rateEdited = hourlyRate !== storedHourly;
  const hasSections = !!(canonical.sections && canonical.sections.length > 0);

  let sectionsSumHours = 0;
  const sections = hasSections && canonical.sections
    ? canonical.sections.map((s) => {
        // Byte-identical pass-through. laborTotal on a lump-sum section is the
        // tradie's own figure; there is nothing here to recompute it FROM, so
        // recomputing it can only destroy it.
        if (s.pricing === 'lumpSum') return s;
        const stored = sectionHours(s);
        const hours = resolveHours(stored, state.sectionTotals[s.id], displayUnit);
        sectionsSumHours += hours;
        const multiplier = s.multiplier || 1;
        // An untouched section keeps full precision so its dollars land back
        // exactly where they were; only a section the user actually moved gets
        // rounded to a tidy per-unit figure.
        const perUnit = multiplier > 0
          ? (hours === stored ? hours / multiplier : round2(hours / multiplier))
          : 0;
        const sectionRate = rateEdited ? hourlyRate : (s.laborRate || hourlyRate);
        return {
          ...s,
          laborHours: perUnit,
          laborHoursTotal: round2(perUnit * multiplier),
          laborRate: sectionRate,
          laborUnit: 'hours' as StoredLabourUnit,
          laborTotal: round2(perUnit * sectionRate * multiplier),
        };
      })
    : undefined;

  const storedTotal = hasSections
    ? sectionHoursTotal(canonical)
    : canonical.laborHours;
  const totalHours = resolveHours(storedTotal, state.totalInput, displayUnit);

  return {
    ...(sections ? { sections } : {}),
    laborHours: totalHours,
    laborRate: hourlyRate,
    laborUnit: 'hours',
    labourDisplayUnit: displayUnit,
    // The buffer between the user's stated total and what the sections add up
    // to, in hours like everything else.
    laborExtraHours: hasSections ? round2(totalHours - sectionsSumHours) : 0,
  };
}

/** Sections + extra, in hours — the number the total input mirrors. */
function sectionHoursTotal(doc: LabourDocLike): number {
  const sum = (doc.sections || []).reduce((total, s) => total + sectionHours(s), 0);
  return sum + (doc.laborExtraHours || 0);
}
