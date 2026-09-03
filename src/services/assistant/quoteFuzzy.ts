// Fuzzy match helpers for list_recent_quotes.
//
// STT and tradie shorthand both produce queries that don't exactly equal the
// stored jobName / customerName — "raise debt" ↔ "raised deck", "gigarr" ↔
// "Gigar". A cheap token-level Levenshtein + substring score handles both
// without a real search index. Kept dependency-free so the unit tests don't
// have to pull the rest of readTools.ts (which transitively loads
// react-native).

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const curr = new Array(n + 1);
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

// A token from the query "closely matches" a haystack if any whitespace-token
// in the haystack is within an edit distance that scales with token length
// (cap 2). Skips 1-2 char query tokens — those are too noisy to fuzzy-match.
function tokenCloseMatch(needle: string, haystack: string): boolean {
  if (needle.length < 3) return false;
  const tokens = haystack.split(/\s+/).filter(Boolean);
  const cap = Math.min(2, Math.floor(needle.length / 3));
  if (cap < 1) return false;
  for (const tok of tokens) {
    if (Math.abs(tok.length - needle.length) > cap) continue;
    if (levenshtein(needle, tok) <= cap) return true;
  }
  return false;
}

/**
 * The digits a tradie says for a document number, with leading zeros gone:
 * "004", "inv 4", "invoice 004", "QU-178840" all reduce to the digit run.
 * Only the numeric part is compared — the prefix is the app's, not theirs.
 */
export function documentNumberKey(text: string | undefined): string {
  const m = /\d+/.exec(text || '');
  return m ? m[0].replace(/^0+(?=\d)/, '') : '';
}

export function fuzzyScoreQuote(
  query: string,
  jobName: string | undefined,
  customerName: string | undefined,
  number?: string,
): number {
  const q = (query || '').toLowerCase().trim();
  // "Edit invoice 004" came back "couldn't find that one" (3 Sep 2026): the
  // number on the document was never part of the match. A query that is a
  // number (with or without inv/qu/invoice/quote around it) hits its document
  // outright — checked before the length floor, since "4" is a fine number.
  const numberKey = documentNumberKey(number);
  if (numberKey && /^(?:(?:inv|invoice|qu|quote|q|number|no\.?|#)\s*[-#]?\s*)?0*\d+$/i.test(q) && documentNumberKey(q) === numberKey) {
    return 60;
  }
  // Single-char queries are noise — they substring-match every doc.
  if (q.length < 2) return 0;
  const j = (jobName || '').toLowerCase();
  const c = (customerName || '').toLowerCase();
  const hay = `${j} ${c}`.trim();
  if (!hay) return 0;
  let score = 0;
  if (hay.includes(q)) score += 30;
  const qTokens = q.split(/\s+/).filter(Boolean);
  let hits = 0;
  for (const t of qTokens) {
    if (hay.includes(t)) {
      hits++;
      score += 8;
      continue;
    }
    if (tokenCloseMatch(t, j) || tokenCloseMatch(t, c)) {
      hits++;
      score += 5;
    }
  }
  // Bonus when every query token matched something — the whole phrase landed.
  if (qTokens.length > 1 && hits === qTokens.length) score += 10;
  return score;
}
