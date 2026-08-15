/**
 * Shared Xero sync helpers used by both the HTTP push endpoint and the
 * Firestore auto-push trigger. Centralises the contact upsert, line-item
 * building, and the actual POST to Xero so the two callers can't drift.
 *
 * Token fetching stays in index.ts (`getXeroTokens`) — these helpers take
 * pre-fetched headers so they don't pull the OAuth machinery into shared
 * code.
 */

import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import { resolvePriceDetail } from './shared/document/priceDetail';

export type XeroAuthHeaders = Record<string, string>;

export function buildXeroAuthHeaders(accessToken: string, tenantId: string): XeroAuthHeaders {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'xero-tenant-id': tenantId,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

/** Loose record shape that matches both legacy Quote/Invoice and unified Document. */
export type XeroSyncSourceDoc = Record<string, any>;

const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';

/**
 * Find or create a Xero contact for the source doc, returning the ContactID.
 * Caller-supplied `existingContactId` short-circuits the lookup so the same
 * contact gets reused when a doc was previously synced or when an invoice
 * inherits the contact from its source quote.
 */
export async function upsertXeroContact(
  headers: XeroAuthHeaders,
  doc: XeroSyncSourceDoc,
  existingContactId?: string,
): Promise<string | null> {
  if (existingContactId) return existingContactId;

  const customerName: string = doc.customerName || '';
  if (!customerName) return null;

  const escapedName = customerName.replace(/"/g, '\\"');
  const whereClause = encodeURIComponent(`Name=="${escapedName}"`);
  const search = await fetch(`${XERO_API_BASE}/Contacts?where=${whereClause}`, { headers });
  if (search.ok) {
    const data: any = await search.json();
    const found = data.Contacts?.[0]?.ContactID;
    if (found) return found;
  }

  const contactPayload: any = {
    Name: customerName,
    ...(doc.customerEmail && { EmailAddress: doc.customerEmail }),
    ...(doc.customerPhone && { Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: doc.customerPhone }] }),
    ...(doc.jobAddress && {
      Addresses: [{ AddressType: 'STREET', AddressLine1: doc.jobAddress, Country: 'AU' }],
    }),
  };
  const create = await fetch(`${XERO_API_BASE}/Contacts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ Contacts: [contactPayload] }),
  });
  if (!create.ok) return null;
  const created: any = await create.json();
  return created.Contacts?.[0]?.ContactID ?? null;
}

/**
 * Build Xero LineItems from a doc's materials/sections/markup. Shared between
 * quote and invoice push so the two records show the same breakdown in Xero.
 *
 * Honours the same presentation the PDF does (shared/document/priceDetail):
 * anything but a fully itemised document goes across as ONE summary line, so
 * the tradie's customer sees the same shape in both places AND the lines
 * always sum to the invoice total.
 *
 * Falls back to a single summary line when nothing itemised is present.
 */
export function buildXeroLineItems(doc: XeroSyncSourceDoc): any[] {
  // Resolve through the one resolver. Reading the legacy flags raw here was
  // load-bearing and wrong the moment 'summary' existed: its legacy pair says
  // "labour hidden", which skipped the entire labour loop while materials
  // stayed on — so Xero received an invoice whose lines summed to the
  // materials alone. For a labour-dominant trade that is most of the invoice,
  // and it lands in the tradie's accounting, not just on a page.
  const detail = resolvePriceDetail(doc);
  const itemised = detail === 'itemised';

  // Not GST-registered: line amounts carry no tax component at all — BAS
  // Excluded keeps the sale off the GST section of the tradie's BAS.
  const gstRegistered = doc.gstRegistered !== false;
  const taxType = gstRegistered ? 'OUTPUT' : 'BASEXCLUDED';

  // Pre-GST grand total the customer signed for. doc.subtotal is *pre-markup*
  // (materials + labour only), so it under-counts; derive from doc.total
  // instead. Inclusive mode: line UnitAmounts already include GST. Exclusive
  // mode: strip the 10% Xero will add back on. Not registered: total has no
  // GST in it, send as-is.
  const total = Number(doc.total ?? 0);
  const summaryAmount =
    !gstRegistered || doc.pricesIncludeGst === true
      ? total
      : Math.round((total / 1.1) * 100) / 100;

  // Anything but a fully itemised document goes to Xero as ONE line for the
  // whole job. 'summary' and 'total' are decisions about what the CUSTOMER
  // sees; a partial set of lines here would simply lose money, because Xero
  // derives the invoice total from the lines it is given.
  if (!itemised) {
    return [{
      Description: doc.job?.name || 'Services',
      Quantity: 1,
      UnitAmount: summaryAmount,
      AccountCode: '200',
      TaxType: taxType,
    }];
  }

  const lineItems: any[] = [];

  if (Array.isArray(doc.materials)) {
    for (const mat of doc.materials) {
      lineItems.push({
        Description: mat.name || 'Material',
        Quantity: mat.quantity || 1,
        UnitAmount: mat.price || 0,
        AccountCode: '200',
        TaxType: taxType,
      });
    }
  }

  if (Array.isArray(doc.sections) && doc.sections.length > 0) {
    // Mirror calculateDocumentTotals: section.laborTotal is the authoritative
    // figure (writer paths already account for multiplier when computing it),
    // and laborExtraHours × top-level laborRate is the reconciliation buffer
    // that brings the section sum back to doc.laborTotal. Deriving Quantity
    // from laborTotal / laborRate avoids the historical bug where xeroSync
    // re-applied the section multiplier on top of an already-totalled
    // laborHours and produced quantities orders of magnitude too high.
    for (const s of doc.sections) {
      const sectionTotal = Number(s.laborTotal ?? 0);
      const rate = Number(s.laborRate ?? 0);
      // A lump-sum section has rate 0 by invariant, so the generic path
      // below would either divide by zero or skip the line entirely and
      // silently drop the money out of the Xero invoice. It is one line at
      // quantity 1, exactly like a work item.
      if (s.pricing === 'lumpSum') {
        if (sectionTotal === 0) continue;
        lineItems.push({
          Description: s.name || 'Section',
          Quantity: 1,
          UnitAmount: sectionTotal,
          AccountCode: '200',
          TaxType: taxType,
        });
        continue;
      }
      if (sectionTotal === 0 || rate <= 0) continue;
      const quantity =
        Number(s.laborHoursTotal)
        || (Number(s.laborHours ?? 0) * Number(s.multiplier ?? 1))
        || sectionTotal / rate;
      lineItems.push({
        Description: `Labour - ${s.name || 'Section'}`,
        Quantity: quantity,
        UnitAmount: rate,
        AccountCode: '200',
        TaxType: taxType,
      });
    }

    const extraHours = Number(doc.laborExtraHours ?? 0);
    const topRate = Number(doc.laborRate ?? 0);
    if (extraHours !== 0 && topRate > 0) {
      lineItems.push({
        Description: 'Labour adjustment',
        Quantity: extraHours,
        UnitAmount: topRate,
        AccountCode: '200',
        TaxType: taxType,
      });
    }
  } else if ((Number(doc.laborHours) || 0) > 0 && (Number(doc.laborRate) || 0) > 0) {
    lineItems.push({
      Description: `Labour - ${doc.job?.name || 'General'}`,
      Quantity: doc.laborHours,
      UnitAmount: doc.laborRate,
      AccountCode: '200',
      TaxType: taxType,
    });
  }

  if ((Number(doc.markupAmount) || 0) > 0) {
    lineItems.push({
      Description: 'Markup',
      Quantity: 1,
      UnitAmount: doc.markupAmount,
      AccountCode: '200',
      TaxType: taxType,
    });
  }

  if (lineItems.length === 0) {
    lineItems.push({
      Description: doc.job?.name || 'Services',
      Quantity: 1,
      UnitAmount: summaryAmount,
      AccountCode: '200',
      TaxType: taxType,
    });
  }

  // Last line of defence. Xero derives the invoice total from the lines it is
  // given, so a projection that silently drops a component doesn't produce a
  // wrong-looking invoice — it produces a plausible one for the wrong amount,
  // in the tradie's accounting. If the lines don't add up to what the customer
  // signed for, send the one line that does. (A "Scope only" document skipped
  // the entire labour loop this way and shipped an invoice for the materials
  // alone.)
  const linesTotal = lineItems.reduce(
    (sum, l) => sum + (Number(l.Quantity) || 0) * (Number(l.UnitAmount) || 0),
    0,
  );
  if (Math.abs(linesTotal - summaryAmount) > 0.05) {
    console.warn('[xero] line items do not sum to the document total — sending one summary line', {
      linesTotal: Math.round(linesTotal * 100) / 100,
      summaryAmount,
      lineCount: lineItems.length,
    });
    return [{
      Description: doc.job?.name || 'Services',
      Quantity: 1,
      UnitAmount: summaryAmount,
      AccountCode: '200',
      TaxType: taxType,
    }];
  }

  return lineItems;
}

/** Map a QuoteMate quote stage/status to a Xero Quote status. */
export function mapStageToXeroQuoteStatus(stageOrStatus: string | undefined): string {
  switch (stageOrStatus) {
    case 'quote_accepted':
    case 'accepted':
      return 'ACCEPTED';
    case 'quote_rejected':
    case 'rejected':
      return 'DECLINED';
    case 'quote_sent':
    case 'sent':
      return 'SENT';
    case 'draft':
    default:
      return 'DRAFT';
  }
}

function formatXeroDate(d: any): string {
  const dt = d ? new Date(d) : new Date();
  if (isNaN(dt.getTime())) return new Date().toISOString().split('T')[0];
  return dt.toISOString().split('T')[0];
}

/**
 * Map a Xero error response into a tradie-friendly message.
 *
 *  - 5xx with the generic "An error occurred in Xero" body almost always means
 *    Xero is rejecting because of state on the contact (we've seen duplicate
 *    contacts, contacts in a half-broken state from a prior buggy integration,
 *    etc.). The 500 doesn't say so directly.
 *  - 400 ValidationException — surface the first error message verbatim.
 *  - 401 — token expired or scope changed.
 *  - 429 — Xero rate limit; advise retry.
 */
function mapXeroError(status: number, body: string, quote: XeroSyncSourceDoc): string {
  if (status === 401) {
    return 'Xero session expired — please reconnect from Settings.';
  }
  if (status === 429) {
    return 'Xero is rate limiting us — wait a minute and try again.';
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* fall through */
  }

  if (status === 400 && parsed?.Elements?.[0]?.ValidationErrors?.[0]?.Message) {
    return `Xero rejected the quote: ${parsed.Elements[0].ValidationErrors[0].Message}`;
  }

  if (status >= 500 && parsed?.Detail?.toLowerCase().includes('error occurred')) {
    const customer = quote.customerName || 'this customer';
    return `Xero refused to create this quote against "${customer}". This usually means there are duplicate or corrupt contact records for this customer in Xero — open Xero, find the contact, merge any duplicates and clean up empty fields, then try again.`;
  }

  return 'Xero rejected the quote. Open the customer in Xero to check their record, then try again.';
}

export interface PushQuoteResult {
  ok: true;
  xeroQuoteId: string;
  xeroContactId: string | null;
  xeroTotal: number | null;
}
export interface PushQuoteError {
  ok: false;
  error: string;
  details?: string;
}

/**
 * Core quote-push routine: contact upsert → quote create/update → return new
 * Xero IDs. Persistence (writing IDs back onto Firestore) is the caller's
 * responsibility because the source-of-truth path differs (legacy quotes vs
 * unified documents).
 */
export async function pushQuoteToXeroCore(
  headers: XeroAuthHeaders,
  quote: XeroSyncSourceDoc,
): Promise<PushQuoteResult | PushQuoteError> {
  const xeroContactId = await upsertXeroContact(headers, quote, quote.xeroContactId);
  if (!xeroContactId) {
    return { ok: false, error: 'Failed to resolve Xero contact' };
  }

  const lineItems = buildXeroLineItems(quote);
  const xeroStatus = mapStageToXeroQuoteStatus(quote.stage || quote.status);

  // Xero Quote expiry date — use quote's stored expiry if present, otherwise
  // 30 days from today. Required by Xero when status is SENT or ACCEPTED.
  const issueDate = quote.issueDate || quote.createdAt || new Date();
  const expiryDate = quote.expiryDate
    || quote.acceptanceTokenCreatedAt
    || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const payload: any = {
    Contact: { ContactID: xeroContactId },
    QuoteNumber: quote.quoteNumber || quote.number || undefined,
    Reference: quote.job?.name || undefined,
    Date: formatXeroDate(issueDate),
    ExpiryDate: formatXeroDate(expiryDate),
    LineAmountTypes: quote.gstRegistered === false ? 'NoTax' : quote.pricesIncludeGst === true ? 'Inclusive' : 'Exclusive',
    LineItems: lineItems,
    CurrencyCode: 'AUD',
  };

  if (quote.xeroQuoteId) {
    // Re-sync — Xero locks status transitions on Quotes (e.g. ACCEPTED stays
    // ACCEPTED), and POSTing the same status reads as an invalid transition
    // and 400s. Omit Status on update so Xero keeps whatever it already has;
    // we only push the line-item / contact / reference deltas.
    payload.QuoteID = quote.xeroQuoteId;
  } else {
    // First-time push — set the status to match the QuoteMate stage.
    payload.Status = xeroStatus;
  }

  const response = await fetch(`${XERO_API_BASE}/Quotes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ Quotes: [payload] }),
  });

  if (!response.ok) {
    const details = await response.text();
    return {
      ok: false,
      error: mapXeroError(response.status, details, quote),
      details: details.slice(0, 500),
    };
  }

  const result: any = await response.json();
  const xeroQuote = result.Quotes?.[0];
  const xeroQuoteId = xeroQuote?.QuoteID;
  if (!xeroQuoteId) {
    return { ok: false, error: 'Xero accepted the request but returned no QuoteID' };
  }

  return {
    ok: true,
    xeroQuoteId,
    xeroContactId,
    xeroTotal: typeof xeroQuote.Total === 'number' ? xeroQuote.Total : null,
  };
}

