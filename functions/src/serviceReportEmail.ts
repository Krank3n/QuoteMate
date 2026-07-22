// Phase-2 Service Report email sender.
//
// A Service Report is a customer-facing leave-behind a tradie produces after a
// service visit (users/{uid}/reports/{reportId}). It is NOT a Document: it
// carries no money, no stage, no line items — so this sender is deliberately a
// stripped-down sibling of documentHandlers.sendDocumentEmail:
//   - NO Square payment link is minted or rendered.
//   - NO Terms & Conditions are snapshotted or attached.
//   - Every customer-facing string shows ONLY the tradie's business name —
//     never "QuoteMate", never "via QuoteMate", and never the word "AI".
//
// Registration in index.ts is intentionally deferred (Phase-2 wiring) — this
// module only exports the core sender and the onRequest handler.

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import cors from 'cors';
import { verifyAuth } from './assistantToken';
import { sendEmail, getUserEmail } from './email';
import { generateQuotePdfBuffer } from './pdfGenerator';
import { buildReportPdfHtml } from './shared/pdf';
import type { ReportPdfData, BusinessPdfData } from './shared/pdf';
import type { ServiceReport } from './shared/report/types';

type AnyData = Record<string, any>;

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
  [key: string]: any;
}

export interface SendServiceReportEmailInput {
  userId: string;
  recipientEmail: string;
  /** Optional tradie-authored cover note. Falls back to a neutral default. */
  emailBody?: string;
  /** Optional subject override. Falls back to "Service report … - …". */
  subject?: string;
  /** Attach the report photos as inline images in the PDF/email when true. */
  includePhotos?: boolean;
}

export interface SendServiceReportEmailResult {
  success: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in serviceReportEmail.helpers.test.ts)
// ---------------------------------------------------------------------------

/** Reduce a display string to a filesystem-safe token. Mirrors the
 * sanitizeFilename used by documentHandlers so attachment names stay tidy. */
export function sanitizeReportFilename(s: string): string {
  return (s || '').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 30);
}

/** Build the PDF attachment filename, e.g. "Service_Report_RP-001_John_Smith.pdf". */
export function reportAttachmentFilename(reportNumber: string, customerName: string): string {
  const num = sanitizeReportFilename(reportNumber) || 'Report';
  const who = sanitizeReportFilename(customerName) || 'Client';
  return `Service_Report_${num}_${who}.pdf`;
}

