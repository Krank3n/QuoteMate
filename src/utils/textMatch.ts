/**
 * Text folding for matching — the shared normalisation layer.
 *
 * These lived privately inside readTools.ts, where Mate's findCustomer uses
 * them, and a near-copy lived in contactService.normalizePhone. Job search
 * needs the same rules, and folding that drifts is the worst kind of bug to
 * find: "José" is findable in one screen and not another, the two rules look
 * identical at a glance, and nobody notices for a year. So there is one copy
 * and every caller shares it.
 *
 * Nothing here knows about jobs, contacts or documents — it is string work
 * only, which is what makes it cheap to test exhaustively.
 */

/** Drop combining accents so "José" and "Jose" fold together. */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Lowercase + de-accent. The baseline form for any substring compare. */
export function fold(s: string): string {
  return stripDiacritics(s).toLowerCase();
}

/**
 * Split into comparable word tokens. Apostrophes and hyphens are separators,
 * not characters, so "O'Brien-Smith" yields three tokens and matches whether
 * the tradie typed the punctuation or not.
 */
export function tokenize(s: string): string[] {
  return stripDiacritics(s.toLowerCase())
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/[\s'-]+/)
    .filter(Boolean);
}

/** Digits only — "0412 345 678" and "(04) 1234-5678" both reduce to digits. */
export function normalizeDigits(s: string): string {
  return s.replace(/[^\d]/g, '');
}

/**
 * Last 8 digits of a phone number.
 *
 * Australian numbers carry an optional +61 and a leading 0 that come and go
 * depending on where the number was typed or imported from, and the last 8
 * are the part that never changes. Matching on the tail is what makes a
 * stored "+61 412 345 678" answer to a typed "0412 345 678".
 */
export function normalizePhoneTail(s: string): string {
  return normalizeDigits(s).slice(-8);
}

/**
 * Fold and strip everything that isn't a letter or digit. Turns a document
 * number into its separator-free form ("IN-1042" → "in1042") so the query
 * matches whether or not the tradie typed the dash.
 */
export function stripNonAlnum(s: string): string {
  return fold(s).replace(/[^a-z0-9]/g, '');
}

// --- Fuzzy / phonetic name matching -----------------------------------------
//
// Moved here from readTools so the jobs-list search can reuse it without
// importing the assistant module graph (and Firestore with it).
//
// findCustomer used to be a strict substring match: "Kathryn" would not find
// "Catherine", "McKay" would not find "MacKay", and a one-letter typo killed
// the whole search. Tradies say names the way they hear them, so three cheap
// matchers layer on top of substring:
//   - Levenshtein-based similarity (typos, missing letters)
//   - A small Soundex code (sounds-like: Kathryn/Catherine, Smith/Smyth)
//   - Token-level scoring so "sarah" hits "Sarah Wilson" on either token
// Each match is tagged with how it matched so the caller can decide whether to
// trust it silently or read it back for confirmation.

export function soundex(input: string): string {
  const s = stripDiacritics(input.toUpperCase()).replace(/[^A-Z]/g, '');
  if (!s) return '';
  const first = s[0];
  const mapped = s
    .slice(1)
    .replace(/[HW]/g, '')
    .replace(/[BFPV]/g, '1')
    .replace(/[CGJKQSXZ]/g, '2')
    .replace(/[DT]/g, '3')
    .replace(/L/g, '4')
    .replace(/[MN]/g, '5')
    .replace(/R/g, '6')
    .replace(/[AEIOUY]/g, '0');
  let out = first;
  let prev = '';
  for (const ch of mapped) {
    if (ch !== '0' && ch !== prev) out += ch;
    prev = ch;
  }
  return (out.replace(/0/g, '') + '000').slice(0, 4);
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  return 1 - editDistance(a, b) / maxLen;
}

/** Score one query token against the best name token. Returns { score, kind }. */
export function scoreToken(
  qTok: string,
  nameToks: string[],
): { score: number; kind: string } {
  if (!qTok || !nameToks.length) return { score: 0, kind: 'none' };
  const qSdx = soundex(qTok);
  let best = { score: 0, kind: 'none' };
  for (const nt of nameToks) {
    if (nt === qTok) return { score: 1, kind: 'exact' };
    if (qTok.length >= 2 && nt.startsWith(qTok)) {
      if (best.score < 0.9) best = { score: 0.9, kind: 'prefix' };
      continue;
    }
    if (qTok.length >= 3 && nt.includes(qTok)) {
      if (best.score < 0.75) best = { score: 0.75, kind: 'substring' };
    }
    const sim = similarity(qTok, nt);
    if (sim >= 0.72 && sim > best.score) best = { score: sim, kind: 'fuzzy' };
    if (qSdx && qSdx === soundex(nt) && best.score < 0.7) {
      best = { score: 0.7, kind: 'sounds_like' };
    }
  }
  return best;
}
