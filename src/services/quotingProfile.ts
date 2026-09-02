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
import type { GstMode } from '../../shared/document/gstMode';
import { generateId } from '../utils/generateId';
import { formatCurrency, roundToTwoDecimals } from '../utils/quoteCalculator';
import { withOrigin } from '../utils/materialOrigin';

export const MAX_PREFERENCES = 20;
// Re-capped at the server boundary too (functions/src/materialsPrompt.ts).
const MAX_PREFERENCE_CHARS = 160;
export const MAX_RATES = 30;
/** Rate labels and notes land in the system prompt on every turn — keep them short. */
export const MAX_LABEL_CHARS = 120;

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

// The tool schemas enumerate the canonical units, so the model sends those.
// These are the few spellings a person would plausibly type if a rate input
// ever appears, plus the plurals a model slips into.
const UNIT_ALIASES: Record<string, RateCardUnit> = {
  m2: 'm²', sqm: 'm²', lm: 'm', m3: 'm³', hr: 'hour', hrs: 'hour', hours: 'hour', days: 'day', rooms: 'room', points: 'point',
};

export function normaliseRateUnit(unit: unknown): RateCardUnit | null {
  if (typeof unit !== 'string') return null;
  const key = unit.toLowerCase().replace(/^per\s+/, '').trim();
  if ((RATE_CARD_UNITS as readonly string[]).includes(key)) return key as RateCardUnit;
  return UNIT_ALIASES[key] ?? null;
}

export function rateUnitLabel(unit: RateCardUnit): string {
  return unit === 'each' ? 'each' : `per ${unit}`;
}

export type RateCardDraft = Omit<RateCardEntry, 'id' | 'updatedAt'>;

const labelKey = (label: string) => label.replace(/\s+/g, ' ').trim().toLowerCase();

const findRate = (list: RateCardEntry[] | undefined, label: string): RateCardEntry | undefined =>
  (list ?? []).find((r) => labelKey(r.label) === labelKey(label));

/** Insert or replace by label (case-insensitive); a replaced entry keeps its id; oldest drops past the cap. */
export function upsertRate(list: RateCardEntry[] | undefined, draft: RateCardDraft): RateCardEntry[] {
  const existing = findRate(list, draft.label);
  const entry: RateCardEntry = {
    id: existing?.id ?? generateId(),
    label: draft.label.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_CHARS),
    unit: draft.unit,
    rate: roundToTwoDecimals(draft.rate),
    ...(draft.pricesIncludeGst === undefined ? {} : { pricesIncludeGst: draft.pricesIncludeGst }),
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

/**
 * "$220.00 per m² ex GST · materials included" — the one arrangement of a
 * rate's facts, shared by the prompt block, the confirm card and the settings
 * row so they can never disagree. GST basis is left out when unstated.
 */
export function rateSummary(e: {
  rate: number;
  unit: RateCardUnit;
  pricesIncludeGst?: boolean;
  includesMaterials: boolean;
  notes?: string;
}): string {
  const gst = e.pricesIncludeGst === true ? ' inc GST' : e.pricesIncludeGst === false ? ' ex GST' : '';
  return `${formatCurrency(e.rate)} ${rateUnitLabel(e.unit)}${gst} · ${e.includesMaterials ? 'materials included' : 'labour only'}${
    e.notes ? ` · ${e.notes}` : ''
  }`;
}

export function formatRate(e: RateCardEntry): string {
  return `${e.label} — ${rateSummary(e)}`;
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
    lines.push('Rate card:');
    for (const r of rates) lines.push(`- ${formatRate(r)}`);
  }
  return lines.join('\n');
}

// ─── Rate lines on a draft ──────────────────────────────────────────────────

/**
 * The line's unit price in the document's display basis.
 *
 * A rate is a price the TRADIE stated, so the conversion is between the basis
 * they said it in and the document's — never the supplier-catalogue rule
 * (keepSupplierPriceInclusive), which treats a non-registered business as
 * "inclusive" and would have inflated every one of their rates by 10%. With
 * no GST in play there is nothing to convert between.
 */
export function rateLineUnitPrice(line: RateLine, docMode: GstMode, businessInclusive: boolean): number {
  if (docMode === 'none') return roundToTwoDecimals(line.unitPrice);
  const docInclusive = docMode === 'inclusive';
  const lineInclusive = line.pricesIncludeGst ?? businessInclusive;
  if (lineInclusive === docInclusive) return roundToTwoDecimals(line.unitPrice);
  return roundToTwoDecimals(lineInclusive ? line.unitPrice / 1.1 : line.unitPrice * 1.1);
}

/**
 * A rate line as a lump-sum work item: the same shape the inline editor mints,
 * so every calculator, adapter and PDF path handles it unchanged. Markup never
 * applies to a work item — the tradie set this price.
 */
export function buildRateWorkItem(line: RateLine, docMode: GstMode, businessInclusive: boolean): Material {
  const unitPrice = rateLineUnitPrice(line, docMode, businessInclusive);
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
 * otherwise the analysis pass's hours × rate lands on top of the rate. The
 * sections become lump sums: an hourly section with no hours is exactly the
 * shape the integrity check flags as broken.
 */
export function stripLabourFromQuote<T extends Pick<Quote, 'laborHours' | 'sections'>>(quote: T): T {
  return {
    ...quote,
    laborHours: 0,
    sections: (quote.sections ?? []).map((s) => ({
      ...s,
      pricing: 'lumpSum' as const,
      laborHours: 0,
      laborHoursTotal: 0,
      laborTotal: 0,
    })),
  };
}
