/**
 * A quote or invoice reads "sent" only once the email has actually gone out.
 *
 * The send used to stamp the sent stage, sentAt, sendMethod and the send
 * count BEFORE handing the email to the provider, and nothing undid it when
 * the provider refused (an unsendable address, a provider outage) or the PDF
 * failed — so the app showed "Sent as Quote" on a quote the customer never
 * got. Firestore is an in-memory map; email delivery and PDF rendering are
 * stubbed; everything else is the real send path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, mail } = vi.hoisted(() => ({
  store: new Map<string, Record<string, any>>(),
  mail: { ok: true, calls: 0, throwPdf: false },
}));

vi.mock('firebase-admin', () => {
  class FieldValue {
    constructor(public readonly op: string, public readonly arg?: unknown) {}
    static delete() { return new FieldValue('delete'); }
    static serverTimestamp() { return new FieldValue('serverTimestamp'); }
    static arrayUnion(...v: unknown[]) { return new FieldValue('arrayUnion', v); }
    static increment(n: number) { return new FieldValue('increment', n); }
  }
  const apply = (path: string, data: Record<string, any>, merge: boolean) => {
    const next: Record<string, any> = merge ? { ...(store.get(path) ?? {}) } : {};
    for (const [k, v] of Object.entries(data)) {
      if (v instanceof FieldValue) {
        if (v.op === 'delete') delete next[k];
        else if (v.op === 'serverTimestamp') next[k] = 'SERVER_TS';
        else if (v.op === 'increment') next[k] = (Number(next[k]) || 0) + Number(v.arg);
        else next[k] = v.arg;
      } else next[k] = v;
    }
    store.set(path, next);
  };
  const doc = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    async get() { const d = store.get(path); return { exists: d !== undefined, id: path.split('/').pop(), data: () => d }; },
    async set(data: Record<string, any>, opts?: { merge?: boolean }) { apply(path, data, !!opts?.merge); },
    async update(data: Record<string, any>) { apply(path, data, true); },
    collection: (c: string) => collection(`${path}/${c}`),
  });
  const collection = (path: string): any => ({
    doc: (id: string) => doc(`${path}/${id}`),
    async add(data: Record<string, any>) { const id = `auto${store.size}`; apply(`${path}/${id}`, data, false); return doc(`${path}/${id}`); },
  });
  const batch = () => {
    const ops: Array<() => void> = [];
    return {
      set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) { ops.push(() => apply(ref.path, data, !!opts?.merge)); },
      update(ref: any, data: Record<string, any>) { ops.push(() => apply(ref.path, data, true)); },
      async commit() { ops.forEach((o) => o()); },
    };
  };
  const firestore: any = () => ({ doc, collection, batch });
  firestore.FieldValue = FieldValue;
  const auth = () => ({ getUser: async () => ({ email: 'tradie@example.com' }) });
  return { firestore, auth, initializeApp: vi.fn(), apps: [] };
});

vi.mock('./email', async (orig) => ({
  ...(await orig<any>()),
  sendEmail: vi.fn(async () => { mail.calls++; return mail.ok; }),
  getUserEmail: vi.fn(async () => 'tradie@example.com'),
  sendQuoteSentEmail: vi.fn(async () => true),
}));
vi.mock('./emailLogo', () => ({ emailSafeLogoUrl: vi.fn(async (u: string) => u) }));
vi.mock('./pdfGenerator', async (orig) => ({
  ...(await orig<any>()),
  generateQuotePdfBuffer: vi.fn(async () => {
    if (mail.throwPdf) throw new Error('chromium crashed');
    return Buffer.from('%PDF');
  }),
}));

import { sendDocumentEmail } from './documentHandlers';

const UID = 'u1';
const quote = (over: Record<string, any> = {}): any => ({
  id: 'q1', type: 'quote', stage: 'draft', number: 'QU-1', customerName: 'Sam',
  customerEmail: 'sam@example.org', total: 960, subtotal: 872.73, gst: 87.27,
  materials: [], job: { name: 'Slab', description: '' }, payments: [], createdAt: 1, updatedAt: 1,
  ...over,
});
const invoice = (over: Record<string, any> = {}): any => quote({
  type: 'invoice', number: 'INV-1', legacyInvoiceId: 'q1', ...over,
});
const send = (doc: any) => sendDocumentEmail(doc, {
  userId: UID, docId: doc.id, emailBody: 'Here it is', recipientEmail: 'sam@example.org',
  generateAcceptanceToken: () => ({ token: 't'.repeat(64), hashedToken: 'h'.repeat(64) }),
  acceptanceUrlForToken: (t: string) => `https://example.org/q?token=${t}`,
} as any);

beforeEach(() => {
  store.clear();
  mail.ok = true; mail.calls = 0; mail.throwPdf = false;
  store.set(`users/${UID}/settings/business`, { businessName: 'Coastal Concreting' });
});

describe('a quote is marked sent only when the email goes out', () => {
  beforeEach(() => {
    store.set(`users/${UID}/documents/q1`, quote());
    store.set(`users/${UID}/quotes/q1`, { status: 'draft' });
  });

  it('REGRESSION: the provider refuses — the quote stays a draft, nothing says sent', async () => {
    mail.ok = false;
    const res = await send(quote());
    expect(res.success).toBe(false);
    const d = store.get(`users/${UID}/documents/q1`)!;
    expect(d.stage).toBe('draft');
    expect(d.sentAt).toBeUndefined();
    expect(d.sendCount).toBeUndefined();
    expect(store.get(`users/${UID}/quotes/q1`)!.status).toBe('draft');
    expect(store.get(`users/${UID}/quotes/q1`)!.sentAt).toBeUndefined();
  });

  it('the PDF fails — still a draft', async () => {
    mail.throwPdf = true;
    await expect(send(quote())).rejects.toThrow();
    expect(store.get(`users/${UID}/documents/q1`)!.stage).toBe('draft');
    expect(mail.calls).toBe(0);
  });

  it('the acceptance link in a failed email still resolves (token written first)', async () => {
    mail.ok = false;
    await send(quote());
    expect(store.has(`quoteAcceptanceTokens/${'h'.repeat(64)}`)).toBe(true);
  });

  it('delivered — sent stage, sentAt, sendMethod and one send counted', async () => {
    const res = await send(quote());
    expect(res.success).toBe(true);
    const d = store.get(`users/${UID}/documents/q1`)!;
    expect(d.stage).toBe('quote_sent');
    expect(d.sendCount).toBe(1);
    const q = store.get(`users/${UID}/quotes/q1`)!;
    expect(q.status).toBe('sent');
    expect(q.sentAt).toBe('SERVER_TS');
    expect(q.sendMethod).toBe('email');
  });

  it('a failed send then a good one counts one send', async () => {
    mail.ok = false;
    await send(quote());
    mail.ok = true;
    await send(quote());
    expect(store.get(`users/${UID}/documents/q1`)!.sendCount).toBe(1);
  });
});

describe('an invoice is marked sent only when the email goes out', () => {
  beforeEach(() => {
    store.set(`users/${UID}/documents/q1`, invoice());
    store.set(`users/${UID}/invoices/q1`, { status: 'draft' });
  });

  it('REGRESSION: the provider refuses — the invoice stays a draft', async () => {
    mail.ok = false;
    const res = await send(invoice());
    expect(res.success).toBe(false);
    expect(store.get(`users/${UID}/documents/q1`)!.stage).toBe('draft');
    expect(store.get(`users/${UID}/invoices/q1`)!.status).toBe('draft');
    expect(store.get(`users/${UID}/invoices/q1`)!.sentAt).toBeUndefined();
  });

  it('delivered — invoice_sent and the legacy row reads sent', async () => {
    const res = await send(invoice());
    expect(res.success).toBe(true);
    expect(store.get(`users/${UID}/documents/q1`)!.stage).toBe('invoice_sent');
    expect(store.get(`users/${UID}/invoices/q1`)!.status).toBe('sent');
  });
});

describe('undeliverableReason', () => {
  it('flags a send where every recipient can never be delivered to', async () => {
    const { undeliverableReason } = await import('./documentHandlers');
    expect(undeliverableReason(['test@example.com'])).toBe('undeliverable-address');
    expect(undeliverableReason(['logo@2x.png'])).toBe('undeliverable-address');
  });
  it('a real address in the list means a provider problem, not the address', async () => {
    const { undeliverableReason } = await import('./documentHandlers');
    expect(undeliverableReason(['test@example.com', 'sam@gmail.com'])).toBeUndefined();
    expect(undeliverableReason([])).toBeUndefined();
  });
});