/** Australian long-date, e.g. "22 July 2026". Pure — deterministic for a given ms. */
export function fmtAuDate(value: number | undefined): string {
  return new Date(value || Date.now()).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface ReportEmailHtmlArgs {
  businessName: string;
  customerName: string;
  reportNumber: string;
  serviceType: string;
  visitDate: string; // preformatted
  emailBody: string;
}

/**
 * Build the report email body. Customer-facing, so it shows ONLY the tradie's
 * business name — never "QuoteMate" — and never the word "AI". Pure/offline.
 */
export function buildReportEmailHtml(args: ReportEmailHtmlArgs): string {
  const { businessName, customerName, reportNumber, serviceType, visitDate, emailBody } = args;
  const name = esc(businessName || 'Your Tradie');
  const bodyHtml = esc(emailBody || '').replace(/\n/g, '<br/>');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
        <tr><td style="padding:36px 32px;">
          <p style="color:#64748b;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin:0 0 8px;">${name}</p>
          <h1 style="color:#0f172a;font-size:22px;font-weight:700;margin:0 0 18px;line-height:1.3;">Your service report</h1>
          <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(customerName || 'there')},</p>
          <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 20px;">${bodyHtml || 'Please find your service report attached.'}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;margin:0 0 20px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 6px;color:#64748b;font-size:13px;">Report number</p>
              <p style="margin:0 0 14px;color:#0f172a;font-size:15px;font-weight:600;">${esc(reportNumber)}</p>
              <p style="margin:0 0 6px;color:#64748b;font-size:13px;">Service</p>
              <p style="margin:0 0 14px;color:#0f172a;font-size:15px;font-weight:600;">${esc(serviceType || 'Service visit')}</p>
              <p style="margin:0 0 6px;color:#64748b;font-size:13px;">Visit date</p>
              <p style="margin:0;color:#0f172a;font-size:15px;font-weight:600;">${esc(visitDate)}</p>
            </td></tr>
          </table>
          <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 24px;">The full report is attached as a PDF. If you have any questions, just reply to this email.</p>
          <p style="color:#0f172a;font-size:15px;line-height:1.6;margin:0;">Cheers,<br/><strong>${name}</strong></p>
        </td></tr>
      </table>
      <p style="color:#94a3b8;font-size:12px;margin:20px 0 0;text-align:center;">${name}</p>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Map a ServiceReport (plus its parent Job for customer identity) into the
 * ReportPdfData shape. Pure. Deliberately carries NO money, NO terms, and NO
 * Square/payment fields — a report is a leave-behind, not an invoice.
 */
export function buildReportPdfData(report: ServiceReport, job: AnyData | null, includePhotos = true): ReportPdfData {
  const j = job || {};
  const data: ReportPdfData = {
    reportNumber: report.number,
    customerName: j.customerName || 'Client',
    customerEmail: j.customerEmail || undefined,
    customerPhone: j.customerPhone || undefined,
    jobAddress: j.jobAddress || undefined,
    visitDate: fmtAuDate(report.visitDate),
    serviceType: report.serviceType || '',
    riskAssessment: report.riskAssessment || undefined,
    equipment: Array.isArray(report.equipment) ? report.equipment : [],
    itemsChecked: (report.itemsChecked || []).map((it) => ({ text: it.text, checked: !!it.checked })),
    natureOfProblem: report.natureOfProblem || undefined,
    workCarriedOut: report.workCarriedOut || undefined,
    recommendedWork: report.recommendedWork || undefined,
    photos: includePhotos && Array.isArray(report.photos)
      ? report.photos.map((p) => ({ url: p.storageUrl })).filter((p) => !!p.url)
      : undefined,
    customerSignature: report.customerSignature
      ? { svgPath: report.customerSignature.svgPath, name: report.customerSignature.name }
      : undefined,
    technicianSignature: report.technicianSignature
      ? { svgPath: report.technicianSignature.svgPath, name: report.technicianSignature.name }
      : undefined,
  };
  return data;
}

// Loose RFC 5321 sanity check — mirrors documentHandlers.isLikelyValidEmail.
function isLikelyValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((s || '').trim());
}

// ---------------------------------------------------------------------------
// Core sender
// ---------------------------------------------------------------------------

/**
 * Load the report's business settings + parent job, render the report PDF,
 * attach it, and send the customer email — then stamp the report as sent.
 *
 * CRITICAL: no Square link is minted, no T&Cs are snapshotted/attached, and
 * every customer-facing string shows only the business name.
 */
