/**
 * Pure, network-free logic for the Service Report write-up compose step.
 *
 * A tradie types rough notes at the end of a service visit — "found split
 * flex on the hot water iso, replaced it, recommend rcd upgrade next visit".
 * The compose callable rewrites those into clean, professional service-report
 * prose for a customer-facing document. These helpers hold the two pieces
 * that must stay unit-testable without touching Gemini or Firestore:
 *
 *   buildComposePrompt — assembles the model instruction, and
 *   sanitizeComposed   — cleans the model output back into the report shape.
 *
 * The discipline mirrors src/utils/sanitizeJobDescription.ts: the rewrite is
 * STRICTLY FACTUAL. The model may tidy grammar and tone, and it may MOVE a
 * fact into the field where it belongs (a "recommend…" line typed under work
 * carried out belongs in recommended work), but it must never invent
 * equipment, measurements, part numbers, or claims that aren't in the notes.
 * When every source note is empty the output is empty — the model is never
 * allowed to fill a blank from nothing.
 *
 * The same round-trip also extracts two OPTIONAL suggestion lists — equipment
 * the notes mention and checklist-style actions the notes say were done. They
 * are surfaced for the tradie to review and tap to add; nothing is ever added
 * to the report automatically.
 */

export interface ComposeNotes {
  natureOfProblem?: string;
  workCarriedOut?: string;
  recommendedWork?: string;
}

export interface ComposeContext {
  businessName?: string;
  tradeCategory?: string;
}

export interface ComposedReport {
  natureOfProblem: string;
  workCarriedOut: string;
  recommendedWork: string;
  suggestedEquipment: string[];
  suggestedChecklist: string[];
}

/** Longest suggestion list we will pass back to the client. */
export const MAX_SUGGESTIONS = 8;

/** The three note fields, in output order, with their customer-facing labels. */
const FIELDS: { key: keyof ComposeNotes; label: string; hint: string }[] = [
  {
    key: 'natureOfProblem',
    label: 'Nature of the problem',
    hint: 'what the customer reported or what was found on arrival',
  },
  {
    key: 'workCarriedOut',
    label: 'Work carried out',
    hint: 'what was actually done during this visit',
  },
  {
    key: 'recommendedWork',
    label: 'Recommended work',
    hint: 'work suggested for a future visit, if any',
  },
];

function clean(v: string | undefined | null): string {
  return (v || '').trim();
}

/**
 * Build the single prompt string sent to the text model. Only the fields the
 * tradie actually filled in are shown as source notes, but the reply always
 * carries all three write-up keys: the model is allowed to REDISTRIBUTE facts
 * into the field where they belong, so a field can come back filled even
 * though its own note was blank — provided every fact in it came from one of
 * the supplied notes. The instruction forbids invention, demands Australian
 * English and gender-neutral wording, bans any greeting, and requires a JSON
 * reply so sanitizeComposed can parse it deterministically.
 *
 * Note: the strings below never use the two-letter term for machine
 * intelligence — this prose can surface in review and must not seed it into a
 * customer document.
 */
