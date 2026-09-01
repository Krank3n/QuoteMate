// Match a tradie's job blurb to a niche template.
//
// This replaces whole-string edit distance, which compared spelling rather
// than meaning and produced answers that were not merely wrong but absurd:
//
//   "2 meter by 5 meter deck"    -> Split System Service   (an air conditioner)
//   "deck repair"                -> Fence Repair
//   "deck board replacement"     -> Gutter Replacement
//   "decking board replacement"  -> Cabinet Door Replacement
//   "new deck"                   -> nothing at all
//
// The failure is structural. Edit distance rewards long shared substrings, so
// a blurb latches onto whichever template shares its most COMMON word —
// "repair", "replacement", "service" — while the word that actually says what
// the job is gets no more weight than any other. Mate then asks a tradie
// quoting a deck about their air conditioner, or asks nothing at all.
//
// So score by words, and weight each word by how rare it is across the
// template names. "repair" appears in many templates and settles nothing;
// "deck" appears in few and settles everything.

/**
 * Words that carry no signal about which trade a job belongs to. Kept short on
 * purpose — a stop word that is really a subject ("gate", "door") would make
 * the job it names unmatchable.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'of', 'to', 'my', 'me', 'we', 'our',
  'some', 'new', 'old', 'job', 'quote', 'invoice', 'please', 'with', 'on',
  'at', 'in', 'it', 'is', 'by', 'x', 'about', 'need', 'want', 'like', 'do',
  'doing', 'get', 'got', 'metre', 'metres', 'meter', 'meters', 'm', 'sqm',
]);

/**
 * Light stemming so "decking" and "deck", "fences" and "fence" meet.
 *
 * Deliberately crude — this only has to align a job blurb with 57 short
 * template names, and an aggressive stemmer would collapse distinct trades.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  // Only a true -es plural drops both letters ("boxes" -> "box"). Applying it
  // everywhere turned "fences" into "fenc", which then matched no fence
  // template at all.
  else if (w.length > 4 && /(?:s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

/** Words worth matching on: no punctuation, no digits, no filler. */
export function tokenise(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !/^\d+$/.test(t) && !STOP_WORDS.has(t))
    .map(stem)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * How much each word narrows things down, from the template names themselves.
 *
 * A word in one template name identifies it; a word in twenty identifies
 * nothing. Derived rather than hand-listed, so it stays true as niches are
 * added.
 */
export function buildWordWeights(names: string[]): Map<string, number> {
  const docCount = new Map<string, number>();
  for (const name of names) {
    for (const token of new Set(tokenise(name))) {
      docCount.set(token, (docCount.get(token) ?? 0) + 1);
    }
  }
  const weights = new Map<string, number>();
  for (const [token, seenIn] of docCount) {
    weights.set(token, Math.log(names.length / seenIn) + 1);
  }
  return weights;
}

/**
 * How well a blurb matches one template name, from 0 to 1.
 *
 * Measured against the TEMPLATE's words, not the blurb's: a tradie says far
 * more than the name of their trade, and every extra word they use should not
 * count against the match.
 */
export function scoreName(
  freeText: string,
  templateName: string,
  weights: Map<string, number>,
): number {
  // The tradie said the niche's name outright — nothing to weigh up.
  const ft = String(freeText || '').toLowerCase().trim();
  const name = String(templateName || '').toLowerCase().trim();
  if (ft && name && (ft.includes(name) || name.includes(ft))) return 1;

  const blurbOrder = tokenise(freeText);
  const blurb = new Set(blurbOrder);
  const nameTokens = new Set(tokenise(templateName));
  if (!blurb.size || !nameTokens.size) return 0;

  let matched = 0;
  let possible = 0;
  for (const token of nameTokens) {
    const weight = weights.get(token) ?? 1;
    possible += weight;
    if (blurb.has(token)) matched += weight;
  }
  if (possible <= 0) return 0;

  // Matching one word out of two scores the same either way, which left "deck
  // repair" tied between Deck Build and Fence Repair — and Fence Repair won on
  // iteration order. Break it on the blurb's OWN most distinctive word: the
  // one that says what the job is. A template that doesn't mention it is
  // answering a different question.
  const subject = subjectWord(blurbOrder, weights);
  const onSubject = !subject || nameTokens.has(subject) ? 1 : OFF_SUBJECT_PENALTY;
  return onSubject * (matched / possible);
}

/** Penalty for a template that misses the blurb's defining word. */
export const OFF_SUBJECT_PENALTY = 0.5;

/**
 * The rarest word in the blurb that any template actually uses — the subject.
 *
 * Words the templates have never heard of are skipped: they say nothing about
 * which niche is meant, however unusual they are.
 */
export function subjectWord(
  blurbTokens: string[],
  weights: Map<string, number>,
): string | null {
  let best: string | null = null;
  let bestWeight = -1;
  for (const token of blurbTokens) {
    const weight = weights.get(token);
    if (weight === undefined) continue;
    // `>=` so an equally-rare later word wins. English compounds are
    // head-final — "timber deck" is a deck, "colorbond fence" is a fence — and
    // with `>` the tie went to the material and matched Timber Paling Fence.
    if (weight >= bestWeight) { bestWeight = weight; best = token; }
  }
  return best;
}

/**
 * Below this, a blurb has not identified a niche and it is better to say so
 * than to guess. Guessing is what put an air conditioner in front of someone
 * quoting a deck.
 */
export const NICHE_MATCH_FLOOR = 0.34;
