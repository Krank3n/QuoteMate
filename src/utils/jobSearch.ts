/**
 * Searching the jobs list.
 *
 * The old search was one naive `includes()` over three fields — customer name,
 * job name, address. Everything a tradie actually has in hand when they need a
 * job missed: a customer rings from a number you don't recognise, or quotes
 * "invoice 1042", or you type "jones pergola" and get nothing because the two
 * words live in different fields. A trailing space killed every match.
 *
 * So: an index built once per data change, and multi-token AND matching over
 * every handle the job carries — name, address, description, notes, email,
 * phone digits, and the numbers on its attached documents.
 *
 * Deliberately NOT indexed: checklist item text. It's a brain-dump ("90mm
 * screws", "call Dave"), and folding it in makes common trade nouns match half
 * the list with no visible reason why the row is there. One push to add later
 * if that turns out to be wrong — a test pins the exclusion so the decision is
 * recorded rather than re-argued.
 *
 * Results come back in the order they were given. Ranking by relevance is the
 * caller's business and deliberately isn't done here: the list has a visible
 * sort control, and quietly re-ordering behind it makes that control a lie —
 * the exact failure jobStatusTimestamp was written to fix.
 */

import type { Job } from '../../shared/job/types';
import type { Document } from '../types/document';
import {
  fold,
  normalizeDigits,
  normalizePhoneTail,
  scoreToken,
  stripNonAlnum,
  tokenize,
} from './textMatch';

/**
 * Field separator inside the haystack. U+241F (SYMBOL FOR UNIT SEPARATOR) can't
 * appear in a folded query token, so a single token can never match by
 * bridging the end of one field and the start of the next.
 */
const FIELD_SEP = '␟';

/**
 * Below this many digits a numeric query isn't treated as a phone number or a
 * document number. Without the floor, "12" matches every phone number and
 * every invoice on the books; with it, "12" still matches "12 Smith St".
 */
const MIN_DIGIT_QUERY = 3;

/** Shortest single-token query allowed to fall through to the fuzzy pass. */
const MIN_FUZZY_QUERY = 3;

/**
 * Score at which a fuzzy name match is close enough to show.
 *
 * 0.7 rather than scoreToken's own 0.72 similarity floor, deliberately: a
 * sounds-like (soundex) hit scores exactly 0.7, and at 0.72 the phonetic tier
 * would be dead code — "Smyth" would never find "Smith", which is the main
 * thing this fallback exists to do.
 */
const FUZZY_THRESHOLD = 0.7;

export interface JobSearchEntry {
  id: string;
  /** Every free-text field, folded, joined by FIELD_SEP. */
  text: string;
  /** Digits-only forms of the job's phone — full, plus the last-8 tail. */
  digits: string[];
  /** Attached document numbers, separator-free: 'IN-1042' → 'in1042'. */
  docNumbers: string[];
  /** Name tokens only (customer + job name) — the fuzzy pass's haystack. */
  nameTokens: string[];
}

export type JobSearchIndex = Map<string, JobSearchEntry>;

export interface JobSearchQuery {
  tokens: string[];
}

/**
 * Parse a raw query box value.
 *
 * Returns null for an empty or whitespace-only query so the caller can skip
 * filtering entirely rather than matching everything one token at a time.
 * Trimming here is what fixed "jones " matching nothing.
 */
export function parseJobSearchQuery(raw: string): JobSearchQuery | null {
  const folded = fold(raw ?? '').trim();
  if (!folded) return null;
  const tokens = folded.split(/\s+/).filter(Boolean);
  return tokens.length ? { tokens } : null;
}

function buildEntry(job: Job, docs: Document[]): JobSearchEntry {
  const parts: string[] = [];
  const push = (v?: string | null) => {
    if (v) parts.push(fold(v));
  };

  push(job.customerName);
  push(job.name);
  push(job.jobAddress);
  push(job.description);
  push(job.notes);
  push(job.customerEmail);

  const digits: string[] = [];
  if (job.customerPhone) {
    const full = normalizeDigits(job.customerPhone);
    if (full) {
      digits.push(full);
      // The last 8 are the part that survives a +61 / leading-0 rewrite, so
      // a stored "+61 412 345 678" still answers to a typed "0412 345 678".
      const tail = normalizePhoneTail(job.customerPhone);
      if (tail && tail !== full) digits.push(tail);
    }
  }

  const docNumbers: string[] = [];
  for (const d of docs) {
    if (!d?.number) continue;
    // Raw form goes in the text so "IN-1042" matches as typed; the
    // separator-free form is matched separately so "in1042" hits too.
    push(d.number);
    const alnum = stripNonAlnum(d.number);
    if (alnum) docNumbers.push(alnum);
  }

  return {
    id: job.id,
    text: parts.join(` ${FIELD_SEP} `),
    digits,
    docNumbers,
    nameTokens: [...tokenize(job.customerName || ''), ...tokenize(job.name || '')],
  };
}

export function buildJobSearchIndex(
  jobs: Job[],
  docsByJob: Map<string, Document[]>,
): JobSearchIndex {
  const index: JobSearchIndex = new Map();
  for (const job of jobs) {
    if (!job?.id) continue;
    index.set(job.id, buildEntry(job, docsByJob.get(job.id) ?? []));
  }
  return index;
}

/** Whether one query token hits this job anywhere. */
function tokenMatches(entry: JobSearchEntry, tok: string): boolean {
  if (entry.text.includes(tok)) return true;

  const alnum = stripNonAlnum(tok);
  if (alnum && entry.docNumbers.some((n) => n.includes(alnum))) return true;

  const digits = normalizeDigits(tok);
  if (digits.length >= MIN_DIGIT_QUERY && entry.digits.some((d) => d.includes(digits))) {
    return true;
  }

  return false;
}

/** AND across tokens: every token must hit somewhere on the job. */
export function entryMatches(entry: JobSearchEntry, q: JobSearchQuery): boolean {
  return q.tokens.every((tok) => tokenMatches(entry, tok));
}

/** Whether a single-token query is close enough to one of the job's names. */
function entryMatchesFuzzy(entry: JobSearchEntry, tok: string): boolean {
  return scoreToken(tok, entry.nameTokens).score >= FUZZY_THRESHOLD;
}

/**
 * Filter jobs by the raw query box value, preserving input order.
 *
 * Returns the input array itself for an empty query so callers can rely on
 * identity and skip downstream work.
 */
export function filterJobsBySearch<T extends Job>(
  jobs: T[],
  index: JobSearchIndex,
  raw: string,
): T[] {
  const q = parseJobSearchQuery(raw);
  if (!q) return jobs;

  const strict = jobs.filter((j) => {
    const entry = index.get(j.id);
    return entry ? entryMatches(entry, q) : false;
  });
  if (strict.length > 0) return strict;

  // Nothing matched exactly. Widen to sounds-like / one-typo-off on names
  // only, and only for a single word — "Kathryn" should find "Catherine".
  // A query that already had hits is never widened: fuzzy over notes and
  // street names at this threshold surfaces rows the tradie can't explain.
  if (q.tokens.length !== 1 || q.tokens[0].length < MIN_FUZZY_QUERY) return strict;

  const tok = q.tokens[0];
  return jobs.filter((j) => {
    const entry = index.get(j.id);
    return entry ? entryMatchesFuzzy(entry, tok) : false;
  });
}