export function buildComposePrompt(notes: ComposeNotes, context?: ComposeContext): string {
  const present = FIELDS.filter((f) => clean(notes[f.key]).length > 0);

  const trade = clean(context?.tradeCategory);
  const business = clean(context?.businessName);

  const who = [
    business ? `You are writing on behalf of ${business}.` : '',
    trade ? `The trade is ${trade}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const rules = [
    'You are cleaning up a tradesperson\'s rough notes into the write-up section of a service report that their customer will read.',
    who,
    'The write-up has three fields: "natureOfProblem" (what the customer reported or what was found on arrival), "workCarriedOut" (what was actually done during this visit), and "recommendedWork" (work suggested for a future visit).',
    'Rewrite the notes provided below into clear, professional prose across those three fields.',
    'You may MOVE a fact into the field where it belongs, even if the tradesperson typed it under a different heading. A "needs replacing", "recommend" or "should be done later" statement belongs in "recommendedWork". A symptom or complaint belongs in "natureOfProblem". Work that was actually done belongs in "workCarriedOut". A field may come back filled even though its own note was blank, as long as every fact in it came from one of the supplied notes.',
    'STRICTLY FACTUAL: facts may move between fields, but nothing may be added. Never add equipment, materials, measurements, part numbers, brands, times, prices, or any claim that is not already present in the notes. If a detail is not in the notes, leave it out.',
    'Use Australian English spelling.',
    'Write in a plain, factual, gender-neutral tone. Do not use "he", "she", "guys", "blokes" or similar.',
    'Do not add a greeting, sign-off, salutation, or any address to the reader (no "Hi", "Hello", "Dear", "G\'day"). Return the write-up text only.',
    'Do not mention that this text was generated or assisted by any tool.',
    'Keep each field to a sentence or two. Do not invent headings.',
    'Also extract two short suggestion lists, strictly from the notes:',
    '- "suggestedEquipment": equipment or assets the notes MENTION (for example "both split systems" becomes "Split system ×2").',
    `- "suggestedChecklist": checklist-style actions the notes say WERE DONE (for example "cleaned filters" becomes "Clean air filters").`,
    `Suggestions are optional extras the tradesperson will review and choose from — nothing is added to the report automatically. Use short labels of a few words, at most ${MAX_SUGGESTIONS} entries in each list, and empty arrays when the notes mention nothing suitable.`,
    'Reply with ONLY a JSON object, no code fences, with these keys: string values for "natureOfProblem", "workCarriedOut" and "recommendedWork" (use an empty string where nothing applies), and arrays of strings for "suggestedEquipment" and "suggestedChecklist".',
  ]
    .filter(Boolean)
    .join('\n');

  const sourceBlock = present
    .map((f) => `${f.label} (${f.hint}):\n${clean(notes[f.key])}`)
    .join('\n\n');

  return `${rules}\n\nNOTES TO REWRITE:\n${sourceBlock}`;
}

// A leading greeting/salutation the model may prepend despite instructions.
// Matched only at the very start of a field and removed, keeping the factual
// body that follows.
const LEADING_GREETING =
  /^\s*(?:hi|hello|hey|g'?day|dear|good\s+(?:morning|afternoon|evening|day))\b[^,.!?:\n—-]*[,.!?:\n—-]+\s*/i;

function stripLeadingGreeting(text: string): string {
  let out = text;
  // Apply once — a single leading salutation is the observed failure; looping
  // could eat a legitimate sentence that merely starts with one of these words
  // after the greeting is gone.
  const m = LEADING_GREETING.exec(out);
  if (m && m[0].trim().length > 0) out = out.slice(m[0].length);
  return out.trim();
}

/** Pull a JSON object out of a raw model reply, tolerating code fences / prose. */
function extractJson(raw: string): Record<string, unknown> | null {
  const text = (raw || '').trim();
  if (!text) return null;
  // Strip a ```json … ``` (or bare ```) fence if the model added one.
  const fenced = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const candidates = [fenced, text];
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through to brace-slice */
    }
  }
  // Last resort: slice from the first { to the last }.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* give up */
    }
  }
  return null;
}

/**
 * Clamp a model-supplied suggestion list: strings only, trimmed, non-empty,
 * de-duplicated case-insensitively, capped at MAX_SUGGESTIONS.
 */
function clampSuggestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const label = entry.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

const EMPTY_COMPOSED: ComposedReport = {
  natureOfProblem: '',
  workCarriedOut: '',
  recommendedWork: '',
  suggestedEquipment: [],
  suggestedChecklist: [],
};

/**
 * Turn a raw model reply into the write-up fields plus suggestion lists.
 *
 * Rules:
 *  - When ALL source notes are empty, everything comes back empty — the model
 *    is never allowed to compose a report from nothing. (A single empty note
 *    no longer forces its field blank: redistribution means a field can be
 *    legitimately filled from facts the tradie typed under another heading.)
 *  - A leading greeting the model added is stripped from each field.
 *  - If the reply is unusable (no JSON) or carries no write-up text at all,
 *    the tradie's own trimmed notes are kept rather than losing their facts.
 *  - Suggestion lists are clamped: strings only, trimmed, deduped, max 8.
 */
export function sanitizeComposed(raw: string, notes: ComposeNotes): ComposedReport {
  const sources = FIELDS.map((f) => clean(notes[f.key]));
  if (sources.every((s) => !s)) return { ...EMPTY_COMPOSED };

  const keepSources = (): ComposedReport => ({
    natureOfProblem: sources[0],
    workCarriedOut: sources[1],
    recommendedWork: sources[2],
    suggestedEquipment: [],
    suggestedChecklist: [],
  });

  const parsed = extractJson(raw);
  if (!parsed) return keepSources();

  const out: ComposedReport = { ...EMPTY_COMPOSED };
  let anyText = false;
  for (const f of FIELDS) {
    const modelValue = typeof parsed[f.key] === 'string' ? (parsed[f.key] as string) : '';
    const value = stripLeadingGreeting(clean(modelValue));
    out[f.key] = value;
    if (value) anyText = true;
  }
  // The model dropped every write-up field despite having source notes —
  // fall back to the tradie's own words instead of wiping their input.
  if (!anyText) return keepSources();

  out.suggestedEquipment = clampSuggestions(parsed.suggestedEquipment);
  out.suggestedChecklist = clampSuggestions(parsed.suggestedChecklist);
  return out;
}
