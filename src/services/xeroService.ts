/**
 * Xero Integration Service
 * Client-side service that calls Firebase Cloud Functions for Xero operations.
 * Tokens are stored server-side only — this service never handles OAuth tokens.
 */

import { auth } from '../config/firebase';
import { Invoice } from '../types';

// Firebase Functions URL configuration
const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

/**
 * Helper to make authenticated requests to Cloud Functions.
 */
async function xeroFetch(endpoint: string, body?: any): Promise<any> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not signed in');

  const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

/**
 * Get the Xero OAuth authorization URL.
 * Opens in the system browser for the user to authorise.
 */
export async function getXeroAuthUrl(): Promise<{ authUrl: string; state: string }> {
  return xeroFetch('getXeroAuthUrl');
}

/**
 * Check the current Xero connection status.
 */
export async function checkXeroConnection(): Promise<{
  connected: boolean;
  tenantName?: string;
  tenantId?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  syncEnabled?: boolean;
  disconnectedReason?: string;
}> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) return { connected: false };

  const response = await fetch(`${FIREBASE_FUNCTIONS_URL}/checkXeroConnection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
  });

  if (!response.ok) return { connected: false };
  return response.json();
}

/**
 * Disconnect from Xero (revoke tokens).
 */
export async function disconnectXero(): Promise<void> {
  await xeroFetch('xeroDisconnect');
}

/**
 * Select which Xero tenant (organisation) to use.
 */
export async function selectXeroTenant(tenantId: string, tenantName: string): Promise<void> {
  await xeroFetch('xeroSelectTenant', { tenantId, tenantName });
}

/**
 * Push a single invoice to Xero.
 * Returns the Xero invoice ID and contact ID for local storage.
 */
export async function pushInvoiceToXero(invoice: Invoice): Promise<{
  success: boolean;
  xeroInvoiceId?: string;
  xeroContactId?: string;
  xeroTotal?: number;
}> {
  // Serialize the invoice for the Cloud Function
  const serialized = {
    ...invoice,
    createdAt: invoice.createdAt instanceof Date ? invoice.createdAt.toISOString() : invoice.createdAt,
    updatedAt: invoice.updatedAt instanceof Date ? invoice.updatedAt.toISOString() : invoice.updatedAt,
    issueDate: invoice.issueDate instanceof Date ? invoice.issueDate.toISOString() : invoice.issueDate,
    dueDate: invoice.dueDate instanceof Date ? invoice.dueDate.toISOString() : invoice.dueDate,
    paidDate: invoice.paidDate instanceof Date ? invoice.paidDate.toISOString() : invoice.paidDate,
    xeroSyncedAt: invoice.xeroSyncedAt instanceof Date ? invoice.xeroSyncedAt.toISOString() : invoice.xeroSyncedAt,
  };

  return xeroFetch('pushInvoiceToXero', { invoice: serialized });
}

/**
 * Push a payment to Xero for an already-synced invoice.
 */
export async function pushPaymentToXero(
  invoiceId: string,
  xeroInvoiceId: string,
  amount: number,
  date: Date,
  paymentMethod?: string,
): Promise<{ success: boolean; xeroPaymentId?: string }> {
  return xeroFetch('pushPaymentToXero', {
    invoiceId,
    xeroInvoiceId,
    amount,
    date: date.toISOString(),
    paymentMethod,
  });
}

/**
 * Bulk sync multiple invoices to Xero.
 */
export async function xeroBulkSync(invoiceIds: string[]): Promise<{
  results: { invoiceId: string; success: boolean; error?: string; xeroInvoiceId?: string }[];
  successCount: number;
  totalCount: number;
}> {
  return xeroFetch('xeroBulkSync', { invoiceIds });
}
