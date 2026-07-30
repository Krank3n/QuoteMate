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
 * Where "strictly factual" stops, though, is DETAIL — not LENGTH. A tradie
 * comparing this to a general-purpose chatbot sees thin output and reads it
 * as a worse tool, so the rewrite is allowed to write in full: to state the
 * recognised purpose of an action the notes say was performed ("cleaned the
 * condenser coils" → "…to restore airflow and heat-transfer efficiency") and
 * to name the sub-parts an action inherently covers ("checked electrical
 * components" → "wiring, terminals and connections"). What it may never do
 * is assert an OUTCOME: that a unit was tested, that it was left operating
 * correctly, that a reading was within range. Those are the sentences a
 * chatbot cheerfully invents and a customer later relies on.
 *
 * So the round-trip returns three OPTIONAL suggestion lists rather than two.
 * Equipment the notes mention and checklist-style actions they say were done
 * come back as before — and any closing claim the model WANTED to make but
 * could not support comes back as `suggestedAdditions`: a ready-written
 * sentence the tradie confirms with one tap. Nothing in any of the three
 * lists is ever added to the report automatically.
 */

export interface ComposeNotes {
  natureOfProblem?: string;
  workCarriedOut?: string;
  recommendedWork?: string;
}

export interface ComposeContext {
  businessName?: string;
  tradeCategory?: string;
  /**
   * The write-up from this site's previous visit, supplied as a TERMINOLOGY
   * reference only — it teaches the model the tradie's own vocabulary
   * ("package unit", "high wall split") and register. The prompt fences it
   * hard: no fact in it may reach this visit's report.
   */
  previousWriteUp?: string;
}

/** A claim the model could not support, offered for one-tap confirmation. */
export interface ComposeAddition {
  /** The sentence, ready to drop into the field as written. */
  text: string;
  /** Which write-up field it belongs to. */
  field: WriteUpField;
}

export type WriteUpField = 'natureOfProblem' | 'workCarriedOut' | 'recommendedWork';

export interface ComposedReport {
  natureOfProblem: string;
  workCarriedOut: string;
  recommendedWork: string;
  suggestedEquipment: string[];
  suggestedChecklist: string[];
  suggestedAdditions: ComposeAddition[];
}

/** Longest suggestion list we will pass back to the client. */
export const MAX_SUGGESTIONS = 8;

/**
 * Longest confirmable-additions list. Much tighter than MAX_SUGGESTIONS:
 * each one is a claim the tradie must read and vouch for, and a wall of
 * them turns a one-tap confirmation into a form to fill in.
 */
export const MAX_ADDITIONS = 4;

/**
 * How much of a previous visit's write-up we quote as a wording reference.
 * It only has to demonstrate vocabulary and register, so a paragraph does
 * the job — and the cap keeps one tradie's essay out of every later prompt.
 */
export const MAX_PREVIOUS_WRITE_UP = 1200;

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
    'STRICTLY FACTUAL: facts may move between fields, but no new fact may be added. Never add equipment, materials, measurements, readings, part numbers, brands, times, prices, or any claim that is not already present in the notes. If a detail is not in the notes, leave it out.',
    // Length was the real complaint from tradespeople comparing this to a
    // general-purpose chatbot — not accuracy. The next three rules widen the
    // prose while holding the factual line exactly where it was.
    'WRITE IN FULL. Each supplied note should become two to five sentences of proper service-report prose, not a single clipped line. A very short note may still be one sentence — never pad with filler to reach a length.',
    // Widening the prose re-opened an old failure in a new place: with room
    // to fill, the model started manufacturing a "nature of the problem"
    // out of the mere fact that a service happened ("a scheduled service
    // was required"), which is a claim about the visit the notes never made.
    'AN EMPTY FIELD IS A CORRECT ANSWER. Only write a field when the notes contain facts that belong in it. If the notes say nothing about what the customer reported or what was found on arrival, return "natureOfProblem" as an empty string — do NOT manufacture one by restating that a service took place, and do NOT characterise the visit as scheduled, routine, preventative, an emergency, or a breakdown unless the notes say so. The same applies to "recommendedWork": no recommendation in the notes means an empty string.',
    'You MAY state the recognised, standard purpose of an action the notes say was performed — for example, cleaning condenser coils improves airflow and heat-transfer efficiency, or replacing a worn seal restores the weather seal. You MAY name the sub-parts a stated action inherently covers — for example, checking electrical components covers wiring, terminals and connections. This is describing work already in the notes, not adding work.',
    'You may NOT state any OUTCOME, RESULT, TEST, READING, or CONDITION unless the notes say it. Never write that equipment was tested, was operating normally, was left in good working order, passed a check, or was found to be within specification, unless the notes state it. These are the claims a customer relies on and only the tradesperson can make them.',
    'Use Australian English spelling.',
    'Write in a plain, factual, gender-neutral tone. Do not use "he", "she", "guys", "blokes" or similar.',
    'Do not add a greeting, sign-off, salutation, or any address to the reader (no "Hi", "Hello", "Dear", "G\'day"). Return the write-up text only.',
    'Do not mention that this text was generated or assisted by any tool.',
    'Do not invent headings.',
    'Also extract two short suggestion lists, strictly from the notes:',
    '- "suggestedEquipment": equipment or assets the notes MENTION (for example "both split systems" becomes "Split system ×2").',
    `- "suggestedChecklist": checklist-style actions the notes say WERE DONE (for example "cleaned filters" becomes "Clean air filters").`,
    `Suggestions are optional extras the tradesperson will review and choose from — nothing is added to the report automatically. Use short labels of a few words, at most ${MAX_SUGGESTIONS} entries in each list, and empty arrays when the notes mention nothing suitable.`,
    // The escape valve: rather than dropping the closing statement a service
    // report normally carries, offer it for one-tap confirmation.
    `Finally, "suggestedAdditions": when a service report would normally close with a statement the notes do NOT support — that the equipment was tested after servicing, that it was left operating correctly, that a part is nearing end of life — do NOT write that statement into the write-up. Put it here instead, as a complete sentence the tradesperson can confirm with one tap. Each entry is an object with "text" (the sentence, worded exactly as it should appear in the report) and "field" (one of "natureOfProblem", "workCarriedOut", "recommendedWork" — where the sentence belongs). At most ${MAX_ADDITIONS} entries, and an empty array when the write-up already says everything the notes support.`,
    'Reply with ONLY a JSON object, no code fences, with these keys: string values for "natureOfProblem", "workCarriedOut" and "recommendedWork" (use an empty string where nothing applies), arrays of strings for "suggestedEquipment" and "suggestedChecklist", and an array of {"text","field"} objects for "suggestedAdditions".',
  ]
    .filter(Boolean)
    .join('\n');

  const sourceBlock = present
    .map((f) => `${f.label} (${f.hint}):\n${clean(notes[f.key])}`)
    .join('\n\n');

  // Prior write-up: vocabulary only, fenced off from the facts. Tradespeople
  // have their own names for plant ("package unit", "high wall split") and a
  // report that matches last visit's language reads like theirs.
  //
  // Capped: this is free-typed text off an old report, and a tradie who
  // pasted an essay into one visit shouldn't blow out every later prompt.
  // A vocabulary sample needs a paragraph, not a document.
  const previous = clean(context?.previousWriteUp).slice(0, MAX_PREVIOUS_WRITE_UP);
  const previousBlock = previous
    ? `\n\nWORDING REFERENCE — the write-up from a PREVIOUS visit to this site. Use it ONLY to match the tradesperson's vocabulary, naming of equipment, and level of detail. It describes a DIFFERENT visit: do not carry any fact, finding, measurement or recommendation from it into this report.\n${previous}`
    : '';

  return `${rules}\n\nNOTES TO REWRITE:\n${sourceBlock}${previousBlock}`;
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

const WRITE_UP_FIELDS: WriteUpField[] = [
  'natureOfProblem',
  'workCarriedOut',
  'recommendedWork',
];

/**
 * Clamp the confirmable-additions list. Each entry must carry a non-empty
 * sentence and a field naming one of the three write-up slots; anything
 * malformed is dropped rather than guessed at, EXCEPT a bare string, which
 * the model occasionally returns instead of an object — those land under
 * work carried out, the field additions overwhelmingly belong to. Deduped on
 * the sentence, capped at MAX_ADDITIONS.
 */
function clampAdditions(value: unknown): ComposeAddition[] {
  if (!Array.isArray(value)) return [];
  const out: ComposeAddition[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    let text = '';
    let field: WriteUpField = 'workCarriedOut';
    if (typeof entry === 'string') {
      text = entry.trim();
    } else if (entry && typeof entry === 'object') {
      const raw = entry as Record<string, unknown>;
      text = typeof raw.text === 'string' ? raw.text.trim() : '';
      if (WRITE_UP_FIELDS.includes(raw.field as WriteUpField)) {
        field = raw.field as WriteUpField;
      }
    }
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, field });
    if (out.length >= MAX_ADDITIONS) break;
  }
  return out;
}

const EMPTY_COMPOSED: ComposedReport = {
  natureOfProblem: '',
  workCarriedOut: '',
  recommendedWork: '',
  suggestedEquipment: [],
  suggestedChecklist: [],
  suggestedAdditions: [],
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
 *  - Additions are clamped to at most MAX_ADDITIONS well-formed {text,field}
 *    entries — unsupported claims stay OUT of the write-up until confirmed.
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
    suggestedAdditions: [],
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
  out.suggestedAdditions = clampAdditions(parsed.suggestedAdditions);
  return out;
}
