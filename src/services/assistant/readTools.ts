// Mate read tools — the client-side source of truth (no server-side copy).
//
// Why client-side: Gemini Live runs the tool-calling loop inside the WS
// session. The model emits a toolCall, the client executes it locally, and
// the response is sent back over the same socket. There is no opportunity
// to bounce through a server. Firestore security rules already gate every
// read by uid so this is no looser than a server path would be.
//
// These result shapes are contractual: the system prompt describes specific
// shapes (matches[], lastJob, phoneMasked, etc.), so changing them changes
// how Mate reasons about results.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
  QueryConstraint,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { Material } from '../../types';
import { reviewQuoteMaterials } from '../../utils/quoteReview';
import { isProposalId, resolveQuoteId } from './quoteRefMap';
import { fuzzyScoreQuote } from './quoteFuzzy';

function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in.');
  return uid;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '').slice(-8);
}



// --- Fuzzy / phonetic helpers -----------------------------------------------
//
// findCustomer used to be a strict substring match: "Kathryn" would not find
// "Catherine", "McKay" would not find "MacKay", and a one-letter typo killed
// the whole search. Tradies say names the way they hear them, so we now layer
// three cheap matchers on top of substring:
//   - Levenshtein-based similarity (typos, missing letters)
//   - A small Soundex code (sounds-like: Kathryn/Catherine, Smith/Smyth)
//   - Token-level scoring so "sarah" hits "Sarah Wilson" on either token
// Each match is tagged with how it matched so Mate can decide whether to
// trust it silently or read it back for confirmation.

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokenize(s: string): string[] {
  return stripDiacritics(s.toLowerCase())
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/[\s'-]+/)
    .filter(Boolean);
}

function soundex(input: string): string {
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

function editDistance(a: string, b: string): number {
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

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  return 1 - editDistance(a, b) / maxLen;
}

// Score one query token against the best name token. Returns { score, kind }.
function scoreToken(qTok: string, nameToks: string[]): { score: number; kind: string } {
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

function maskPhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 4) return undefined;
  return `...${digits.slice(-4)}`;
}

function tsToIso(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof (v as any)?.toDate === 'function') return (v as any).toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return new Date(v).toISOString();
  return undefined;
}

function serialize(v: unknown): unknown {
  if (v == null) return v;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof (v as any)?.toDate === 'function') return (v as any).toDate().toISOString();
  if (Array.isArray(v)) return v.map(serialize);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = serialize(val);
    return out;
  }
  return v;
}

