// Read-tool executors for the Mate assistant. Each function takes a uid + the
// tool input the model emitted, returns a JSON-serialisable result that gets
// fed back to the model as the tool_result content.
//
// Every read is scoped to users/${uid}/... — uid comes from the verified
// Firebase auth token, never from the message payload, so a forged toolUseId
// can't pivot to another tradie's data.

import * as admin from 'firebase-admin';

const db = () => admin.firestore();

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '').slice(-8);
}

function maskPhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 4) return undefined;
  return `...${digits.slice(-4)}`;
}

export async function findCustomer(uid: string, input: { query: string }): Promise<unknown> {
  const query = (input.query || '').trim();
  if (!query) return { matches: [], note: 'Empty query.' };

  const snap = await db().collection(`users/${uid}/contacts`).limit(500).get();
  const queryLower = query.toLowerCase();
  const queryPhone = normalizePhone(query);
  const isPhoneQuery = queryPhone.length >= 4;

  const scored: Array<{ score: number; doc: FirebaseFirestore.QueryDocumentSnapshot }> = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const name = String(data.name || '').toLowerCase();
    const phone = data.phone ? normalizePhone(String(data.phone)) : '';
    let score = 0;
    if (isPhoneQuery && phone && (phone === queryPhone || phone.endsWith(queryPhone))) score += 100;
    if (name === queryLower) score += 50;
    if (name.startsWith(queryLower)) score += 20;
    if (name.includes(queryLower)) score += 10;
    // Token-aware: "sarah w" should match "Sarah Wilson".
    const tokens = queryLower.split(/\s+/).filter(Boolean);
    if (tokens.length > 1 && tokens.every((t) => name.includes(t))) score += 15;
    if (score > 0) scored.push({ score, doc });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);

  // Augment top hits with the most recent document for that contact so the
  // model can disambiguate ("Sarah Wilson — deck job last week vs Sarah
  // Mackenzie — bathroom March"). One contacts collection scan + at most 5
  // small queries; well within budget.
  const matches = await Promise.all(
    top.map(async ({ doc }) => {
      const data = doc.data();
      let lastJob: { jobName?: string; total?: number; createdAt?: string } | undefined;
      try {
        const docs = await db()
          .collection(`users/${uid}/documents`)
          .where('contactId', '==', doc.id)
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();
        if (!docs.empty) {
          const d = docs.docs[0].data();
          lastJob = {
            jobName: d.jobName || d.job?.name,
            total: typeof d.total === 'number' ? d.total : undefined,
            createdAt: tsToIso(d.createdAt),
          };
        }
      } catch {
        // contactId may not be indexed for very old data — fall back to undefined.
      }
      return {
        contactId: doc.id,
        name: data.name,
        phoneMasked: maskPhone(data.phone),
        hasEmail: !!data.email,
        lastJob,
      };
    }),
  );

  return { matches, totalScanned: snap.size };
}

export async function listRecentQuotes(
  uid: string,
  input: { limit?: number; status?: string; daysBack?: number },
): Promise<unknown> {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 25);
  let q = db().collection(`users/${uid}/documents`).orderBy('createdAt', 'desc') as
    FirebaseFirestore.Query;
  if (input.status) q = q.where('stage', '==', input.status);
  if (input.daysBack) {
    const cutoff = Date.now() - input.daysBack * 24 * 60 * 60 * 1000;
    q = q.where('createdAt', '>=', new Date(cutoff));
  }
  const snap = await q.limit(limit).get();
  return {
    documents: snap.docs.map((d) => {
      const data = d.data();
      return {
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
      };
    }),
  };
}

export async function getQuote(uid: string, input: { quoteId: string }): Promise<unknown> {
  const docId = String(input.quoteId || '');
  if (!docId) return { error: 'Missing quoteId.' };
  const snap = await db().doc(`users/${uid}/documents/${docId}`).get();
  if (!snap.exists) {
    // Fallback to the legacy quotes collection in case the unified doc hasn't
    // been mirrored yet for very fresh records.
    const legacy = await db().doc(`users/${uid}/quotes/${docId}`).get();
    if (!legacy.exists) return { error: 'Quote not found.' };
    return { quote: stripUndefined(legacy.data()) };
  }
  const data = snap.data() || {};
  // Trim very large fields the model doesn't need (photo blobs, raw HTML).
  const trimmed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'photos' || k === 'photoBase64' || k.endsWith('Html')) continue;
    trimmed[k] = serialize(v);
  }
  return { quote: trimmed };
}

export async function getBusinessDefaults(uid: string): Promise<unknown> {
  const snap = await db().doc(`users/${uid}/settings/business`).get();
  if (!snap.exists) return { error: 'No business settings yet.' };
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

// --- helpers ---

function tsToIso(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  if (typeof (v as any)?.toDate === 'function') return (v as any).toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return new Date(v).toISOString();
  return undefined;
}

function serialize(v: unknown): unknown {
  if (v == null) return v;
  if (typeof (v as any)?.toDate === 'function') return (v as any).toDate().toISOString();
  if (Array.isArray(v)) return v.map(serialize);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = serialize(val);
    return out;
  }
  return v;
}

function stripUndefined(o: any): any {
  if (!o || typeof o !== 'object') return o;
  const out: any = Array.isArray(o) ? [] : {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    out[k] = serialize(v);
  }
  return out;
}

