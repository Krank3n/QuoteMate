/**
 * The accountant statement send: request validation, one email with two
 * attachments, the accountant remembered on success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    business: {} as Record<string, unknown>,
    documents: [] as Array<Record<string, unknown> & { id: string }>,
    sets: [] as Array<{ path: string; data: unknown; opts?: unknown }>,
    collectionGets: 0,
  };
  const docRef = (path: string) => ({
    get: async () =>
      path.endsWith('/settings/business')
        ? { exists: true, data: () => state.business }
        : { exists: false, data: () => undefined },
    set: async (data: unknown, opts?: unknown) => { state.sets.push({ path, data, opts }); },
  });
  const collection = (_path: string) => {
    const q: any = { _limit: 0, _after: null as any };
    q.orderBy = () => q;
    q.limit = (n: number) => { q._limit = n; return q; };
    q.startAfter = (last: any) => { q._after = last; return q; };
    q.get = async () => {
      state.collectionGets += 1;
      const all = state.documents.map((d) => {
        const { id, ...rest } = d;
        return { id, data: () => rest };
      });
      const start = q._after ? all.findIndex((s) => s.id === q._after.id) + 1 : 0;
      const docs = all.slice(start, start + (q._limit || all.length));
      return { empty: docs.length === 0, size: docs.length, docs };
    };
    return q;
  };
  const firestore: any = () => ({ doc: docRef, collection });
  firestore.FieldValue = { serverTimestamp: () => 'server-timestamp', increment: (n: number) => ({ inc: n }) };
  firestore.FieldPath = { documentId: () => '__name__' };
  firestore.Timestamp = { fromMillis: (ms: number) => ({ ms }) };
  return {
    state,
    firestore,
    verifyIdToken: vi.fn(),
    sendEmail: vi.fn(),
    getUserEmail: vi.fn(),
    generatePdf: vi.fn(),
    recordUsage: vi.fn(),
  };
});

vi.mock('firebase-admin', () => ({
  firestore: h.firestore,
  auth: () => ({ verifyIdToken: h.verifyIdToken, getUser: async () => ({ email: 'leo@example.com' }) }),
}));
vi.mock('./email', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendEmail: h.sendEmail,
  getUserEmail: h.getUserEmail,
}));
vi.mock('./pdfGenerator', () => ({
  generateQuotePdfBuffer: h.generatePdf,
  buildQuotePdfHtml: () => '',
  buildInvoicePdfHtml: () => '',
}));
vi.mock('./featureUsage', () => ({ recordAccountantStatementSent: h.recordUsage }));

import {
  handleSendAccountantStatement,
  parseStatementRequest,
  buildAccountantStatementEmail,
  statementAttachmentBaseName,
  MAX_STATEMENT_SPAN_MS,
} from './accountantStatement';

const T = (y: number, m: number, d: number, hh = 12) => Date.UTC(y, m - 1, d, hh);
const FY = { fromMs: T(2025, 7, 1, 0), toMs: T(2026, 7, 1, 0) };

function fakeReq(over: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer tok' },
    // The device sends local-midnight boundaries; these fixtures are UTC
    // midnight, so name the zone or Sydney would show the day after.
    body: { ...FY, recipientEmail: 'books@accountant.com.au', timeZone: 'UTC' },
    ...over,
  } as any;
}

function fakeRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  res.send = (body: unknown) => { res.body = body; return res; };
  return res;
}

function invoiceDoc(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    number: `IN-${id}`,
    type: 'invoice',
    stage: 'invoice_sent',
    customerName: 'Sam Customer',
    createdAt: T(2026, 3, 10),
    subtotal: 100,
    gst: 0,
    total: 100,
    paidTotal: 0,
    balanceDue: 100,
    payments: [{ id: 'p1', kind: 'manual', amount: 40, paidAt: T(2026, 3, 12), method: 'bank' }],
    ...over,
  };
}

beforeEach(() => {
  h.state.business = { businessName: 'Leo Wright Electrical', email: 'leo@example.com', gstRegistered: false };
  h.state.documents = [invoiceDoc('1'), invoiceDoc('2')];
  h.state.sets = [];
  h.state.collectionGets = 0;
  h.verifyIdToken.mockReset().mockResolvedValue({ uid: 'u1' });
  h.sendEmail.mockReset().mockResolvedValue(true);
  h.getUserEmail.mockReset().mockResolvedValue('leo@example.com');
  h.generatePdf.mockReset().mockResolvedValue(Buffer.from('%PDF-fake'));
  h.recordUsage.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('handleSendAccountantStatement — request gate', () => {
  it('405 on GET', async () => {
    const res = fakeRes();
    await handleSendAccountantStatement(fakeReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('401 without a bearer token', async () => {
    const res = fakeRes();
    await handleSendAccountantStatement(fakeReq({ headers: {} }), res);
    expect(res.statusCode).toBe(401);
    expect(h.verifyIdToken).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('400 when the period ends before (or at) its start', async () => {
    const res = fakeRes();
    await handleSendAccountantStatement(fakeReq({ body: { fromMs: FY.toMs, toMs: FY.fromMs, recipientEmail: 'a@b.co' } }), res);
    expect(res.statusCode).toBe(400);
    const same = fakeRes();
    await handleSendAccountantStatement(fakeReq({ body: { fromMs: FY.fromMs, toMs: FY.fromMs, recipientEmail: 'a@b.co' } }), same);
    expect(same.statusCode).toBe(400);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('400 when the span exceeds 24 months', async () => {
    const res = fakeRes();
    await handleSendAccountantStatement(
      fakeReq({ body: { fromMs: FY.fromMs, toMs: FY.fromMs + MAX_STATEMENT_SPAN_MS + 1, recipientEmail: 'a@b.co' } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/24 months/);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('400 on a malformed recipient email', async () => {
    for (const bad of ['', 'not-an-email', 'a@b', 'a b@c.com', 42]) {
      const res = fakeRes();
      await handleSendAccountantStatement(fakeReq({ body: { ...FY, recipientEmail: bad } }), res);
      expect(res.statusCode, String(bad)).toBe(400);
    }
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});

describe('handleSendAccountantStatement — happy path', () => {
  it('sends ONE email with a PDF and a CSV, reply-to the tradie, and remembers the accountant', async () => {
    const res = fakeRes();
    await handleSendAccountantStatement(fakeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, invoiceCount: 2, paymentCount: 2 });

    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const sent = h.sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('books@accountant.com.au');
    expect(sent.category).toBe('transactional');
    expect(sent.tags).toEqual(['accountant-statement']);
    expect(sent.replyTo).toEqual({ email: 'leo@example.com', name: 'Leo Wright Electrical' });
    expect(sent.senderName).toBe('Leo Wright Electrical');
    expect(sent.bcc).toBeUndefined();
    expect(sent.subject).toBe('Statement 1 July 2025 – 30 June 2026 – Leo Wright Electrical');
    expect(sent.htmlContent).not.toMatch(/QuoteMate|\bAI\b/);

    expect(sent.attachment).toHaveLength(2);
    expect(sent.attachment[0].name).toBe('Statement 2025-07-01 to 2026-06-30 Leo Wright Electrical.pdf');
    expect(sent.attachment[1].name).toBe('Statement 2025-07-01 to 2026-06-30 Leo Wright Electrical.csv');
    expect(Buffer.from(sent.attachment[0].content, 'base64').toString()).toBe('%PDF-fake');
    const csv = Buffer.from(sent.attachment[1].content, 'base64').toString('utf8');
    expect(csv.startsWith('section,date,number,customer,status,method,subtotal,total,')).toBe(true); // no gst column
    expect(csv).toContain('invoice,2026-03-10,IN-1,');
    expect(csv).toContain('payment,2026-03-12,IN-2,');

    // The PDF was built from the statement, not a quote.
    const html = h.generatePdf.mock.calls[0][0] as string;
    expect(html).toContain('Not registered for GST');
    expect(html).toContain('IN-1');

    expect(h.state.sets).toEqual([
      { path: 'users/u1/settings/business', data: { accountantEmail: 'books@accountant.com.au' }, opts: { merge: true } },
    ]);
    expect(h.recordUsage).toHaveBeenCalledWith('u1');
  });

  it('does not rewrite accountantEmail when the recipient is already remembered', async () => {
    h.state.business.accountantEmail = 'Books@Accountant.com.au';
    const res = fakeRes();
    await handleSendAccountantStatement(fakeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(h.state.sets).toEqual([]);
  });

  it('BCCs the tradie through buildSelfCopyBcc when sendCopyToSelf is set', async () => {
    const res = fakeRes();
    await handleSendAccountantStatement(fakeReq({ body: { ...FY, recipientEmail: 'books@accountant.com.au', sendCopyToSelf: true } }), res);
    expect(h.sendEmail.mock.calls[0][0].bcc).toEqual([{ email: 'leo@example.com' }]);
  });

  it('uses the custom subject and body when the tradie wrote them', async () => {
    const res = fakeRes();
    await handleSendAccountantStatement(
      fakeReq({ body: { ...FY, recipientEmail: 'books@accountant.com.au', subject: 'FY26 books', emailBody: 'Here you go, Jo.' } }),
      res,
    );
    const sent = h.sendEmail.mock.calls[0][0];
    expect(sent.subject).toBe('FY26 books');
    expect(sent.textContent).toBe('Here you go, Jo.');
    expect(sent.htmlContent).toContain('Here you go, Jo.');
  });

  it('502 when the email does not send, and nothing is remembered', async () => {
    h.sendEmail.mockResolvedValue(false);
    const res = fakeRes();
    await handleSendAccountantStatement(fakeReq(), res);
    expect(res.statusCode).toBe(502);
    expect(h.state.sets).toEqual([]);
    expect(h.recordUsage).not.toHaveBeenCalled();
  });

  it('500 when the PDF render throws', async () => {
    h.generatePdf.mockRejectedValue(new Error('chromium died'));
    const res = fakeRes();
    await handleSendAccountantStatement(fakeReq(), res);
    expect(res.statusCode).toBe(500);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('reads past the 500-document page the app store stops at', async () => {
    h.state.documents = Array.from({ length: 1203 }, (_, i) => invoiceDoc(String(i).padStart(5, '0'), { payments: [] }));
    const res = fakeRes();
    await handleSendAccountantStatement(fakeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.invoiceCount).toBe(1203);
    expect(h.state.collectionGets).toBe(3);
  });
});

describe('parseStatementRequest', () => {
  it('falls back to Australia/Sydney on a missing or bogus time zone', () => {
    const base = { ...FY, recipientEmail: 'a@b.co' };
    expect(parseStatementRequest(base)).toMatchObject({ ok: true, value: { timeZone: 'Australia/Sydney' } });
    expect(parseStatementRequest({ ...base, timeZone: 'Mars/Olympus' })).toMatchObject({ ok: true, value: { timeZone: 'Australia/Sydney' } });
    expect(parseStatementRequest({ ...base, timeZone: 'Australia/Perth' })).toMatchObject({ ok: true, value: { timeZone: 'Australia/Perth' } });
  });

  it('accepts exactly 24 months and trims the recipient', () => {
    const parsed = parseStatementRequest({ fromMs: FY.fromMs, toMs: FY.fromMs + MAX_STATEMENT_SPAN_MS, recipientEmail: ' a@b.co ' });
    expect(parsed).toMatchObject({ ok: true, value: { recipientEmail: 'a@b.co', sendCopyToSelf: false } });
  });
});

describe('buildAccountantStatementEmail', () => {
  it('defaults to a plain note from the business naming the period, with no app branding', () => {
    const email = buildAccountantStatementEmail({ businessName: 'Leo Wright Electrical', periodLabel: '1 July 2025 – 30 June 2026' });
    expect(email.subject).toBe('Statement 1 July 2025 – 30 June 2026 – Leo Wright Electrical');
    expect(email.textContent).toContain('invoices issued and payments received for 1 July 2025 – 30 June 2026');
    expect(email.textContent.trim().endsWith('Leo Wright Electrical')).toBe(true);
    expect(email.htmlContent).toContain('Leo Wright Electrical');
    expect(email.htmlContent).not.toMatch(/QuoteMate|\bAI\b/);
    expect(email.textContent).not.toMatch(/QuoteMate|\bAI\b/);
  });

  it('keeps a custom subject and body verbatim in the text part and escapes them in the HTML', () => {
    const email = buildAccountantStatementEmail({
      businessName: 'B',
      periodLabel: 'P',
      subject: 'My books',
      emailBody: 'Hi <Jo>,\n\nAttached.',
    });
    expect(email.subject).toBe('My books');
    expect(email.textContent).toBe('Hi <Jo>,\n\nAttached.');
    expect(email.htmlContent).toContain('Hi &lt;Jo&gt;,');
    expect(email.htmlContent).toContain('<p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 16px;">Attached.</p>');
  });
});

describe('statementAttachmentBaseName', () => {
  it('dates the range in the zone and strips filename-hostile characters from the business name', () => {
    expect(statementAttachmentBaseName(FY.fromMs, FY.toMs, 'Leo\'s Sparky / "Co" & Sons', 'UTC'))
      .toBe('Statement 2025-07-01 to 2026-06-30 Leos Sparky Co & Sons');
    expect(statementAttachmentBaseName(FY.fromMs, FY.toMs, '', 'UTC')).toBe('Statement 2025-07-01 to 2026-06-30 Business');
  });
});
