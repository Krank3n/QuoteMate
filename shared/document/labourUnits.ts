/**
 * Canonical labour units.
 *
 * THE RULE: in stored data, every labour quantity is HOURS and every labour
 * rate is DOLLARS PER HOUR. Always. `laborUnit` on a stored document/section
 * is therefore always `'hours'` — it is kept in the schema only so older app
 * builds reading the same records still interpret them correctly.
 *
 * Days are a DISPLAY CONCERN and nothing else. The preference lives in
 * `labourDisplayUnit` on the document, and is applied at the edges (the
 * labour editor, the PDF, the admin view) by dividing quantities by 8 and
 * multiplying the rate by 8 at render time.
 *
 * Why this file exists
 * --------------------
 * The old model stored day-shaped values ("0.19 days @ $5,440/day") alongside
 * hour-shaped ones, with a per-section unit AND a document-level unit that
 * nothing kept in sync. Any code that summed sections, or picked "the" rate,
 * or converted hours→days, had to guess which unit it was looking at — and
 * when it guessed wrong it multiplied a day rate by 8 again. That produced
 * quotes at 8× and 64× the tradie's real rate (see healLabourUnits.ts).
 *
 * Three previous fixes tried to make the guessing safe. This one deletes the
 * guessing: there is one unit, conversion happens only at render, and the
 * conversions here are money-preserving by construction (value × 8 paired
 * with rate ÷ 8).
 *
 * Templates are the one exception: SectionTemplate/JobTemplate records still
 * store their own real unit, because a tradie authors them as "1.5 days @
 * $680/day". Normalise a template with `normaliseTemplateToHours` at the
 * point of use, before it becomes a quote section.
 */

export const HOURS_PER_DAY = 8;

export type LabourUnit = 'hours' | 'days';

/** Round to 2dp — money and per-unit hours. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function finite(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** A quantity in `unit`, expressed in hours. */
export function valueToHours(value: unknown, unit?: LabourUnit): number {
  const n = finite(value);
  return unit === 'days' ? n * HOURS_PER_DAY : n;
}

/** A rate quoted per `unit`, expressed as dollars per hour. */
export function rateToHourly(rate: unknown, unit?: LabourUnit): number {
  const n = finite(rate);
  return unit === 'days' ? n / HOURS_PER_DAY : n;
}

/** Hours → the number to show in `displayUnit`. */
export function hoursForDisplay(hours: unknown, displayUnit?: LabourUnit): number {
  const n = finite(hours);
  return displayUnit === 'days' ? n / HOURS_PER_DAY : n;
}

/** Dollars per hour → the rate to show in `displayUnit`. */
export function rateForDisplay(hourlyRate: unknown, displayUnit?: LabourUnit): number {
  const n = finite(hourlyRate);
  return displayUnit === 'days' ? n * HOURS_PER_DAY : n;
}

/** A number the user typed in `displayUnit` → canonical hours. */
export function hoursFromDisplay(displayValue: unknown, displayUnit?: LabourUnit): number {
  const n = finite(displayValue);
  return displayUnit === 'days' ? n * HOURS_PER_DAY : n;
}

/** A rate the user typed in `displayUnit` → canonical dollars per hour. */
export function hourlyRateFromDisplay(displayRate: unknown, displayUnit?: LabourUnit): number {
  const n = finite(displayRate);
  return displayUnit === 'days' ? n / HOURS_PER_DAY : n;
}

// Structural shapes only — deliberately without an index signature so the
// app's concrete Quote/Invoice/Document types satisfy them directly.
interface SectionShape {
  laborHours?: number;
  laborHoursTotal?: number;
  laborRate?: number;
  laborUnit?: LabourUnit;
  laborTotal?: number;
  multiplier?: number;
}

interface DocumentShape {
  laborHours?: number;
  laborRate?: number;
  laborUnit?: LabourUnit;
  laborExtraHours?: number;
  labourDisplayUnit?: LabourUnit;
  sections?: SectionShape[];
}

/** True when a record is already canonical (nothing stored in days). */
export function isCanonicalLabour(doc: DocumentShape | null | undefined): boolean {
  if (!doc) return true;
  if (doc.laborUnit === 'days') return false;
  return !(doc.sections || []).some((s) => s?.laborUnit === 'days');
}

/**
 * Convert one section to canonical hours. Money is preserved exactly: the
 * quantity is multiplied by 8 and the rate divided by 8, so
 * `laborHours × laborRate × multiplier` is unchanged. `laborTotal` is carried
 * across untouched — it is the authoritative dollar figure — and only
 * recomputed when it is missing.
 */
