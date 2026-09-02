/**
 * Quoting profile — how THIS business likes to quote.
 *
 * Two small things on business settings, both written by Mate through a
 * confirm card and both visible (and deletable) on the Trade pricing screen:
 *
 *   quotingPreferences  — up to 20 plain sentences in the tradie's words
 *                         ("labour separate from materials", "customers
 *                         supply their own materials"). Injected into Mate's
 *                         prompt and the materials-generation prompt.
 *   rateCard            — named charge-out rates ("Patio roof — $220 per m²
 *                         ex GST, materials included"). Applied on a draft as
 *                         rate × quantity, minted as lump-sum work items.
 *
 * Everything here is pure. The 17 conversations (9 tradies) that described a
 * job per m², per lineal metre, per hour or per day had nowhere to put that
 * number — this is where it goes.
 */
import type { BusinessSettings, Material, Quote, RateCardEntry, RateCardUnit, RateLine } from '../types';
import { generateId } from '../utils/generateId';
import { formatCurrency, roundToTwoDecimals } from '../utils/quoteCalculator';
import { withOrigin } from '../utils/materialOrigin';

export const MAX_PREFERENCES = 20;
export const MAX_PREFERENCE_CHARS = 160;
export const MAX_RATES = 30;

export const RATE_CARD_UNITS: readonly RateCardUnit[] = [
  'm²', 'm', 'm³', 'hour', 'day', 'each', 'room', 'point', 'job',
];

// ─── Preferences ────────────────────────────────────────────────────────────

/** One sentence, whitespace-folded, within the cap; null when it isn't worth keeping. */
export function normalisePreference(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 3 || t.length > MAX_PREFERENCE_CHARS) return null;
  return t;
}

/** Append (or move to the end) a preference; duplicates fold case-insensitively; oldest drops past the cap. */
export function addPreference(list: string[] | undefined, text: string): string[] {
  const t = normalisePreference(text);
  if (!t) return [...(list ?? [])];
  const kept = (list ?? []).filter((p) => p.toLowerCase() !== t.toLowerCase());
  return [...kept, t].slice(-MAX_PREFERENCES);
}

export function removePreference(list: string[] | undefined, text: string): string[] {
  const key = text.trim().toLowerCase();
  return (list ?? []).filter((p) => p.trim().toLowerCase() !== key);
}

// ─── Rate card ──────────────────────────────────────────────────────────────

const UNIT_ALIASES: Record<string, RateCardUnit> = {
  'm²': 'm²', m2: 'm²', sqm: 'm²', 'sq m': 'm²', 'square metre': 'm²', 'square metres': 'm²', 'square meter': 'm²', 'square meters': 'm²', square: 'm²',
  m: 'm', lm: 'm', 'lineal metre': 'm', 'lineal metres': 'm', 'linear metre': 'm', 'linear metres': 'm', metre: 'm', metres: 'm', meter: 'm', meters: 'm',
  'm³': 'm³', m3: 'm³', 'cubic metre': 'm³', 'cubic metres': 'm³', cubic: 'm³',
  hour: 'hour', hours: 'hour', hr: 'hour', hrs: 'hour', hourly: 'hour',
  day: 'day', days: 'day', daily: 'day',
  each: 'each', ea: 'each', unit: 'each', item: 'each', items: 'each',
  room: 'room', rooms: 'room', bedroom: 'room', bedrooms: 'room',
  point: 'point', points: 'point',
  job: 'job', fixed: 'job', 'lump sum': 'job', flat: 'job', 'flat rate': 'job',
};

/** Accepts the way tradies say a unit ("sqm", "lm", "an hour") and returns the canonical one. */
export function normaliseRateUnit(unit: unknown): RateCardUnit | null {
  if (typeof unit !== 'string') return null;
  const key = unit.toLowerCase().replace(/^per\s+/, '').replace(/\s+/g, ' ').trim();
  return UNIT_ALIASES[key] ?? null;
}

export function rateUnitLabel(unit: RateCardUnit): string {
  return unit === 'each' ? 'each' : `per ${unit}`;
}

export interface RateCardDraft {
  id?: string;
  label: string;
  unit: RateCardUnit;
  rate: number;
  pricesIncludeGst: boolean;
  includesMaterials: boolean;
  notes?: string;
}

const labelKey = (label: string) => label.replace(/\s+/g, ' ').trim().toLowerCase();

export function findRate(list: RateCardEntry[] | undefined, label: string): RateCardEntry | undefined {
  const key = labelKey(label);
  return (list ?? []).find((r) => labelKey(r.label) === key);
}

