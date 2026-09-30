/**
 * Is this job description a WRITTEN SCOPE — the tradie's own numbered or
 * bulleted list of work items ("1. Remove cupboards… 2. Frame WIR…
 * 3. Demolish ensuite…")?
 *
 * When it is, the analyse pass asks for a short customer-facing description
 * per section restating the tradie's items, and the pipeline puts it on the
 * new sections so it prints under each section heading. Anything else — a
 * one-liner, a prose paragraph, two items — is left exactly as it was.
 *
 * Pure, and imports nothing: the analyse function (functions/src/index.ts)
 * and the pipeline (shared/pricing/pipeline.ts) must agree on the answer.
 */

/** Fewest list items that make a written scope. */
export const WRITTEN_SCOPE_MIN_ITEMS = 3;
/** Shortest trimmed description (in characters) that makes a written scope. */
export const WRITTEN_SCOPE_MIN_CHARS = 200;

/**
 * A number that starts a list item: "1." "2)" "3:" "4 -" "5 –" "6 —", with
 * an optional "Step" ("Step 1:"). The marker must be followed by whitespace,
 * so "1:100 scale", "7:30am" and "2.4m" never count.
 */
const NUMBERED = String.raw`(?:step\s*)?(\d{1,2})(?:[.):]|\s+[-–—])`;
/**
 * A line that starts a list item: a numbered marker, a lettered one ("a)"
 * "(b)"), or a bullet — any single symbol or emoji that isn't a letter or a
 * digit ("-" "*" "•" "·" "–" "—" "▪" "✅" "🔨"), optionally with an emoji
 * variation selector. "$", quotes and opening brackets aren't bullets.
 * Written without the `u` flag or \p{…} so every JS engine we ship on
 * (Hermes included) reads it the same way; an astral emoji is a surrogate
 * pair.
 */
const BULLET = String.raw`(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[^A-Za-z0-9\s$"'“‘(\[])\uFE0F?`;
const LIST_ITEM_LINE = new RegExp(String.raw`^\s*(?:${NUMBERED}|\(?[a-z]\)|${BULLET})\s+\S`, 'i');
/** The same list-item marker, captured so it can be stripped. */
const LIST_ITEM_PREFIX = new RegExp(String.raw`^(\s*)((?:${NUMBERED})|\(?[a-z]\)|${BULLET})\s+(?=\S)`, 'i');

/**
 * One line of a job description, as a list item: its indent, whether its
 * marker is a number, and its text without the marker. Null when the line
 * isn't a list item.
 */
export function parseListItem(line: string): { indent: number; numbered: boolean; body: string } | null {
  if (!LIST_ITEM_LINE.test(line)) return null;
  const m = LIST_ITEM_PREFIX.exec(line);
  if (!m) return null;
  return { indent: m[1].length, numbered: /\d/.test(m[2]), body: line.slice(m[0].length).trim() };
}
/**
 * A numbered marker anywhere in the text — dictated scopes arrive without
 * newlines ("1. Remove cupboards 2. Frame WIR 3. …"). Prose is full of
 * "at 7." and "bedrooms 1. and 2.", so inline markers only count while they
 * run 1, 2, 3… in order.
 */
const INLINE_NUMBERED_MARKER = new RegExp(String.raw`(?:^|\s)${NUMBERED}(?=\s+\S)`, 'gi');

/** Length of the ascending run 1, 2, 3… among the inline numbered markers. */
function inlineRunLength(text: string): number {
  const re = new RegExp(INLINE_NUMBERED_MARKER.source, INLINE_NUMBERED_MARKER.flags);
  let next = 1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (Number(match[1]) === next) next++;
  }
  return next - 1;
}

export function isWrittenScope(text: string | null | undefined): boolean {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < WRITTEN_SCOPE_MIN_CHARS) return false;
  const lineItems = trimmed.split(/\r?\n/).filter((line) => LIST_ITEM_LINE.test(line)).length;
  // Numbered lines match both counts, so take the larger rather than adding.
  return Math.max(lineItems, inlineRunLength(trimmed)) >= WRITTEN_SCOPE_MIN_ITEMS;
}