export async function findCustomer(input: { query: string }): Promise<unknown> {
  const uid = requireUid();
  const q = (input.query || '').trim();
  if (!q) return { matches: [], note: 'Empty query.' };

  const contactsRef = collection(db, 'users', uid, 'contacts');
  const snap = await getDocs(query(contactsRef, fsLimit(500)));
  const qLower = stripDiacritics(q.toLowerCase());
  const qTokens = tokenize(q);
  const qPhone = normalizePhone(q);
  const isPhoneQuery = qPhone.length >= 4;

  type Scored = { score: number; id: string; data: any; matchType: string; confidence: number };
  const scored: Scored[] = [];

  for (const d of snap.docs) {
    const data = d.data();
    const rawName = String(data.name || '');
    const nameLower = stripDiacritics(rawName.toLowerCase());
    const nameTokens = tokenize(rawName);
    const phone = data.phone ? normalizePhone(String(data.phone)) : '';

    // Phone hits are unambiguous — short-circuit.
    if (isPhoneQuery && phone && (phone === qPhone || phone.endsWith(qPhone))) {
      scored.push({ score: 1000, id: d.id, data, matchType: 'phone', confidence: 1 });
      continue;
    }
    if (!qTokens.length) continue;

    // Whole-string fast paths first.
    if (nameLower === qLower) {
      scored.push({ score: 500, id: d.id, data, matchType: 'exact', confidence: 1 });
      continue;
    }

    // Token-level: average each query token's best name-token score.
    let total = 0;
    let worstKind = 'exact';
    const kindRank: Record<string, number> = {
      exact: 0, prefix: 1, substring: 2, fuzzy: 3, sounds_like: 4, none: 5,
    };
    for (const t of qTokens) {
      const r = scoreToken(t, nameTokens);
      total += r.score;
      if ((kindRank[r.kind] ?? 5) > (kindRank[worstKind] ?? 0)) worstKind = r.kind;
    }
    const avg = total / qTokens.length;
    if (avg < 0.6) continue;

    // Bonus when the query is a clean prefix of the full name ("sar" → "Sarah Wilson").
    const prefixBonus = nameLower.startsWith(qLower) ? 0.05 : 0;
    const confidence = Math.min(1, avg + prefixBonus);

    let matchType: string;
    if (confidence >= 0.97) matchType = 'exact';
    else if (worstKind === 'prefix' || worstKind === 'substring' || confidence >= 0.88) matchType = 'close';
    else if (worstKind === 'sounds_like') matchType = 'sounds_like';
    else matchType = 'fuzzy';

    scored.push({ score: confidence * 100, id: d.id, data, matchType, confidence });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);

  // Augment top hits with their most recent document so Mate can disambiguate
  // ("Sarah W — deck job last week vs Sarah M — bathroom in March").
  const documentsRef = collection(db, 'users', uid, 'documents');
  const matches = await Promise.all(
    top.map(async ({ id, data }) => {
      let lastJob: { jobName?: string; total?: number; createdAt?: string } | undefined;
      try {
        const docs = await getDocs(
          query(documentsRef, where('contactId', '==', id), orderBy('createdAt', 'desc'), fsLimit(1)),
        );
        if (!docs.empty) {
          const dData = docs.docs[0].data();
          lastJob = {
            jobName: dData.jobName || dData.job?.name,
            total: typeof dData.total === 'number' ? dData.total : undefined,
            createdAt: tsToIso(dData.createdAt),
          };
        }
      } catch {
        // contactId may not be indexed for very old data — leave undefined.
      }
      return {
        contactId: id,
        name: data.name,
        phoneMasked: maskPhone(data.phone),
        hasEmail: !!data.email,
        lastJob,
      };
    }),
  );

  // Tell Mate how sure we are. ambiguous = top match isn't clearly ahead, so
  // it needs to confirm with the tradie instead of silently picking #1.
  const topHit = top[0];
  const runnerUp = top[1];
  const confidence = topHit ? topHit.confidence : 0;
  const ambiguous =
    !!topHit &&
    topHit.matchType !== 'phone' &&
    topHit.matchType !== 'exact' &&
    (runnerUp ? topHit.confidence - runnerUp.confidence < 0.15 : topHit.confidence < 0.9);
  const needsConfirmation =
    ambiguous || (!!topHit && topHit.matchType !== 'phone' && topHit.matchType !== 'exact');

  const matchesWithMeta = matches.map((m, i) => ({
    ...m,
    matchType: top[i].matchType,
    confidence: Math.round(top[i].confidence * 100) / 100,
  }));

  return {
    matches: matchesWithMeta,
    confidence,
    ambiguous,
    needsConfirmation,
    totalScanned: snap.size,
  };
}

