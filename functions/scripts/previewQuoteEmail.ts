/**
 * Preview a previously-sent quote email by re-sending it to an arbitrary
 * recipient — without mutating the live quote.
 *
 * Why this exists: the customer-facing email body is built client-side and only
 * persisted on the quote (as `aiEmailBody`) once the customer send completes.
 * Re-sending through the live `sendQuoteEmail` endpoint would rotate the
 * acceptance token and flip stages — fine for a real resend, destructive for a
 * preview because it invalidates the link the customer already received.
 *
 * This script mirrors what `sendQuoteFlavour` does (load the doc, render HTML
 * + PDF with the shared builders, send via Brevo) but writes nothing back. The
 * acceptance URL in the preview is a clearly-labeled placeholder since the
 * stored token is hashed and unrecoverable; everything else is byte-identical
 * to what the customer received.
 *
 *   BREVO_API_KEY=... npx ts-node scripts/previewQuoteEmail.ts \
 *     <quoteId> <ownerEmail> <recipient>
 *
 *   # defaults: quoteId=1777271807728-bublfslt3
 *   #          ownerEmail=justinharbottle@icloud.com
 *   #          recipient=tom@hansendev.com.au
 *   BREVO_API_KEY=... npx ts-node scripts/previewQuoteEmail.ts
 *
 * Run from the functions/ directory. Needs Application Default Credentials
 * (firebase login or gcloud auth application-default login) and BREVO_API_KEY.
 */

import * as os from 'os';
import * as admin from 'firebase-admin';
import puppeteer from 'puppeteer-core';
import fetch from 'node-fetch';

import {
  buildQuoteEmailHtml,
} from '../src/email';
import {
  buildQuotePdfHtml,
} from '../src/pdfGenerator';
import {
  documentRecordToQuoteRecord,
  quoteRecordToDocumentRecord,
} from '../src/shared/document/adapter';

const DEFAULT_QUOTE_ID = '1777271807728-bublfslt3';
const DEFAULT_OWNER_EMAIL = 'justinharbottle@icloud.com';
const DEFAULT_RECIPIENT = 'tom@hansendev.com.au';

const PLACEHOLDER_ACCEPTANCE_URL =
  'https://us-central1-hansendev.cloudfunctions.net/quoteAcceptancePage?token=PREVIEW_NONFUNCTIONAL_DO_NOT_CLICK';

function applyHideMarkupForDisplay(q: any) {
  const matMarkup = Number(q.markup) || 0;
  const laborMarkup = Number(q.laborMarkup ?? q.markup) || 0;
  const hideMarkup = q.showMarkup !== true && (matMarkup > 0 || laborMarkup > 0);
  if (!hideMarkup) {
    return {
      materials: (q.materials || []).map((m: any) => ({ ...m })),
      materialsSubtotal: q.materialsSubtotal || 0,
      laborTotal: q.laborTotal || 0,
      subtotal: q.subtotal || 0,
    };
  }
  const matFactor = 1 + matMarkup / 100;
  const laborFactor = 1 + laborMarkup / 100;
  const inflatedMaterials = (q.materials || []).map((m: any) => ({
    ...m,
    price: (Number(m.price) || 0) * matFactor,
    totalPrice: (Number(m.totalPrice) || 0) * matFactor,
  }));
  return {
    materials: inflatedMaterials,
    materialsSubtotal: (Number(q.materialsSubtotal) || 0) * matFactor,
    laborTotal: (Number(q.laborTotal) || 0) * laborFactor,
    subtotal:
      ((Number(q.materialsSubtotal) || 0) * matFactor) +
      ((Number(q.laborTotal) || 0) * laborFactor) +
      (Number(q.travelAdjustment) || 0),
  };
}

function buildPdfMaterials(materials: any[]): any[] {
  return (materials || []).map((m: any) => ({
    name: m.name,
    quantity: m.quantity,
    unit: m.unit,
    price: m.price || 0,
    totalPrice: m.totalPrice || 0,
    section: m.section,
  }));
}

function buildPdfSections(sections: any[]): any[] {
  return (sections || []).map((s: any) => ({
    name: s.name,
    laborHours: s.laborHours,
    laborRate: s.laborRate,
    laborUnit: s.laborUnit,
    laborTotal: s.laborTotal,
  }));
}

function businessLogoHtml(business: any): string {
  const url = business.logoStorageUrl || business.logoUri || '';
  if (!url) return '';
  return `<img src="${url}" alt="${business.businessName || 'Business'}" class="logo" />`;
}

function fmtAuDate(value: any): string {
  return new Date(value || Date.now()).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 30);
}

