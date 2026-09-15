// Accountant statement sender.
//
// A sole trader under the GST threshold asked for "a statement of invoices
// sent and received payment" to hand their accountant instead of paying for
// an accounting package. This function builds that statement for a date
// range — a PDF to read and a CSV for the accountant's software — and emails
// both from the tradie to the accountant in ONE message.
//
// Shape mirrors serviceReportEmail.sendServiceReport: runWith(120s/1GB)
// onRequest + cors + verifyAuth, POST body, base64 attachments. The money
// itself comes from the pure shared core (shared/statement/buildStatement),
// which the on-device preview will reuse. Documents are read UNBOUNDED —
// the in-app store listener is capped at 500 and a statement must not be.
//
// Customer-facing strings show only the tradie's business — never the app
// name and never the word "AI".

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import cors from 'cors';
import { verifyAuth } from './assistantToken';
import { sendEmail, getUserEmail } from './email';
import { generateQuotePdfBuffer } from './pdfGenerator';
import { buildStatementPdfHtml } from './shared/pdf';
import type { BusinessPdfData } from './shared/pdf';
import {
  buildStatement,
  statementToCsv,
  statementPeriodLabel,
  isoDateInZone,
  DEFAULT_STATEMENT_TIME_ZONE,
} from './shared/statement';
import type { StatementDocumentInput } from './shared/statement';
import {
  buildSelfCopyBcc,
  resolveTradieReplyEmail,
  businessLogoHtml,
  businessCredentials,
} from './documentHandlers';
import { recordAccountantStatementSent } from './featureUsage';

const db = () => admin.firestore();
const corsHandler = cors({ origin: true });

interface BusinessSettings {
  businessName?: string;
  email?: string;
  phone?: string;
  address?: string;
  abn?: string;
  website?: string;
  logoStorageUrl?: string;
  logoUri?: string;
  brandColor?: string;
  pdfTemplate?: any;
  gstRegistered?: boolean;
  pricesIncludeGst?: boolean;
  accountantEmail?: string;
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in accountantStatement.test.ts)
// ---------------------------------------------------------------------------

/** 24 months, allowing for a leap day. */
export const MAX_STATEMENT_SPAN_MS = 731 * 24 * 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface StatementRequest {
  fromMs: number;
  toMs: number;
  recipientEmail: string;
  subject?: string;
  emailBody?: string;
  sendCopyToSelf: boolean;
  timeZone: string;
}

export type ParsedStatementRequest =
  | { ok: true; value: StatementRequest }
  | { ok: false; error: string };

function isUsableTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Validate the POST body. Range is [fromMs, toMs), at most 24 months. */
export function parseStatementRequest(body: unknown): ParsedStatementRequest {
  const b = (body || {}) as Record<string, unknown>;
  const fromMs = Number(b.fromMs);
  const toMs = Number(b.toMs);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs <= 0 || toMs <= 0) {
    return { ok: false, error: 'fromMs and toMs (ms epoch) are required.' };
  }
  if (fromMs >= toMs) {
    return { ok: false, error: 'The period must end after it starts.' };
  }
  if (toMs - fromMs > MAX_STATEMENT_SPAN_MS) {
    return { ok: false, error: 'The period can cover at most 24 months.' };
  }
  const recipientEmail = typeof b.recipientEmail === 'string' ? b.recipientEmail.trim() : '';
  if (!recipientEmail || !EMAIL_RE.test(recipientEmail)) {
    return { ok: false, error: 'A valid recipient email is required.' };
  }
  return {
    ok: true,
    value: {
      fromMs,
      toMs,
      recipientEmail,
      subject: typeof b.subject === 'string' && b.subject.trim() ? b.subject.trim() : undefined,
      emailBody: typeof b.emailBody === 'string' && b.emailBody.trim() ? b.emailBody.trim() : undefined,
      sendCopyToSelf: b.sendCopyToSelf === true,
      timeZone: isUsableTimeZone(b.timeZone) ? b.timeZone : DEFAULT_STATEMENT_TIME_ZONE,
    },
  };
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface AccountantStatementEmailArgs {
  businessName: string;
  /** e.g. "1 July 2025 – 30 June 2026" */
  periodLabel: string;
  subject?: string;
  emailBody?: string;
}

export interface AccountantStatementEmail {
  subject: string;
  textContent: string;
  htmlContent: string;
}

/**
 * Subject and body of the email the accountant receives. A short plain note
 * from the tradie; the statement itself is in the attachments. Pure.
 */
export function buildAccountantStatementEmail(args: AccountantStatementEmailArgs): AccountantStatementEmail {
  const businessName = (args.businessName || '').trim() || 'Your client';
  const subject = (args.subject || '').trim() || `Statement ${args.periodLabel} – ${businessName}`;
  const body = (args.emailBody || '').trim()
    || `Hi,\n\nPlease find attached a statement of invoices issued and payments received for ${args.periodLabel}. The PDF is for reading; the CSV holds the same figures for your software.\n\nThanks,\n${businessName}`;

  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 16px;">${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');

  const htmlContent = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
        <tr><td style="padding:36px 32px;">
          <p style="color:#64748b;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin:0 0 8px;">${esc(businessName)}</p>
          <h1 style="color:#0f172a;font-size:22px;font-weight:700;margin:0 0 18px;line-height:1.3;">Statement ${esc(args.periodLabel)}</h1>
          ${paragraphs}
          <p style="color:#64748b;font-size:13px;line-height:1.6;margin:8px 0 0;">Attached: statement PDF and CSV.</p>
        </td></tr>
      </table>
      <p style="color:#94a3b8;font-size:12px;margin:20px 0 0;text-align:center;">${esc(businessName)}</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, textContent: body, htmlContent };
}