export async function listRecentQuotes(input: {
  query?: string;
  limit?: number;
  status?: string;
  daysBack?: number;
}): Promise<unknown> {
  const uid = requireUid();
  const rowLimit = Math.min(Math.max(input.limit ?? 10, 1), 25);
  const rawQuery = typeof input.query === 'string' ? input.query.trim() : '';
  const hasQuery = rawQuery.length > 0;
  // When the model is searching for a specific quote, widen the underlying
  // fetch so a small recency window doesn't hide the match.
  const fetchLimit = hasQuery ? Math.max(rowLimit, 25) : rowLimit;

  // New drafts land in users/{uid}/quotes on the client and only get
  // mirrored into users/{uid}/documents seconds-to-minutes later by the
  // onQuoteWritten Cloud Function. If we only read documents, a draft
  // Mate just created via Apply is invisible to it for the rest of the
  // conversation. Query both, merge by id, sort by createdAt.
  const documentsRef = collection(db, 'users', uid, 'documents');
  const quotesRef = collection(db, 'users', uid, 'quotes');

  const docConstraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
  if (input.status) docConstraints.push(where('stage', '==', input.status));
  if (input.daysBack) {
    const cutoff = new Date(Date.now() - input.daysBack * 24 * 60 * 60 * 1000);
    docConstraints.push(where('createdAt', '>=', cutoff));
  }
  docConstraints.push(fsLimit(fetchLimit));

  // The legacy quotes collection doesn't carry the `stage` field on every
  // row, and `daysBack` filtering is unreliable across schema drift, so
  // pull a fat slice and filter in memory.
  const quoteConstraints: QueryConstraint[] = [orderBy('createdAt', 'desc'), fsLimit(fetchLimit * 2)];

  const [docSnap, quoteSnap] = await Promise.all([
    getDocs(query(documentsRef, ...docConstraints)),
    getDocs(query(quotesRef, ...quoteConstraints)).catch(() => null),
  ]);

  const seen = new Set<string>();
  const merged: any[] = [];

  for (const d of docSnap.docs) {
    seen.add(d.id);
    const data = d.data();
    merged.push({
      id: d.id,
      type: data.type,
      stage: data.stage,
      status: data.stage,
      number: data.number,
      customerName: data.customerName,
      jobName: data.jobName || data.job?.name,
      total: typeof data.total === 'number' ? data.total : undefined,
      createdAt: tsToIso(data.createdAt),
      updatedAt: tsToIso(data.updatedAt),
      _source: 'documents' as const,
    });
  }

  if (quoteSnap) {
    for (const d of quoteSnap.docs) {
      if (seen.has(d.id)) continue;
      const data = d.data();
      const stage = data.stage || data.status || 'draft';
      if (input.status && stage !== input.status) continue;
      if (input.daysBack) {
        const created = tsToIso(data.createdAt);
        if (created) {
          const cutoff = Date.now() - input.daysBack * 24 * 60 * 60 * 1000;
          if (new Date(created).getTime() < cutoff) continue;
        }
      }
      seen.add(d.id);
      merged.push({
        id: d.id,
        type: 'quote',
        stage,
        status: stage,
        number: data.number,
        customerName: data.customerName,
        jobName: data.job?.name || data.jobName,
        total: typeof data.total === 'number' ? data.total : undefined,
        createdAt: tsToIso(data.createdAt),
        updatedAt: tsToIso(data.updatedAt),
        _source: 'quotes' as const,
      });
    }
  }

  merged.sort((a, b) => {
    const aT = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bT = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bT - aT;
  });

  if (hasQuery) {
    const scored = merged
      .map((row) => ({ row, score: fuzzyScoreQuote(rawQuery, row.jobName, row.customerName) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const aT = a.row.createdAt ? Date.parse(a.row.createdAt) : 0;
        const bT = b.row.createdAt ? Date.parse(b.row.createdAt) : 0;
        return bT - aT;
      })
      .slice(0, rowLimit)
      .map((x) => x.row);
    return {
      query: rawQuery,
      documents: scored,
      note:
        scored.length === 0
          ? 'No fuzzy matches for that query against recent docs — either it really isn\'t there, or call again without `query` to list recents and read them to the tradie.'
          : undefined,
    };
  }

  return { documents: merged.slice(0, rowLimit) };
}

export async function getQuote(input: { quoteId: string }): Promise<unknown> {
  const uid = requireUid();
  // The model often passes the proposal id (from propose_*'s response) instead
  // of the minted quote id. Translate it back to the real id when we know it.
  const docId = resolveQuoteId(input.quoteId);
  if (!docId) return { error: 'Missing quoteId.' };
  // Still proposal-shaped after resolving → no quote was ever minted for it
  // (or this session lost the mapping). Guide Mate to recover instead of a 404.
  if (isProposalId(docId)) {
    return {
      error:
        'That is a proposal id, not a quote id — a quote id only exists after the tradie taps Apply. Call list_recent_quotes to find the real quote id.',
    };
  }

  const snap = await getDoc(doc(db, 'users', uid, 'documents', docId));
  if (!snap.exists()) {
    // Mirror the server's legacy fallback — very fresh records may not have
    // been mirrored into /documents yet.
    const legacy = await getDoc(doc(db, 'users', uid, 'quotes', docId));
    if (!legacy.exists()) return { error: 'Quote not found.' };
    return { quote: serialize(legacy.data()) };
  }
  const data = snap.data() || {};
  // Drop fields Mate doesn't reason over (photo blobs, raw HTML).
  const trimmed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'photos' || k === 'photoBase64' || k.endsWith('Html')) continue;
    trimmed[k] = serialize(v);
  }
  return { quote: trimmed };
}

export async function reviewQuote(input: { quoteId: string }): Promise<unknown> {
  // Reuse getQuote's doc/legacy lookup, then read the pipeline's per-row flags
  // via the shared classifier. Returns a compact summary + the flagged rows
  // only — Mate doesn't need the full materials array to talk about problems.
  const quoteId = resolveQuoteId(input.quoteId);
  const res = (await getQuote({ quoteId })) as { quote?: any; error?: string };
  if (!res || res.error || !res.quote) {
    return { error: res?.error || 'Quote not found.' };
  }
  const q = res.quote;
  const review = reviewQuoteMaterials((q.materials as Material[]) || []);
  return {
    quoteId,
    number: q.number,
    jobName: q.jobName || q.job?.name,
    customerName: q.customerName,
    summary: review.summary,
    counts: review.counts,
    issues: review.issues,
  };
}

export async function getBusinessDefaults(): Promise<unknown> {
  const uid = requireUid();
  const snap = await getDoc(doc(db, 'users', uid, 'settings', 'business'));
  if (!snap.exists()) return { error: 'No business settings yet.' };
  const data = snap.data() || {};
  return {
    businessName: data.businessName,
    tradeCategoryId: data.tradeCategoryId,
    tradeCategoryName: data.tradeCategoryName,
    defaultLaborRate: data.defaultLaborRate,
    defaultMarkup: data.defaultMarkup,
    defaultLaborMarkup: data.defaultLaborMarkup,
    pricesIncludeGst: data.pricesIncludeGst,
    abn: data.abn ? `...${String(data.abn).slice(-4)}` : undefined,
  };
}
