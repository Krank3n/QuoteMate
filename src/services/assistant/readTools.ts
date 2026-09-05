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
import { resolveSupplierBookLookup } from './supplierBookLookup';
import { isProposalId, resolveQuoteId } from './quoteRefMap';
import { missingQuoteMessage, type CandidateRow } from './quoteLookupRecovery';
import { fuzzyScoreQuote } from './quoteFuzzy';
import { getPillsForNiche } from '../../data/nichePills';
import { NICHE_TEMPLATES } from '../../data/nicheTemplates';
import { buildWordWeights, scoreName, NICHE_MATCH_FLOOR } from './nicheMatch';
import { isSpecialistSupplyNiche } from '../../data/specialistSupplyNiches';
import { coversProbes, type SupplierBookSnapshot } from '../supplierBookCoverage';
// Folding rules are shared with the jobs-list search — see src/utils/textMatch.
// If they drift, a name is findable by Mate and not by the jobs list.
import {
  normalizePhoneTail as normalizePhone,
  scoreToken,
  soundex,
  stripDiacritics,
  tokenize,
} from '../../utils/textMatch';

function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in.');
  return uid;
}



// --- Fuzzy / phonetic helpers -----------------------------------------------
//
// The matchers themselves now live in src/utils/textMatch (imported above), so
// the jobs-list search folds and scores names identically without importing
// this module — and with it, Firestore — into a pure util. See that file for
// why findCustomer stopped being a strict substring match.

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

// A flat customer record to score, drawn from any source (saved contacts,
// recent quotes, Xero, the phone book). findCustomer merges several of these
// before scoring so the model sees one ranked list regardless of where a name
// actually lives.
export interface CustomerCandidate {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  source: 'saved' | 'recent' | 'phone';
}

// A phone-book or recent-quote hit is not a saved contact, so its details
// have to travel to Apply somehow — but never through the model: every
// match already masks the phone, and the tool response is logged to
// Firestore and read at /admin/conversations. The details stay here, on the
// device, behind an opaque ref the model passes back as customerDraftRef.
// Bounded; the oldest ref is forgotten first.
const MAX_DRAFT_REFS = 50;
const draftRefs = new Map<string, { name: string; phone?: string; email?: string }>();
let draftRefSeq = 0;

function rememberCustomerDraft(c: CustomerCandidate): string {
  const ref = `draft_${++draftRefSeq}`;
  draftRefs.set(ref, { name: c.name, ...(c.phone ? { phone: c.phone } : {}), ...(c.email ? { email: c.email } : {}) });
  while (draftRefs.size > MAX_DRAFT_REFS) {
    const oldest = draftRefs.keys().next().value;
    if (oldest === undefined) break;
    draftRefs.delete(oldest);
  }
  return ref;
}

/** The details behind a customerDraftRef from find_customer, or null when the ref is unknown. */
export function resolveCustomerDraftRef(ref: unknown): { name: string; phone?: string; email?: string } | null {
  return typeof ref === 'string' ? draftRefs.get(ref) ?? null : null;
}

/**
 * Forget every held draft. Called on sign-out — the refs are module state,
 * and a model-invented "draft_3" under the next account must never resolve
 * to the previous account's address book.
 */
export function clearCustomerDraftRefs(): void {
  draftRefs.clear();
  draftRefSeq = 0;
}

/** Test seam. */
export const __resetCustomerDraftRefs = clearCustomerDraftRefs;