/**
 * Persist a successful quote sync onto both the unified document and (best
 * effort) the legacy quote record. Centralised so the HTTP path and the
 * trigger write the same shape.
 */
export async function persistQuoteSyncSuccess(
  uid: string,
  docId: string,
  result: PushQuoteResult,
): Promise<void> {
  const firestore = admin.firestore();
  const nowIso = new Date().toISOString();

  const update = {
    xeroQuoteId: result.xeroQuoteId,
    xeroContactId: result.xeroContactId,
    xeroSyncStatus: 'synced',
    xeroSyncedAt: nowIso,
    xeroSyncError: admin.firestore.FieldValue.delete(),
  };

  // Unified document is the source of truth.
  const docRef = firestore.doc(`users/${uid}/documents/${docId}`);
  const docSnap = await docRef.get();
  if (docSnap.exists) {
    await docRef.update(update);
  }

  // Best-effort legacy mirror — the documentMirror trigger usually handles
  // this, but writing directly here keeps older clients in sync immediately.
  const legacyRef = firestore.doc(`users/${uid}/quotes/${docId}`);
  const legacySnap = await legacyRef.get();
  if (legacySnap.exists) {
    await legacyRef.update(update);
  }

  await firestore.doc(`users/${uid}/settings/xeroConnection`).set(
    { lastSyncAt: nowIso },
    { merge: true },
  );
}

/** Persist sync failure so the UI can surface it and the trigger can retry. */
export async function persistQuoteSyncError(
  uid: string,
  docId: string,
  errorMessage: string,
): Promise<void> {
  const firestore = admin.firestore();
  const update = {
    xeroSyncStatus: 'error',
    xeroSyncError: errorMessage.slice(0, 500),
  };

  const docRef = firestore.doc(`users/${uid}/documents/${docId}`);
  if ((await docRef.get()).exists) {
    await docRef.update(update);
  }
  const legacyRef = firestore.doc(`users/${uid}/quotes/${docId}`);
  if ((await legacyRef.get()).exists) {
    await legacyRef.update(update);
  }
}