export function normaliseSectionToHours<T extends SectionShape>(section: T): T {
  if (!section || section.laborUnit !== 'days') return section;
  const multiplier = finite(section.multiplier) || 1;
  // Deliberately unrounded: ×8 on the quantity paired with ÷8 on the rate is
  // exact, so laborHours × laborRate × multiplier still equals the stored
  // laborTotal to the cent. Rounding the quantity here (0.1285714 days → 1.03
  // hours) reintroduces a drift of a dollar or two per section, which the
  // integrity checker then reports as a total mismatch. Display rounds; storage
  // does not.
  const laborHours = valueToHours(section.laborHours, 'days');
  const laborRate = rateToHourly(section.laborRate, 'days');
  const laborHoursTotal = section.laborHoursTotal !== undefined
    ? valueToHours(section.laborHoursTotal, 'days')
    : laborHours * multiplier;
  const laborTotal = section.laborTotal !== undefined
    ? finite(section.laborTotal)
    : round2(laborHours * laborRate * multiplier);
  return {
    ...section,
    laborHours,
    laborHoursTotal,
    laborRate,
    laborUnit: 'hours' as LabourUnit,
    laborTotal,
  };
}

/**
 * Convert a whole document (quote or invoice) to canonical hours, preserving
 * every dollar figure and remembering the tradie's days preference in
 * `labourDisplayUnit`.
 *
 * Returns the SAME object when there is nothing to convert, so callers can
 * rely on referential equality to skip re-renders and re-saves.
 */
export function normaliseLabourToHours<T extends DocumentShape>(doc: T): T {
  if (!doc || isCanonicalLabour(doc)) return doc;

  const docWasDays = doc.laborUnit === 'days';
  const sections = doc.sections
    ? doc.sections.map((s) => normaliseSectionToHours(s))
    : doc.sections;

  const out: DocumentShape = {
    ...doc,
    ...(sections ? { sections } : {}),
    laborUnit: 'hours' as LabourUnit,
    // Anything stored in days was authored in days — keep showing days unless
    // the record already carries an explicit preference.
    labourDisplayUnit: doc.labourDisplayUnit ?? ('days' as LabourUnit),
  };

  if (docWasDays) {
    out.laborHours = valueToHours(doc.laborHours, 'days');
    out.laborRate = rateToHourly(doc.laborRate, 'days');
    if (doc.laborExtraHours !== undefined) {
      out.laborExtraHours = valueToHours(doc.laborExtraHours, 'days');
    }
  }

  return out as T;
}

interface TemplateShape {
  laborHours?: number;
  laborRate?: number;
  laborUnit?: LabourUnit;
}

/**
 * Templates keep their authored unit on disk (a tradie writes "1.5 days @
 * $680/day"). Call this the moment a template becomes quote data.
 */
export function normaliseTemplateToHours<T extends TemplateShape>(template: T): T {
  if (!template || template.laborUnit !== 'days') return template;
  return {
    ...template,
    laborHours: round2(valueToHours(template.laborHours, 'days')),
    laborRate: rateToHourly(template.laborRate, 'days'),
    laborUnit: 'hours' as LabourUnit,
  };
}

/**
 * The unit to render a document in: the stored preference when present,
 * otherwise days for genuinely multi-day work (>= 2 full days) and hours
 * below that. Fractional days read badly on a short job — "0.9 days" was the
 * original complaint that started all of this.
 */
export function resolveDisplayUnit(doc: DocumentShape | null | undefined, totalHours: number): LabourUnit {
  if (doc?.labourDisplayUnit === 'days' || doc?.labourDisplayUnit === 'hours') {
    return doc.labourDisplayUnit;
  }
  return totalHours >= HOURS_PER_DAY * 2 ? 'days' : 'hours';
}

/**
 * Total labour hours for a document from canonical data: sections (plus the
 * extra buffer) when present, otherwise the top-level figure. Legacy
 * day-shaped records are converted on the way through, so this is safe to
 * call on un-normalised input.
 */
export function totalLabourHours(doc: DocumentShape | null | undefined): number {
  if (!doc) return 0;
  const sections = doc.sections;
  if (Array.isArray(sections) && sections.length > 0) {
    const sectionHours = sections.reduce((sum, s) => {
      const total = s?.laborHoursTotal !== undefined && Number.isFinite(Number(s.laborHoursTotal))
        ? finite(s.laborHoursTotal)
        : finite(s?.laborHours) * (finite(s?.multiplier) || 1);
      return sum + valueToHours(total, s?.laborUnit);
    }, 0);
    return sectionHours + valueToHours(doc.laborExtraHours, doc.laborUnit);
  }
  return valueToHours(doc.laborHours, doc.laborUnit);
}

/**
 * The effective dollars-per-hour a record actually bills at — the number to
 * sanity-check against the business's configured rate. Sections win over the
 * top-level field because sections are what the money is summed from.
 */
export function effectiveHourlyRate(doc: DocumentShape | null | undefined): number {
  if (!doc) return 0;
  const section = (doc.sections || []).find((s) => finite(s?.laborRate) > 0);
  if (section) return rateToHourly(section.laborRate, section.laborUnit);
  return rateToHourly(doc.laborRate, doc.laborUnit);
}