export async function sendServiceReportEmail(
  report: ServiceReport,
  input: SendServiceReportEmailInput,
): Promise<SendServiceReportEmailResult> {
  const firestore = db();
  const { userId, recipientEmail, subject } = input;
  const includePhotos = input.includePhotos !== false;

  const settingsSnap = await firestore.doc(`users/${userId}/settings/business`).get();
  const business: BusinessSettings = settingsSnap.exists ? (settingsSnap.data() as BusinessSettings) : {};

  const jobSnap = report.jobId
    ? await firestore.doc(`users/${userId}/jobs/${report.jobId}`).get()
    : null;
  const job: AnyData | null = jobSnap && jobSnap.exists ? (jobSnap.data() as AnyData) : null;

  const pdfData = buildReportPdfData(report, job, includePhotos);

  const logoUrl = business.logoStorageUrl || business.logoUri || '';
  const businessData: BusinessPdfData = {
    businessName: business.businessName || 'Business',
    email: business.email,
    phone: business.phone,
    website: business.website,
    abn: business.abn,
    address: business.address,
    logoHtml: logoUrl ? `<img src="${logoUrl}" alt="${business.businessName || 'Business'}" class="logo" />` : '',
    brandColor: business.brandColor,
    pdfTemplate: business.pdfTemplate,
  };

  const pdfHtml = buildReportPdfHtml(pdfData, businessData);
  const pdfBuffer = await generateQuotePdfBuffer(pdfHtml);
  const pdfBase64 = pdfBuffer.toString('base64');
  const pdfFilename = reportAttachmentFilename(report.number, pdfData.customerName);

  const emailBody = (input.emailBody || '').trim();
  const htmlContent = buildReportEmailHtml({
    businessName: business.businessName || '',
    customerName: pdfData.customerName,
    reportNumber: report.number,
    serviceType: report.serviceType || '',
    visitDate: pdfData.visitDate,
    emailBody,
  });

  // Reply-To: prefer the saved business email so customer replies land in the
  // tradie's inbox; fall back to the auth email. Display name is the business.
  const businessEmail = (business.email || '').trim();
  let replyEmail: string | null = businessEmail && isLikelyValidEmail(businessEmail) ? businessEmail : null;
  if (!replyEmail) {
    const authEmail = await getUserEmail(userId);
    replyEmail = authEmail && isLikelyValidEmail(authEmail) ? authEmail : null;
  }
  const tradieDisplayName = business.businessName || undefined;

  const trimmedSubject = (subject || '').trim();
  const baseSubject = trimmedSubject
    || `Service report from ${business.businessName || 'Your Tradie'} - ${report.serviceType || 'Service visit'}`;

  const sent = await sendEmail({
    to: recipientEmail,
    subject: baseSubject,
    htmlContent,
    category: 'transactional',
    userId,
    tags: ['service-report-to-client'],
    attachment: [{ name: pdfFilename, content: pdfBase64 }],
    senderName: tradieDisplayName,
    replyTo: replyEmail ? { email: replyEmail, name: tradieDisplayName } : undefined,
  });

  if (!sent) return { success: false };

  // Stamp the report as sent. All fields are defined, so no undefined can reach
  // Firestore; keep the merge minimal.
  await firestore.doc(`users/${userId}/reports/${report.id}`).set({
    status: 'sent',
    sentAt: Date.now(),
    sendMethod: 'email',
    updatedAt: Date.now(),
  }, { merge: true });

  return { success: true };
}

// ---------------------------------------------------------------------------
// HTTP handler (NOT registered in index.ts yet — Phase-2 wiring is deferred)
// ---------------------------------------------------------------------------

/**
 * POST { reportId, recipientEmail, emailBody?, subject?, includePhotos? }
 * Loads users/{uid}/reports/{reportId} for the authed user and sends it.
 */
export const sendServiceReport = functions
  .runWith({ timeoutSeconds: 120, memory: '1GB' })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

      const decoded = await verifyAuth(req, res);
      if (!decoded) return;
      const userId = decoded.uid;

      const { reportId, recipientEmail, emailBody, subject, includePhotos } = req.body || {};
      if (!reportId || typeof reportId !== 'string') {
        res.status(400).json({ error: 'reportId required.' });
        return;
      }
      if (!recipientEmail || typeof recipientEmail !== 'string') {
        res.status(400).json({ error: 'recipientEmail required.' });
        return;
      }

      const snap = await db().doc(`users/${userId}/reports/${reportId}`).get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Report not found.' });
        return;
      }
      const report = { id: snap.id, ...(snap.data() as AnyData) } as ServiceReport;

      try {
        const result = await sendServiceReportEmail(report, {
          userId,
          recipientEmail,
          emailBody: typeof emailBody === 'string' ? emailBody : undefined,
          subject: typeof subject === 'string' ? subject : undefined,
          includePhotos: includePhotos !== false,
        });
        if (!result.success) {
          res.status(502).json({ error: 'Report email could not be sent.' });
          return;
        }
        res.status(200).json({ success: true });
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error('[sendServiceReport] failed', { userId, reportId, message: err?.message });
        res.status(500).json({ error: 'Report email failed.' });
      }
    });
  });
