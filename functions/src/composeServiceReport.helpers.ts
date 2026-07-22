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
 *   sanitizeComposed   — cleans the model output back into the three fields.
 *
 * The discipline mirrors src/utils/sanitizeJobDescription.ts: the rewrite is
 * STRICTLY FACTUAL. The model may tidy grammar and tone but must never invent
 * equipment, measurements, part numbers, or claims that aren't in the note.
 * An empty source note always yields an empty output field — the model is
 * never allowed to fill a blank.
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
}

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
 * tradie actually filled in are included, so the model is never handed a blank
 * to complete. The instruction forbids invention, demands Australian English
 * and gender-neutral wording, bans any greeting, and requires a JSON reply
 * keyed by the field names so sanitizeComposed can parse it deterministically.
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
    'Rewrite ONLY the notes provided below into clear, professional prose.',
    'Use Australian English spelling.',
    'Write in a plain, factual, gender-neutral tone. Do not use "he", "she", "guys", "blokes" or similar.',
    'STRICTLY FACTUAL: rewrite only what is in the note. Never add equipment, materials, measurements, part numbers, brands, times, prices, or any claim that is not already present. If a detail is not in the note, leave it out.',
    'Do not add a greeting, sign-off, salutation, or any address to the reader (no "Hi", "Hello", "Dear", "G\'day"). Return the write-up text only.',
    'Do not mention that this text was generated or assisted by any tool.',
    'Keep each field to a sentence or two. Do not invent headings.',
    'Reply with ONLY a JSON object, no code fences, with a string value for each of these keys: '
      + present.map((f) => `"${f.key}"`).join(', ')
      + '. Do not include keys that were not supplied.',
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
 * Turn a raw model reply into the three write-up fields.
 *
 * Rules:
 *  - A field whose SOURCE note was empty is always blank, whatever the model
 *    returned — the model is never allowed to fill a gap.
 *  - A leading greeting the model added is stripped.
 *  - If the model dropped a field that had a source note, the tradie's own
 *    (trimmed) note is kept rather than losing their factual content.
 */
export function sanitizeComposed(raw: string, notes: ComposeNotes): ComposedReport {
  const parsed = extractJson(raw) || {};
  const out = {} as ComposedReport;

  for (const f of FIELDS) {
    const source = clean(notes[f.key]);
    if (!source) {
      out[f.key] = '';
      continue;
    }
    const modelValue = typeof parsed[f.key] === 'string' ? (parsed[f.key] as string) : '';
    const chosen = clean(modelValue) || source;
    out[f.key] = stripLeadingGreeting(chosen);
  }

  return out;
}
