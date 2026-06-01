// Mate read tools — client-side mirror of functions/src/assistant/readTools.ts.
//
// Why client-side: Gemini Live runs the tool-calling loop inside the WS
// session. The model emits a toolCall, the client executes it locally, and
// the response is sent back over the same socket. There is no opportunity
// to bounce through a server. Firestore security rules already gate every
// read by uid so this is no looser than the server path.
//
// Keep these behaviour-identical to the server file — the system prompt
// describes specific result shapes (matches[], lastJob, phoneMasked, etc.).
// Drift here changes how Mate reasons about results.

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

function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in.');
  return uid;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '').slice(-8);
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
  const qLower = q.toLowerCase();
  const qPhone = normalizePhone(q);
  const isPhoneQuery = qPhone.length >= 4;

  const scored: Array<{ score: number; id: string; data: any }> = [];
  for (const d of snap.docs) {
    const data = d.data();
    const name = String(data.name || '').toLowerCase();
    const phone = data.phone ? normalizePhone(String(data.phone)) : '';
    let score = 0;
    if (isPhoneQuery && phone && (phone === qPhone || phone.endsWith(qPhone))) score += 100;
    if (name === qLower) score += 50;
    if (name.startsWith(qLower)) score += 20;
    if (name.includes(qLower)) score += 10;
    const tokens = qLower.split(/\s+/).filter(Boolean);
    if (tokens.length > 1 && tokens.every((t) => name.includes(t))) score += 15;
    if (score > 0) scored.push({ score, id: d.id, data });
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

  return { matches, totalScanned: snap.size };
}

export async function listRecentQuotes(input: {
  limit?: number;
  status?: string;
  daysBack?: number;
}): Promise<unknown> {
  const uid = requireUid();
  const rowLimit = Math.min(Math.max(input.limit ?? 10, 1), 25);

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
  docConstraints.push(fsLimit(rowLimit));

  // The legacy quotes collection doesn't carry the `stage` field on every
  // row, and `daysBack` filtering is unreliable across schema drift, so
  // pull a fat slice and filter in memory.
  const quoteConstraints: QueryConstraint[] = [orderBy('createdAt', 'desc'), fsLimit(rowLimit * 2)];

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

  return { documents: merged.slice(0, rowLimit) };
}

export async function getQuote(input: { quoteId: string }): Promise<unknown> {
  const uid = requireUid();
  const docId = String(input.quoteId || '');
  if (!docId) return { error: 'Missing quoteId.' };

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
  const res = (await getQuote(input)) as { quote?: any; error?: string };
  if (!res || res.error || !res.quote) {
    return { error: res?.error || 'Quote not found.' };
  }
  const q = res.quote;
  const review = reviewQuoteMaterials((q.materials as Material[]) || []);
  return {
    quoteId: input.quoteId,
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