/** Insert or replace by label (case-insensitive); a replaced entry keeps its id; oldest drops past the cap. */
export function upsertRate(list: RateCardEntry[] | undefined, draft: RateCardDraft): RateCardEntry[] {
  const existing = findRate(list, draft.label);
  const entry: RateCardEntry = {
    id: existing?.id ?? draft.id ?? generateId(),
    label: draft.label.replace(/\s+/g, ' ').trim(),
    unit: draft.unit,
    rate: roundToTwoDecimals(draft.rate),
    pricesIncludeGst: draft.pricesIncludeGst,
    includesMaterials: draft.includesMaterials,
    ...(draft.notes?.trim() ? { notes: draft.notes.trim() } : {}),
    updatedAt: new Date().toISOString(),
  };
  const kept = (list ?? []).filter((r) => r.id !== entry.id && labelKey(r.label) !== labelKey(entry.label));
  return [...kept, entry].slice(-MAX_RATES);
}

export function removeRate(list: RateCardEntry[] | undefined, id: string): RateCardEntry[] {
  return (list ?? []).filter((r) => r.id !== id);
}

export function formatRate(e: RateCardEntry): string {
  return `${e.label} — ${formatCurrency(e.rate)} ${rateUnitLabel(e.unit)} ${e.pricesIncludeGst ? 'inc GST' : 'ex GST'}, ${
    e.includesMaterials ? 'materials included' : 'labour only'
  }`;
}

// ─── Prompt block ───────────────────────────────────────────────────────────

/**
 * The per-business block appended to Mate's system prompt. Null when the
 * tradie has saved nothing, so a new account's prompt is byte-identical to
 * the static one.
 */
export function buildQuotingProfileBlock(
  settings: Pick<BusinessSettings, 'quotingPreferences' | 'rateCard'> | null | undefined,
): string | null {
  const prefs = (settings?.quotingPreferences ?? []).map(normalisePreference).filter((p): p is string => !!p);
  const rates = settings?.rateCard ?? [];
  if (!prefs.length && !rates.length) return null;

  const lines: string[] = [
    "How this business quotes — their saved settings. Apply these without being asked and don't recite them back.",
  ];
  if (prefs.length) {
    lines.push('Preferences:');
    for (const p of prefs) lines.push(`- ${p}`);
  }
  if (rates.length) {
    lines.push('Rate card (as saved — when one fits the job and you know the quantity, pass it as a rateLine on propose_draft_quote):');
    for (const r of rates) lines.push(`- ${formatRate(r)}`);
  }
  return lines.join('\n');
}

// ─── Rate lines on a draft ──────────────────────────────────────────────────

export type { RateLine };

/** The line's unit price converted into the document's display basis. */
export function rateLineUnitPrice(line: RateLine, docInclusive: boolean, fallbackInclusive: boolean): number {
  const lineInclusive = line.pricesIncludeGst ?? fallbackInclusive;
  if (lineInclusive === docInclusive) return roundToTwoDecimals(line.unitPrice);
  return roundToTwoDecimals(lineInclusive ? line.unitPrice / 1.1 : line.unitPrice * 1.1);
}

export function rateLineTotal(line: RateLine, docInclusive: boolean, fallbackInclusive: boolean): number {
  return roundToTwoDecimals(rateLineUnitPrice(line, docInclusive, fallbackInclusive) * line.quantity);
}

/**
 * A rate line as a lump-sum work item: the same shape the inline editor mints,
 * so every calculator, adapter and PDF path handles it unchanged. Markup never
 * applies to a work item — the tradie set this price.
 */
export function buildRateWorkItem(line: RateLine, docInclusive: boolean, fallbackInclusive: boolean): Material {
  const unitPrice = rateLineUnitPrice(line, docInclusive, fallbackInclusive);
  const total = roundToTwoDecimals(unitPrice * line.quantity);
  const qty = Number.isInteger(line.quantity) ? String(line.quantity) : line.quantity.toFixed(2);
  const basis = line.unit === 'job' && line.quantity === 1 ? `${formatCurrency(unitPrice)} fixed price` : `${qty} ${line.unit === 'each' ? 'items' : line.unit} @ ${formatCurrency(unitPrice)} ${rateUnitLabel(line.unit)}`;
  return withOrigin(
    {
      id: generateId(),
      name: line.label.replace(/\s+/g, ' ').trim(),
      kind: 'work',
      scope: `${basis}${line.includesMaterials ? ' — materials included' : ' — labour only, materials listed separately'}`,
      quantity: 1,
      unit: 'each',
      price: total,
      totalPrice: total,
      manualPriceOverride: true,
      pricingSource: 'manual',
      priceConfidence: 'high',
    } as Material,
    'manual',
  );
}

/** True when the rate lines are the whole price — nothing to generate or price on top. */
export function rateLinesCoverMaterials(lines: RateLine[] | undefined): boolean {
  return !!lines && lines.length > 0 && lines.every((l) => l.includesMaterials);
}

/**
 * Zero the labour on a quote whose labour is charged through rate lines,
 * otherwise the analysis pass's hours × rate lands on top of the rate.
 */
export function stripLabourFromQuote<T extends Pick<Quote, 'laborHours' | 'sections'>>(quote: T): T {
  return {
    ...quote,
    laborHours: 0,
    sections: (quote.sections ?? []).map((s) => ({ ...s, laborHours: 0, laborHoursTotal: 0, laborTotal: 0 })),
  };
}