// Pure scoring/merge core shared by findCustomer (extracted so it's testable
// without Firestore). Preserves the exact matchType/confidence/needsConfirmation
// /ambiguous contract the system prompt reasons over — do not change the
// algorithm here without updating the prompt.
export function scoreCustomerCandidates(
  query: string,
  candidates: CustomerCandidate[],
): {
  matches: Array<{
    contactId: string;
    name: string;
    phoneMasked?: string;
    hasEmail: boolean;
    matchType: 'phone' | 'exact' | 'close' | 'fuzzy' | 'sounds_like';
    confidence: number;
    /**
     * Where the person lives. Only 'saved' is a QuoteMate contact whose
     * contactId can go on a quote; a 'phone' (address book) or 'recent'
     * (an earlier quote's customer) hit carries `draftRef` instead — pass it
     * as customerDraftRef and Apply saves the contact with the details held
     * on this device. Before this, a phone-book hit's contactId was a
     * throwaway id and every Apply on it failed.
     */
    source: 'saved' | 'recent' | 'phone';
    draftRef?: string;
  }>;
  confidence: number;
  ambiguous: boolean;
  needsConfirmation: boolean;
  totalScanned: number;
} {
  const q = (query || '').trim();
  const qLower = stripDiacritics(q.toLowerCase());
  const qTokens = tokenize(q);
  const qPhone = normalizePhone(q);
  const isPhoneQuery = qPhone.length >= 4;

  // De-dupe across sources by normalized name (+ phone when present) so the
  // same person from saved + recent + phone doesn't crowd the top five.
  const seen = new Set<string>();
  const deduped: CustomerCandidate[] = [];
  for (const c of candidates) {
    const phoneKey = c.phone ? normalizePhone(String(c.phone)) : '';
    const key = `${stripDiacritics((c.name || '').toLowerCase())}|${phoneKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  type Scored = { score: number; candidate: CustomerCandidate; matchType: string; confidence: number };
  const scored: Scored[] = [];

  for (const c of deduped) {
    const rawName = String(c.name || '');
    const nameLower = stripDiacritics(rawName.toLowerCase());
    const nameTokens = tokenize(rawName);
    const phone = c.phone ? normalizePhone(String(c.phone)) : '';

    // Phone hits are unambiguous — short-circuit.
    if (isPhoneQuery && phone && (phone === qPhone || phone.endsWith(qPhone))) {
      scored.push({ score: 1000, candidate: c, matchType: 'phone', confidence: 1 });
      continue;
    }
    if (!qTokens.length) continue;

    // Whole-string fast paths first.
    if (nameLower === qLower) {
      scored.push({ score: 500, candidate: c, matchType: 'exact', confidence: 1 });
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

    scored.push({ score: confidence * 100, candidate: c, matchType, confidence });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);

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

  const matches = top.map(({ candidate, matchType, confidence: conf }) => ({
    contactId: candidate.id,
    name: candidate.name,
    phoneMasked: maskPhone(candidate.phone),
    hasEmail: !!candidate.email,
    matchType: matchType as 'phone' | 'exact' | 'close' | 'fuzzy' | 'sounds_like',
    confidence: Math.round(conf * 100) / 100,
    source: candidate.source,
    ...(candidate.source === 'saved' ? {} : { draftRef: rememberCustomerDraft(candidate) }),
  }));

  return {
    matches,
    confidence,
    ambiguous,
    needsConfirmation,
    totalScanned: candidates.length,
  };
}

export async function findCustomer(input: { query: string }): Promise<unknown> {
  const uid = requireUid();
  const q = (input.query || '').trim();
  if (!q) return { matches: [], note: 'Empty query.' };

  // --- collect all candidates ---
  const contactsRef = collection(db, 'users', uid, 'contacts');
  const snap = await getDocs(query(contactsRef, fsLimit(500)));

  const candidates: CustomerCandidate[] = [];
  const savedContactIds = new Set<string>();

  for (const d of snap.docs) {
    const data = d.data();
    candidates.push({
      id: d.id,
      name: String(data.name || ''),
      phone: data.phone ? String(data.phone) : undefined,
      email: data.email ? String(data.email) : undefined,
      source: 'saved',
    });
    savedContactIds.add(d.id);
  }

  // best-effort recent contacts from quotes. Imported lazily so the pure
  // helpers above stay unit-testable without Firestore at import time.
  try {
    const recentSnap = await getDocs(
      query(collection(db, 'users', uid, 'documents'), where('type', '==', 'quote'), orderBy('updatedAt', 'desc'), fsLimit(50))
    );
    const seenNames = new Set<string>(candidates.map(c => stripDiacritics(c.name.toLowerCase())));
    for (const d of recentSnap.docs) {
      const data = d.data() as Record<string, unknown>;
      const name = (data.customerName as string) ?? '';
      if (!name || seenNames.has(stripDiacritics(name.toLowerCase()))) continue;
      seenNames.add(stripDiacritics(name.toLowerCase()));
      candidates.push({ id: d.id, name, phone: data.customerPhone as string | undefined, email: data.customerEmail as string | undefined, source: 'recent' });
    }
  } catch { /* best-effort */ }

  // best-effort phone contacts. Imported lazily for the same reason.
  try {
    const { searchPhoneContacts } = await import('../contactService');
    const phoneResults = await searchPhoneContacts(q);
    const seenNames = new Set<string>(candidates.map(c => stripDiacritics(c.name.toLowerCase())));
    for (const c of phoneResults) {
      const name = c.name ?? '';
      if (!name || seenNames.has(stripDiacritics(name.toLowerCase()))) continue;
      seenNames.add(stripDiacritics(name.toLowerCase()));
      candidates.push({ id: c.id ?? c.name, name, phone: c.phone, email: c.email, source: 'phone' });
    }
  } catch { /* best-effort */ }

  // --- score across all sources ---
  const scored = scoreCustomerCandidates(q, candidates);

  // --- augment top saved-contact hits with their most recent document ---
  // ("Sarah W — deck job last week vs Sarah M — bathroom in March")
  const documentsRef = collection(db, 'users', uid, 'documents');
  const matchesWithMeta = await Promise.all(
    scored.matches.map(async (m) => {
      if (!savedContactIds.has(m.contactId)) return m;
      let lastJob: { jobName?: string; total?: number; createdAt?: string } | undefined;
      try {
        const docs = await getDocs(
          query(documentsRef, where('contactId', '==', m.contactId), orderBy('createdAt', 'desc'), fsLimit(1)),
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
      return { ...m, lastJob };
    }),
  );

  return {
    matches: matchesWithMeta,
    confidence: scored.confidence,
    ambiguous: scored.ambiguous,
    needsConfirmation: scored.needsConfirmation,
    totalScanned: candidates.length,
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
        // The legacy collection calls it quoteNumber; only the mirrored
        // document has `number`. Reading the wrong one left every freshly
        // drafted quote — exactly the rows this branch exists to merge in,
        // before the mirror catches up — with no number to match a tradie's
        // "Q-001" against.
        number: data.quoteNumber || data.number,
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
      .map((row) => ({ row, score: fuzzyScoreQuote(rawQuery, row.jobName, row.customerName, row.number) }))
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

/**
 * Recent rows for the recovery paths below. Never throws — these run inside
 * error handling, where a second failure would replace a useful message with a
 * useless one.
 */
async function recentRows(query?: string): Promise<CandidateRow[]> {
  try {
    const res = (await listRecentQuotes(query ? { query, limit: 5 } : { limit: 15 })) as {
      documents?: CandidateRow[];
    };
    return res?.documents ?? [];
  } catch {
    return [];
  }
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
    if (!legacy.exists()) {
      // Not an id, then. It may still be a handle a tradie would use — most
      // often the document number off the card ("QU-001"). listRecentQuotes
      // matches those through fuzzyScoreQuote, so ask it before giving up.
      const byHandle = await recentRows(docId);
      if (byHandle.length === 1 && byHandle[0].id && byHandle[0].id !== docId) {
        return getQuote({ quoteId: byHandle[0].id });
      }
      // A bare "Quote not found." is where Mate ran out of moves and started
      // asking the tradie to look things up. Hand back the recents instead so
      // it can recover inside the same turn.
      return { error: missingQuoteMessage(docId, byHandle.length ? byHandle : await recentRows()) };
    }
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
  const review = reviewQuoteMaterials((q.materials as Material[]) || [], q.sections);
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
    gstRegistered: data.gstRegistered,
    abn: data.abn ? `...${String(data.abn).slice(-4)}` : undefined,
  };
}

// --- Job requirements -------------------------------------------------------
//
// The front of the refined quote pipeline: given a job type (category + niche,
// or just free text), return the niche's must-ask questions, its pricing
// method, and a couple of flags so Mate asks the right things up front instead
// of inventing a checklist. resolveJobRequirements is pure (no Firestore) so it
// can be unit-tested; getJobRequirements wraps it with the business-settings
// fallback for the tool dispatcher.

export interface JobRequirementsInput {
  categoryId?: string;
  nicheId?: string;
  freeText?: string;
  /**
   * True when categoryId/nicheId came from the tradie's business settings
   * rather than from the caller — i.e. they are a default, not a statement
   * about THIS job.
   *
   * Without this, a defaulted category silently wins over a freeText that
   * describes the actual work. A cabinet maker asking for a concrete slab was
   * handed Kitchen Cabinetry's must-ask list — linear metres of cabinets,
   * door finish, benchtop material — for a 1x2m pour (voice transcript,
   * 27 Aug 2026). Mate passed freeText: "concrete slab on ground" precisely
   * to say what the job was, and the tool ignored it.
   */
  categoryFromSettings?: boolean;
  /**
   * Exact name from KNOWN_JOB_TYPES, or JOB_TYPE_NONE when the model has
   * looked at the list and nothing fits. Absent means it didn't say, and the
   * blurb gets matched on words instead.
   */
  jobType?: string;
  /** Injected so resolveJobRequirements stays pure and synchronous. */
  supplierBook?: SupplierBookSnapshot;
  /**
   * 'invoice' means the work is already done. The niche's must-ask questions
   * are for scoping a job that hasn't happened yet — an electrician invoicing
   * a switchboard was asked poles, circuits, RCDs, asbestos and offered a
   * supplier list, twelve messages before the draft (3 Sep 2026). An invoice
   * needs what was done and who for, and nothing about supply.
   */
  documentType?: 'quote' | 'invoice';
}

export interface JobRequirementsResult {
  matched: { categoryId?: string; nicheId?: string; templateName?: string };
  mustAskQuestions: string[];
  /** True when documentType was 'invoice': the questions are the invoice pair and the supply flags are off. */
  invoiceFastPath: boolean;
  /**
   * True when mustAskQuestions are the generic fallback rather than a niche's
   * own. Mate should still ask them, but shouldn't imply this trade was
   * recognised — and shouldn't promise niche-specific pricing off them.
   */
  genericScope: boolean;
  pricingMethod?: string;
  measurementDriven: boolean;
  planHelps: boolean;
  specialistSupply: boolean;
  supplierBookPopulated: boolean;
  /** Up to 3 supplier names, so Mate can say whose list it can see. */
  supplierBookSuppliers: string[];
  /** True when the book could actually price this niche's core gear. */
  supplierBookCoversTrade: boolean;
}

/**
 * Scope questions for a job no template covers.
 *
 * The rule Mate is given is "ask what this tool returns, don't invent
 * questions". An unmatched job used to return an empty list, leaving that rule
 * saying "ask nothing" — and the prompt's soft exception ("if empty, ask about
 * space and measurements") is exactly the kind of caveat a model drops under
 * pressure. It did: a tradie asked for a deck quote, got no questions at all,
 * and was told "there weren't any required deck questions for this job type".
 *
 * So the fallback is structural instead. These are deliberately about what the
 * pricing engine needs from ANY job — how big, what work, what materials, what
 * access — rather than anything trade-specific we'd be guessing at.
 */
export const GENERIC_SCOPE_QUESTIONS: string[] = [
  'The size or measurements of the area involved',
  'What work is actually being done to it',
  'Any materials, brands or finishes they want used',
  'Anything that makes the job harder — access, height, removing what is there now',
];

const MEASUREMENT_DRIVEN_METHODS = new Set(['per_sqm', 'per_linear_m', 'per_cubic_m']);

/** The supply question every install-type job carries. */
export const SUPPLY_OR_REPLACE_QUESTION =
  'Supplying the gear new, or replacing existing units — and is any of it customer-supplied?';
const INSTALL_TYPE_RE = /\b(install|installation|fit|fit-?out|replace|replacement|supply)\b/i;
// "Off existing" (a circuit) is not the same question; the niche has to ask
// about replacing or customer-supplied gear outright to be counted as covered.
const SUPPLY_COVERED_RE = /\b(replac\w*|customer[- ]supplied|supplied by|new or replac\w*|existing units?)\b/i;

/** A template for putting gear in, as opposed to a service, a repair or a clean. */
function isInstallType(t: { name: string; description: string }): boolean {
  return INSTALL_TYPE_RE.test(`${t.name} ${t.description}`);
}

/**
 * Every job type Mate knows, by name.
 *
 * Names are how the model addresses a template, because category/niche IDs
 * can't: 55 templates share only 40 category/niche pairs, so `other/fencing`
 * alone matches Colorbond Fence, Timber Paling Fence, Fence Repair, Gate
 * Install and Pool Fence (Glass) — and the lookup took whichever came first.
 * A tradie quoting a glass pool fence got asked about Colorbond.
 */
export const KNOWN_JOB_TYPES: string[] = NICHE_TEMPLATES.map((t) => t.name);

/** The model's answer when none of the known job types fit. */
export const JOB_TYPE_NONE = 'none';

/**
 * Pick one template from a category/niche group.
 *
 * The pair isn't unique — `other/fencing` covers Colorbond Fence, Timber
 * Paling Fence, Fence Repair, Gate Install and Pool Fence (Glass) — so taking
 * the first match asked a glass-pool-fence job about Colorbond. Let the blurb
 * choose among them when there is one.
 */
function pickInGroup(
  categoryId: string | undefined,
  nicheId: string | undefined,
  freeText: string | undefined,
) {
  if (!categoryId || !nicheId) return undefined;
  const group = NICHE_TEMPLATES.filter(
    (t) => t.categoryId === categoryId && t.nicheId === nicheId,
  );
  if (group.length <= 1) return group[0];
  if (!freeText) return group[0];
  let best: { t: (typeof NICHE_TEMPLATES)[number]; score: number } | undefined;
  for (const t of group) {
    const score = scoreName(freeText.toLowerCase(), t.name.toLowerCase(), NICHE_NAME_WEIGHTS);
    if (!best || score > best.score) best = { t, score };
  }
  return best && best.score > 0 ? best.t : group[0];
}

function templateByName(name: string) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return undefined;
  return NICHE_TEMPLATES.find((t) => t.name.toLowerCase() === wanted);
}

// How much each word narrows the field, derived once from the template names.
const NICHE_NAME_WEIGHTS = buildWordWeights(NICHE_TEMPLATES.map((t) => t.name));

export function resolveJobRequirements(input: JobRequirementsInput): JobRequirementsResult {
  let resolvedCategoryId = input.categoryId;
  let resolvedNicheId = input.nicheId;

  // The model has the list of job types and picks by name. That is a genuine
  // semantic judgement — the thing word-matching can't do — and it is the only
  // way to address one template rather than a whole category/niche group.
  const named = input.jobType ? templateByName(input.jobType) : undefined;
  const saidNone =
    !!input.jobType && input.jobType.trim().toLowerCase() === JOB_TYPE_NONE;
  if (named) {
    return buildRequirements(named, named.categoryId, named.nicheId, input);
  }
  // "None of these fit" is an answer, and a better one than forcing a match.
  // Word-matching a blurb whose subject no template covers is how "hang a
  // hammock" landed on Door Hanging — it shares the word "hang" and nothing
  // else, and the model can see that where the matcher can't.
  if (saidNone) {
    return buildRequirements(undefined, undefined, undefined, input);
  }

  let template = pickInGroup(resolvedCategoryId, resolvedNicheId, input.freeText);

  // A category that came from the tradie's settings is a default, not a claim
  // about this job. When freeText describes the work, let it compete — and
  // search ALL templates, not just the defaulted category's, since the whole
  // point is that this job may sit outside their usual trade.
  const defaultedOnly = input.categoryFromSettings && !!input.freeText;
  if (defaultedOnly) template = undefined;

  // No niche pinned but we have a blurb — fuzzy-match it to the best template.
  if (!template && input.freeText) {
    const ft = input.freeText.toLowerCase().trim();
    let best: { t: (typeof NICHE_TEMPLATES)[number]; score: number } | undefined;
    for (const t of NICHE_TEMPLATES) {
      // Respect a category the CALLER pinned; ignore one that was merely
      // defaulted from settings.
      if (resolvedCategoryId && !defaultedOnly && t.categoryId !== resolvedCategoryId) continue;
      // Score by WORDS, weighted by how rare each is across the template
      // names — see nicheMatch, which also handles the tradie naming the
      // niche outright. Whole-string edit distance used to live here and
      // matched "2 meter by 5 meter deck" to Split System Service.
      const score = scoreName(ft, t.name.toLowerCase(), NICHE_NAME_WEIGHTS);
      if (!best || score > best.score) best = { t, score };
    }
    if (best && best.score >= NICHE_MATCH_FLOOR) {
      template = best.t;
      resolvedCategoryId = best.t.categoryId;
      resolvedNicheId = best.t.nicheId;
    } else if (defaultedOnly) {
      // freeText matched nothing better than the tradie's own trade. Fall back
      // to it rather than answering with nothing.
      template = pickInGroup(resolvedCategoryId, resolvedNicheId, input.freeText);
    }
  }

  return buildRequirements(template, resolvedCategoryId, resolvedNicheId, input);
}

/**
 * Assemble the answer once a template (or none) has been settled on.
 *
 * Shared by every route in — the model naming a job type, the model saying
 * none fits, and word-matching a blurb — so they can't drift apart.
 */
function buildRequirements(
  template: (typeof NICHE_TEMPLATES)[number] | undefined,
  resolvedCategoryId: string | undefined,
  resolvedNicheId: string | undefined,
  input: JobRequirementsInput,
): JobRequirementsResult {
  // Build the must-ask list. Pill labels are the individual topics to cover;
  // questionsLine is the same content phrased as sentences, so we only use one.
  // Prefer questionsLine as the single bundled entry when it exists (better
  // phrasing); fall back to individual pill labels when there is no questionsLine.
  const mustAskQuestions: string[] = [];
  let genericScope = false;
  if (resolvedCategoryId && resolvedNicheId) {
    if (template?.questionsLine) {
      mustAskQuestions.push(template.questionsLine.trim());
    } else {
      const seen = new Set<string>();
      for (const pill of getPillsForNiche(resolvedCategoryId, resolvedNicheId)) {
        const label = pill.label.trim();
        const key = label.toLowerCase();
        if (label && !seen.has(key)) {
          seen.add(key);
          mustAskQuestions.push(label);
        }
      }
    }
  }

  // Nothing matched, or the matched niche carries no questions of its own.
  // Never hand back an empty list: that turns "ask what this returns" into
  // "ask nothing", and Mate drafts a quote it has asked nothing about.
  if (mustAskQuestions.length === 0) {
    mustAskQuestions.push(...GENERIC_SCOPE_QUESTIONS);
    genericScope = true;
  }

  // Every install-type job asks whether the gear is being supplied new or
  // whether existing / customer-supplied units are being replaced. A
  // smoke-alarm quote (3 Sep 2026) supplied four battery alarms the customer
  // already owned — a third of the price — because nothing ever asked.
  if (template && isInstallType(template) && !template.questionsLine?.match(SUPPLY_COVERED_RE)) {
    mustAskQuestions.push(SUPPLY_OR_REPLACE_QUESTION);
  }

  const pricingMethod = template?.pricingMethod || undefined;
  const measurementDriven = !!pricingMethod && MEASUREMENT_DRIVEN_METHODS.has(pricingMethod);

  // An invoice is for work already done: no scoping questions, no plan, no
  // supplier-list offer. The niche match still rides along so the pricing
  // engine knows the trade.
  if (input.documentType === 'invoice') {
    return {
      matched: { categoryId: resolvedCategoryId, nicheId: resolvedNicheId, templateName: template?.name },
      // The work is done, so only these two.
      mustAskQuestions: ['What work was done — enough for a line or two the customer will recognise', 'Who it is for'],
      invoiceFastPath: true,
      genericScope: false,
      pricingMethod,
      measurementDriven: false,
      planHelps: false,
      specialistSupply: false,
      supplierBookPopulated: (input.supplierBook?.personalRateCount ?? 0) > 0,
      supplierBookSuppliers: input.supplierBook?.supplierNames ?? [],
      supplierBookCoversTrade: false,
    };
  }

  // The book is "populated" only when it holds the tradie's own rates. Coverage
  // is scored against this niche's core gear, so a plumber's list doesn't read
  // as covering a fence.
  const supplierBookPopulated = (input.supplierBook?.personalRateCount ?? 0) > 0;
  const coverage =
    input.supplierBook && supplierBookPopulated
      ? coversProbes(input.supplierBook, template?.suggestedMaterials ?? [])
      : { hits: [], coversTrade: false };

  return {
    matched: {
      categoryId: resolvedCategoryId,
      nicheId: resolvedNicheId,
      templateName: template?.name,
    },
    mustAskQuestions,
    invoiceFastPath: false,
    genericScope,
    pricingMethod,
    measurementDriven,
    planHelps: measurementDriven,
    specialistSupply: isSpecialistSupplyNiche(resolvedCategoryId, resolvedNicheId),
    supplierBookPopulated,
    supplierBookSuppliers: input.supplierBook?.supplierNames ?? [],
    supplierBookCoversTrade: coverage.coversTrade,
  };
}

export async function getJobRequirements(input: {
  category?: string;
  niche?: string;
  freeText?: string;
  jobType?: string;
  documentType?: string;
}): Promise<unknown> {
  const uid = requireUid();
  let { category, niche } = input;
  if (!category && !niche) {
    const snap = await getDoc(doc(db, 'users', uid, 'settings', 'business'));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      category = category ?? (data.tradeCategory as string) ?? (data.tradeCategories as string[])?.[0];
      niche = niche ?? (data.tradeNiche as string) ?? (data.tradeNiches as string[])?.[0];
    }
  }
  // Imported lazily so resolveJobRequirements stays unit-testable without
  // AsyncStorage / Firestore at import time — same reason as the contact
  // helpers above.
  const { loadSupplierBookSnapshot } = await import('../supplierBook');
  const supplierBook = await loadSupplierBookSnapshot();
  return resolveJobRequirements({
    categoryId: category,
    nicheId: niche,
    freeText: input.freeText,
    jobType: input.jobType,
    ...(input.documentType === 'invoice' ? { documentType: 'invoice' as const } : {}),
    // Flag defaults so a freeText describing THIS job can outvote the tradie's
    // usual trade — see JobRequirementsInput.categoryFromSettings.
    categoryFromSettings: !input.category && !input.niche,
    supplierBook,
  });
}

// --- Supplier book ----------------------------------------------------------
//
// Mate could see THAT a book existed (three booleans on get_job_requirements)
// but never what was in it, so "why didn't you use my supplier book?" and
// "what's my price for batts?" had no honest answer. The matching is the
// pure resolveSupplierBookLookup; this wrapper only gathers its inputs.

export async function searchSupplierBook(input: { query?: string; limit?: number }): Promise<unknown> {
  requireUid();
  // Lazy for the same reason as getJobRequirements: keeps the pure helpers in
  // this module importable under vitest without AsyncStorage at import time.
  // Reads the local cache, like every other consumer — the cloud copy is
  // pulled into it at sign-in.
  const { loadFavoritesFromLocal } = await import('../materialFavorites');
  const favorites = await loadFavoritesFromLocal();
  return resolveSupplierBookLookup({
    query: typeof input?.query === 'string' ? input.query : undefined,
    limit: typeof input?.limit === 'number' ? input.limit : undefined,
    favorites: Object.values(favorites),
  });
}

/**
 * List the tradie's service reports.
 *
 * A ServiceReport (users/{uid}/reports) is a customer-facing leave-behind for
 * a service visit — no money, no line items, attached to a Job rather than to
 * the quotes list. Mate had no way to see them, so "pull up the service report
 * from the July job" got answered with that job's invoice: a confidently wrong
 * document, which is the worst failure mode there is. This gives it eyes.
 *
 * Reports carry only jobId, so the job name and customer are resolved from the
 * jobs collection in one batch read.
 */
export async function listServiceReports(input: {
  query?: string;
  limit?: number;
}): Promise<unknown> {
  const uid = requireUid();
  const rowLimit = Math.min(Math.max(input.limit ?? 10, 1), 25);
  const rawQuery = typeof input.query === 'string' ? input.query.trim() : '';

  const snap = await getDocs(
    query(collection(db, 'users', uid, 'reports'), orderBy('visitDate', 'desc'), fsLimit(50)),
  ).catch(() => null);
  if (!snap || snap.empty) {
    return { reports: [], count: 0, note: 'No service reports on file yet.' };
  }

  // Resolve job name + customer for the jobs these reports hang off. Reports
  // are few, so a per-job get is cheaper than scanning the whole collection.
  const jobIds = Array.from(
    new Set(snap.docs.map((d) => String((d.data() as any).jobId || '')).filter(Boolean)),
  );
  const jobEntries = await Promise.all(
    jobIds.map(async (jobId) => {
      const jobSnap = await getDoc(doc(db, 'users', uid, 'jobs', jobId)).catch(() => null);
      return [jobId, jobSnap?.exists() ? (jobSnap.data() as any) : null] as const;
    }),
  );
  const jobs = new Map(jobEntries);

  let rows = snap.docs.map((d) => {
    const r = d.data() as any;
    const job = jobs.get(String(r.jobId || '')) || null;
    return {
      id: d.id,
      number: r.number,
      jobId: r.jobId || undefined,
      jobName: job?.name || undefined,
      customerName: job?.customerName || undefined,
      serviceType: r.serviceType || undefined,
      visitDate: typeof r.visitDate === 'number' ? new Date(r.visitDate).toISOString() : undefined,
      status: r.status || 'draft',
      hasRecommendedWork: !!(r.recommendedWork && String(r.recommendedWork).trim()),
    };
  });

  if (rawQuery) {
    const scored = rows
      .map((row) => ({
        row,
        score: fuzzyScoreQuote(
          rawQuery,
          `${row.jobName || ''} ${row.serviceType || ''}`.trim(),
          row.customerName,
        ),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    // A query that matches nothing falls back to the recent list rather than
    // an empty result — Mate can then read the candidates back instead of
    // telling the tradie their report doesn't exist.
    if (scored.length) rows = scored.map((s) => s.row);
  }

  return { reports: rows.slice(0, rowLimit), count: Math.min(rows.length, rowLimit) };
}