/** "Statement 2025-07-01 to 2026-06-30 Leo Wright Electrical" — add .pdf/.csv. */
export function statementAttachmentBaseName(
  fromMs: number,
  toMs: number,
  businessName: string,
  timeZone: string = DEFAULT_STATEMENT_TIME_ZONE,
): string {
  const who = (businessName || '')
    .replace(/[^\w\s&-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || 'Business';
  return `Statement ${isoDateInZone(fromMs, timeZone)} to ${isoDateInZone(toMs - 1, timeZone)} ${who}`;
}

// ---------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------

const DOCUMENTS_PAGE_SIZE = 500;

/** Every document the user has, paged — no cap, unlike the app store. */
export async function loadAllDocuments(userId: string): Promise<StatementDocumentInput[]> {
  const out: StatementDocumentInput[] = [];
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let query = db()
      .collection(`users/${userId}/documents`)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(DOCUMENTS_PAGE_SIZE);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    if (page.empty) break;
    for (const snap of page.docs) {
      out.push({ ...(snap.data() as Record<string, unknown>), id: snap.id });
    }
    last = page.docs[page.docs.length - 1];
    if (page.size < DOCUMENTS_PAGE_SIZE) break;
  }
  return out;
}

function toBusinessPdfData(business: BusinessSettings): BusinessPdfData {
  return {
    businessName: business.businessName || 'Business',
    email: business.email,
    phone: business.phone,
    website: business.website,
    abn: business.abn,
    address: business.address,
    logoHtml: businessLogoHtml(business),
    credentials: businessCredentials(business),
    brandColor: business.brandColor,
    pdfTemplate: business.pdfTemplate,
  };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

/**
 * POST { fromMs, toMs, recipientEmail, subject?, emailBody?, sendCopyToSelf?, timeZone? }
 * Builds the statement for the authed user and emails PDF + CSV to the
 * recipient. On success remembers the recipient as the accountant.
 */
export async function handleSendAccountantStatement(
  req: functions.https.Request,
  res: functions.Response,
): Promise<void> {
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  const decoded = await verifyAuth(req, res);
  if (!decoded) return;
  const userId = decoded.uid;

  const parsed = parseStatementRequest(req.body);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const { fromMs, toMs, recipientEmail, sendCopyToSelf, timeZone } = parsed.value;

  try {
    const settingsRef = db().doc(`users/${userId}/settings/business`);
    const settingsSnap = await settingsRef.get();
    const business: BusinessSettings = settingsSnap.exists ? (settingsSnap.data() as BusinessSettings) : {};
    const businessName = (business.businessName || '').trim();

    const documents = await loadAllDocuments(userId);
    const data = buildStatement(documents, { fromMs, toMs }, {
      gstRegistered: business.gstRegistered,
      pricesIncludeGst: business.pricesIncludeGst,
    });

    const pdfHtml = buildStatementPdfHtml(data, toBusinessPdfData(business), {
      fromMs, toMs, generatedAtMs: Date.now(), timeZone,
    });
    const pdfBuffer = await generateQuotePdfBuffer(pdfHtml);
    const csv = statementToCsv(data, timeZone);
    const baseName = statementAttachmentBaseName(fromMs, toMs, businessName, timeZone);

    const email = buildAccountantStatementEmail({
      businessName,
      periodLabel: statementPeriodLabel({ fromMs, toMs }, timeZone),
      subject: parsed.value.subject,
      emailBody: parsed.value.emailBody,
    });

    // Reply-To and self-copy exactly as the invoice send derives them.
    const replyEmail = await resolveTradieReplyEmail(userId, business.email);
    const selfEmail = sendCopyToSelf ? await getUserEmail(userId) : null;
    const tradieDisplayName = businessName || undefined;

    const sent = await sendEmail({
      to: recipientEmail,
      bcc: buildSelfCopyBcc({ sendCopyToSelf, isTestSend: false, selfEmail, recipientEmail }),
      subject: email.subject,
      htmlContent: email.htmlContent,
      textContent: email.textContent,
      category: 'transactional',
      userId,
      tags: ['accountant-statement'],
      attachment: [
        { name: `${baseName}.pdf`, content: pdfBuffer.toString('base64') },
        { name: `${baseName}.csv`, content: Buffer.from(csv, 'utf8').toString('base64') },
      ],
      senderName: tradieDisplayName,
      replyTo: replyEmail ? { email: replyEmail, name: tradieDisplayName } : undefined,
    });

    if (!sent) { res.status(502).json({ error: 'Statement email could not be sent.' }); return; }

    // Remember the accountant. Best-effort: the email has already gone.
    const remembered = (business.accountantEmail || '').trim().toLowerCase();
    if (remembered !== recipientEmail.toLowerCase()) {
      try {
        await settingsRef.set({ accountantEmail: recipientEmail }, { merge: true });
      } catch (err: any) {
        console.warn('[sendAccountantStatement] accountantEmail not saved', { userId, message: err?.message });
      }
    }
    recordAccountantStatementSent(userId).catch(() => {});

    res.status(200).json({
      success: true,
      invoiceCount: data.summary.invoiceCount,
      paymentCount: data.summary.paymentCount,
    });
  } catch (err: any) {
    console.error('[sendAccountantStatement] failed', { userId, message: err?.message });
    res.status(500).json({ error: 'Statement could not be built.' });
  }
}

export const sendAccountantStatement = functions
  .runWith({ timeoutSeconds: 120, memory: '1GB' })
  .https.onRequest((req, res) => {
    corsHandler(req, res, () => handleSendAccountantStatement(req, res));
  });