// On macOS the bundled @sparticuz/chromium binary is Linux-only, so prefer
// the system Chrome install. On Linux (CI / Cloud Shell) fall back to chromium.
async function localChromeExecutablePath(): Promise<string> {
  const envPath = process.env.CHROME_PATH;
  if (envPath) return envPath;
  if (os.platform() === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  const chromium = await import('@sparticuz/chromium');
  return chromium.default.executablePath();
}

async function generatePdfBufferLocal(html: string): Promise<Buffer> {
  const executablePath = await localChromeExecutablePath();
  const browser = await puppeteer.launch({
    defaultViewport: { width: 1920, height: 1080 },
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '40px', right: '40px', bottom: '40px', left: '40px' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

async function fetchPhotoAttachments(
  photoUrls: string[]
): Promise<Array<{ name: string; content: string }>> {
  const remoteUrls = photoUrls.filter((url) => /^https?:\/\//i.test(url));
  const results = await Promise.allSettled(
    remoteUrls.map(async (url, index) => {
      const response = await fetch(url);
      if (!response.ok) return null;
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : 'jpg';
      const buffer = await response.buffer();
      return {
        name: `Job_Photo_${index + 1}.${ext}`,
        content: buffer.toString('base64'),
      };
    })
  );
  const out: Array<{ name: string; content: string }> = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) out.push(r.value);
  }
  return out;
}

// Direct Brevo call. Doesn't write to the emailLog collection — this is a
// preview, not a real customer send, and we don't want it polluting analytics.
async function sendBrevoEmail(opts: {
  to: string;
  subject: string;
  htmlContent: string;
  attachment: Array<{ name: string; content: string }>;
}): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error('BREVO_API_KEY is not set in env');
  }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: 'noreply@hansendev.com.au', name: 'QuoteMate' },
      replyTo: { email: 'tom@hansendev.com.au', name: 'Tom at QuoteMate' },
      to: [{ email: opts.to }],
      subject: opts.subject,
      htmlContent: opts.htmlContent,
      tags: ['quote-preview-admin'],
      attachment: opts.attachment,
    }),
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Brevo ${response.status}: ${errBody}`);
  }
  const body = await response.json().catch(() => ({}));
  console.log('  Brevo accepted:', JSON.stringify(body));
}

async function main() {
  const args = process.argv.slice(2);
  const quoteId = args[0] || DEFAULT_QUOTE_ID;
  const ownerEmail = args[1] || DEFAULT_OWNER_EMAIL;
  const recipient = args[2] || DEFAULT_RECIPIENT;

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.GCLOUD_PROJECT || 'hansendev',
    });
  }

  console.log('\n=== Quote email preview ===');
  console.log(`  quoteId:   ${quoteId}`);
  console.log(`  owner:     ${ownerEmail}`);
  console.log(`  recipient: ${recipient}\n`);

  // Resolve Justin's UID from his auth email.
  const userRecord = await admin.auth().getUserByEmail(ownerEmail);
  const userId = userRecord.uid;
  console.log(`Resolved owner uid: ${userId}`);

  const firestore = admin.firestore();

  // Prefer the unified document; fall back to the legacy quote and adapt.
  let docRecord: any = null;
  const docSnap = await firestore.doc(`users/${userId}/documents/${quoteId}`).get();
  if (docSnap.exists) {
    docRecord = docSnap.data();
  } else {
    const quoteSnap = await firestore.doc(`users/${userId}/quotes/${quoteId}`).get();
    if (!quoteSnap.exists) {
      throw new Error(`Quote not found at users/${userId}/{documents,quotes}/${quoteId}`);
    }
    docRecord = quoteRecordToDocumentRecord(quoteSnap.data() as any, quoteId);
  }

  // The legacy quote doc carries `aiEmailBody` — that's the exact body that
  // was sent. The unified mirror also propagates it. Read whichever exists.
  const quoteSnap = await firestore.doc(`users/${userId}/quotes/${quoteId}`).get();
  const legacyQuote = quoteSnap.exists ? (quoteSnap.data() as any) : {};
  const emailBody: string =
    legacyQuote.aiEmailBody ||
    (docRecord && (docRecord as any).aiEmailBody) ||
    '';

  if (!emailBody) {
    throw new Error(
      'No aiEmailBody on the quote — was the quote ever actually sent? ' +
      'Aborting rather than guessing the body.'
    );
  }
  console.log(`emailBody length: ${emailBody.length} chars`);

  // Settings
  const settingsSnap = await firestore.doc(`users/${userId}/settings/business`).get();
  const business: any = settingsSnap.exists ? settingsSnap.data() : {};

  // Build the legacy-shaped quote view the email/PDF builders expect.
  const quote: any = documentRecordToQuoteRecord(docRecord);
  // Merge in legacy-only fields the unified mirror may not carry (e.g.
  // historic `aiEmailBody`, `acceptanceTokenHash`). Harmless if duplicate.
  for (const k of Object.keys(legacyQuote)) {
    if (quote[k] === undefined) quote[k] = legacyQuote[k];
  }

  const photoUrls: string[] = (quote.photos || [])
    .map((p: any) => p.storageUrl)
    .filter(Boolean);

  const display = applyHideMarkupForDisplay(quote);
  const emailMaterials = display.materials.map((m: any) => ({
    name: m.name, quantity: m.quantity, unit: m.unit,
    totalPrice: m.totalPrice || 0, section: m.section,
  }));

  const businessData = {
    name: business.businessName || '',
    abn: business.abn,
    phone: business.phone,
    email: business.email,
    address: business.address,
    logoUrl: business.logoStorageUrl || business.logoUri || '',
    brandColor: business.brandColor,
  };

  const depositRequired = quote.requireDeposit === true;
  const depositPct = depositRequired ? (Number(quote.depositPercentage) || 0) : 0;
  const depositAmount = depositPct > 0
    ? Math.round((Number(quote.total) || 0) * (depositPct / 100) * 100) / 100
    : 0;

  console.log('Building email HTML...');
  const htmlContent = buildQuoteEmailHtml({
    customerName: quote.customerName || 'Client',
    emailBody,
    jobName: quote.job?.name || 'Job',
    materials: emailMaterials,
    laborTotal: display.laborTotal,
    materialsSubtotal: display.materialsSubtotal,
    subtotal: display.subtotal,
    gst: quote.gst || 0,
    total: quote.total || 0,
    acceptanceUrl: PLACEHOLDER_ACCEPTANCE_URL,
    photoUrls,
    depositAmount: depositAmount || undefined,
    depositPercentage: depositPct || undefined,
    depositPayNowUrl: undefined,
    hasTerms: !!(business.termsAndConditions && String(business.termsAndConditions).trim()),
    business: businessData,
  });

  console.log('Building PDF HTML...');
  const pdfHtml = buildQuotePdfHtml(
    {
      customerName: quote.customerName || 'Client',
      customerEmail: quote.customerEmail,
      customerPhone: quote.customerPhone,
      jobAddress: quote.jobAddress,
      quoteNumber: quote.quoteNumber,
      quoteDate: fmtAuDate(quote.updatedAt),
      job: quote.job || { name: 'Job', description: '' },
      materials: buildPdfMaterials(quote.materials),
      materialsSubtotal: quote.materialsSubtotal || 0,
      laborHours: quote.laborHours,
      laborRate: quote.laborRate,
      laborUnit: quote.laborUnit,
      laborTotal: quote.laborTotal || 0,
      laborExtraHours: quote.laborExtraHours,
      sections: buildPdfSections(quote.sections),
      subtotal: quote.subtotal || 0,
      markup: quote.markup || 0,
      markupAmount: quote.markupAmount || 0,
      laborMarkup: quote.laborMarkup ?? quote.markup ?? 0,
      showMarkup: quote.showMarkup === true && business.showMarkup !== false,
      travelAdjustment: quote.travelAdjustment,
      gst: quote.gst || 0,
      total: quote.total || 0,
      notes: quote.notes,
      showLaborHours: business.showLaborHours,
      showLaborBreakdown: quote.showLaborBreakdown !== false,
      paymentMethods: business.paymentMethods,
      terms: typeof business.termsAndConditions === 'string'
        ? business.termsAndConditions.trim() || undefined
        : undefined,
    },
    {
      businessName: business.businessName || 'Business',
      email: business.email,
      phone: business.phone,
      website: business.website,
      abn: business.abn,
      address: business.address,
      logoHtml: businessLogoHtml(business),
      brandColor: business.brandColor,
      pdfTemplate: business.pdfTemplate,
    },
  );

  console.log('Rendering PDF (this takes ~5s)...');
  const pdfBuffer = await generatePdfBufferLocal(pdfHtml);
  const pdfFilename = `Quote_${sanitizeFilename(quote.customerName || 'Client')}_${sanitizeFilename(quote.job?.name || 'Job')}.pdf`;
  const attachments: Array<{ name: string; content: string }> = [
    { name: pdfFilename, content: pdfBuffer.toString('base64') },
  ];

  if (photoUrls.length > 0) {
    console.log(`Fetching ${photoUrls.length} photo attachment(s)...`);
    const photoAttachments = await fetchPhotoAttachments(photoUrls);
    attachments.push(...photoAttachments);
    console.log(`  Got ${photoAttachments.length} photos`);
  }

  const subject = `[PREVIEW] Quotation from ${business.businessName || 'Your Tradie'} - ${quote.job?.name || 'Job'}`;
  console.log(`Sending preview to ${recipient}...`);
  await sendBrevoEmail({
    to: recipient,
    subject,
    htmlContent,
    attachment: attachments,
  });

  console.log(
    '\nDone. The accept buttons in the preview email will not work — the\n' +
    "stored acceptance token is hashed and unrecoverable. The customer's\n" +
    'real link is unaffected because this script writes nothing.\n'
  );
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
