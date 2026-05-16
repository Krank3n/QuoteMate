/**
 * Reece Plumbing API Service
 *
 * Client-side wrapper around Firebase Functions for the Reece integration.
 * The customer token is held server-side only — every request here forwards
 * the user's Firebase idToken and the backend resolves the matching Reece
 * customer token from Firestore.
 *
 * Mirrors the shape of squareService.ts for visual parity.
 */

import { auth } from '../config/firebase';

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

export interface ReeceProduct {
  itemNumber: string;
  description: string;
  brand?: string;
  category?: string;
  // Smallest sellable unit (e.g. "LEN", "MTR"). Required to build a valid
  // /au/order-gateway/orders payload. May be null for products with no
  // unit-of-measure metadata.
  unitOfMeasure?: string | null;
  unitPriceExcludingGst?: number | null;
  unitPriceIncludingGst?: number | null;
  imageUrl?: string | null;
}

export interface ReecePrice {
  itemNumber: string;
  price: number;
  currency: string;
  priceIncGst?: number;
}

export interface ReeceInventory {
  itemNumber: string;
  branchCode: string;
  quantityAvailable: number;
}

export interface ReeceConnectionStatus {
  connected: boolean;
  customerNumber?: string | null;
  displayName?: string | null;
  homeBranch?: string | null;
  homeBranchNumber?: string | null;
  connectedAt?: string | null;
}

interface PriceSearchResult {
  price: number | null;
  productName?: string;
  store?: string;
  itemNumber?: string;
  imageUrl?: string | null;
  productUrl?: string;
  // Required later for order placement — captured at price-search time so we
  // don't need a second API round trip when the user taps "Order from Reece".
  unitOfMeasure?: string | null;
  unitPriceExcludingGst?: number | null;
  /**
   * Set when the backend reports the user's customer token has been revoked
   * or expired. Callers should surface a "reconnect Reece" prompt instead of
   * silently falling back to estimation.
   */
  reauthRequired?: boolean;
  /**
   * Set when the user simply hasn't connected Reece yet. Callers can prompt
   * them to connect from settings.
   */
  notConnected?: boolean;
}

async function authedFetch(
  endpoint: string,
  init: { method?: 'GET' | 'POST'; body?: any } = {},
): Promise<Response> {
  const idToken = await auth.currentUser?.getIdToken();
  return fetch(`${FIREBASE_FUNCTIONS_URL}/${endpoint}`, {
    method: init.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

// Firebase returns an HTML 404 page when a function isn't deployed, which
// blows up `response.json()` with "Unexpected character: <". Read the body
// as text first and only parse if it actually looks like JSON.
async function safeJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { __nonJson: true, status: response.status };
  }
}

/**
 * Search the Reece catalog for a product by name. Returns null if Reece can't
 * find a match, the user hasn't connected, or their token needs to be refreshed.
 */
export async function searchReeceProduct(
  productName: string,
): Promise<ReeceProduct | null> {
  try {
    const response = await authedFetch('searchReeceProduct', { body: { productName } });
    if (!response.ok) return null;
    const data = await response.json();
    return data.product || null;
  } catch {
    return null;
  }
}

/**
 * Get the current user's trade price for a given Reece product item number.
 */
export async function getReecePrice(itemNumber: string): Promise<number | null> {
  try {
    const response = await authedFetch('getReecePrice', { body: { itemNumber } });
    if (!response.ok) return null;
    const data = await response.json();
    return data.price ?? null;
  } catch {
    return null;
  }
}

/**
 * Composite: search by name and return the matched product's trade price.
 * Surfaces structured `reauthRequired` / `notConnected` flags so the caller
 * can route the user to the right UI without parsing error strings.
 *
 * Pricing is returned inline by the product search — Reece has no per-item
 * price endpoint (their price-file endpoint is a bulk dump). We prefer the
 * inc-GST price to stay consistent with how Bunnings quotes are stored;
 * fall back to ex-GST if that's all the product carries.
 */
export async function searchReeceMaterialPrice(
  materialName: string,
): Promise<PriceSearchResult> {
  const candidates = await searchReeceMaterialCandidates(materialName);
  if (candidates.length === 0) return { price: null };
  const top = candidates[0];
  if (top.reauthRequired || top.notConnected) return top;
  return top;
}

/**
 * Top-N variant of searchReeceMaterialPrice. Returns up to 5 candidates so
 * the reconciliation pass can pick the best match (or reject category
 * mismatches like a drainage fitting being returned for a "kitchen sink"
 * query). The reauth/notConnected flags ride on the first element so the
 * caller can short-circuit.
 */
export async function searchReeceMaterialCandidates(
  materialName: string,
): Promise<PriceSearchResult[]> {
  try {
    const searchResponse = await authedFetch('searchReeceProduct', {
      body: { productName: materialName },
    });
    if (!searchResponse.ok) return [];
    const searchData = await searchResponse.json();

    if (searchData.error === 'reece_reauth_required') {
      return [{ price: null, reauthRequired: true }];
    }
    if (searchData.error === 'reece_not_connected') {
      return [{ price: null, notConnected: true }];
    }

    const products: any[] = Array.isArray(searchData.products)
      ? searchData.products
      : searchData.product
        ? [searchData.product]
        : [];

    const results: PriceSearchResult[] = [];
    for (const product of products) {
      const price = product.unitPriceIncludingGst ?? product.unitPriceExcludingGst;
      if (price == null) continue;
      // Cache-sourced results carry their own productUrl (built from the
      // description because the price-file's productCode lives in a different
      // ID space than reece.com.au's web search). Live results don't, so we
      // fall back to the legacy itemNumber query.
      const productUrl = product.productUrl
        || `https://www.reece.com.au/search?query=${encodeURIComponent(product.itemNumber)}`;
      results.push({
        price,
        productName: product.description,
        store: 'Reece Plumbing',
        itemNumber: product.itemNumber,
        imageUrl: product.imageUrl ?? null,
        productUrl,
        unitOfMeasure: product.unitOfMeasure || null,
        unitPriceExcludingGst: product.unitPriceExcludingGst ?? null,
      });
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Look up product availability at a branch. The Reece public API doesn't
 * expose a stock-level endpoint, so quantityAvailable comes back as -1
 * (meaning "exists, level unknown"). The branch defaults to the user's
 * home branch from their connection record.
 */
export async function getReeceInventory(
  itemNumber: string,
  branchCode?: string,
): Promise<ReeceInventory | null> {
  try {
    const response = await authedFetch('getReeceInventory', {
      body: { itemNumber, branchCode },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.inventory || null;
  } catch {
    return null;
  }
}

/**
 * Confirm Reece's app-level OAuth credentials are configured server-side.
 * This says nothing about the calling user's connection — use
 * getReeceConnectionStatus for that.
 */
export async function checkReeceApiStatus(): Promise<boolean> {
  try {
    const response = await authedFetch('checkReeceApi', { method: 'GET' });
    if (!response.ok) return false;
    const data = await response.json();
    return data.available === true;
  } catch {
    return false;
  }
}

/**
 * Kick off the per-user Reece onboarding flow — returns the maX consent URL
 * the client should open in a browser. Once the user approves, the page
 * redirects to a static "you can close this tab" callback; the client then
 * calls completeReeceConnect with the returned requestToken.
 */
export async function startReeceConnect(): Promise<{ requestToken: string; authUrl: string }> {
  const response = await authedFetch('reeceRequestToken');
  const data = await safeJson(response);
  if (!response.ok || data.__nonJson) {
    throw new Error(data.error || 'Could not start Reece connection. Please try again.');
  }
  return { requestToken: data.requestToken, authUrl: data.authUrl };
}

/**
 * Exchange the requestToken for a long-lived customer token after the user
 * has completed the maX consent flow. Stores the encrypted token on the user's
 * Firestore integrations doc on the backend.
 */
export async function completeReeceConnect(
  requestToken: string,
): Promise<ReeceConnectionStatus> {
  const response = await authedFetch('reeceExchangeCustomerToken', { body: { requestToken } });
  const data = await safeJson(response);
  if (!response.ok || data.__nonJson) {
    throw new Error(data.error || 'Could not finish connecting Reece. Please try again.');
  }
  return {
    connected: true,
    customerNumber: data.customerNumber || null,
    displayName: data.displayName || null,
    homeBranch: data.homeBranch || null,
  };
}

/**
 * Read whether the calling user currently has a stored Reece connection.
 */
export async function getReeceConnectionStatus(): Promise<ReeceConnectionStatus> {
  try {
    const response = await authedFetch('reeceConnectionStatus', { method: 'GET' });
    if (!response.ok) return { connected: false };
    return await response.json();
  } catch {
    return { connected: false };
  }
}

/**
 * Tear down the user's stored Reece connection. The user's existing maX
 * consent on Reece's side stays dormant until they reconnect.
 */
export async function disconnectReece(): Promise<void> {
  const response = await authedFetch('reeceDisconnect');
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Could not disconnect Reece.');
  }
}

// ---------- Price-file sync -------------------------------------------------

export interface ReecePriceFileStatus {
  enabled: boolean;
  generatedAt: number | null;
  productCount: number | null;
  lastError: string | null;
}

/**
 * Build the Reece price-select redirect URL. The user opens this in a
 * browser, picks their price-file format settings on reece.com.au, then is
 * redirected back to our static callback page; the client then calls
 * confirmReecePriceFile.
 */
export async function enableReecePriceFile(): Promise<{ authUrl: string }> {
  const response = await authedFetch('reeceEnablePriceFile');
  const data = await safeJson(response);
  if (!response.ok || data.__nonJson || !data.authUrl) {
    throw new Error(data.error || 'Could not start Reece catalogue sync. Please try again.');
  }
  return { authUrl: data.authUrl };
}

/**
 * Flip the per-user `priceFileEnabled` flag and kick off the initial fetch.
 * Returns immediately — the catalogue arrives asynchronously and is visible
 * via getReecePriceFileStatus.
 */
export async function confirmReecePriceFile(): Promise<{ enabled: boolean; status: string }> {
  const response = await authedFetch('reeceConfirmPriceFile');
  const data = await safeJson(response);
  if (!response.ok || data.__nonJson) {
    throw new Error(data.error || 'Could not enable Reece catalogue sync.');
  }
  return { enabled: data.enabled === true, status: data.status || 'queued' };
}

/**
 * Trigger an immediate price-file refresh. Blocks until Reece completes
 * generation (up to ~8 minutes), so callers should show a spinner.
 */
export async function refreshReecePriceFile(): Promise<{
  status: 'ready' | 'failed' | 'reauth_required' | 'not_enabled';
  productCount?: number;
  generatedAt?: number;
  error?: string;
}> {
  const response = await authedFetch('reeceRefreshPriceFileNow');
  const data = await safeJson(response);
  if (!response.ok || data.__nonJson) {
    return { status: 'failed', error: data.error || 'refresh_failed' };
  }
  return data;
}

export async function disableReecePriceFile(): Promise<void> {
  const response = await authedFetch('reeceDisablePriceFile');
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Could not disable Reece catalogue sync.');
  }
}

export async function getReecePriceFileStatus(): Promise<ReecePriceFileStatus> {
  try {
    const response = await authedFetch('reecePriceFileStatus', { method: 'GET' });
    if (!response.ok) return { enabled: false, generatedAt: null, productCount: null, lastError: null };
    return await response.json();
  } catch {
    return { enabled: false, generatedAt: null, productCount: null, lastError: null };
  }
}

// ---------- Order gateway ---------------------------------------------------

export interface ReeceBranch {
  branchNumber: string;
  name: string;
  shortName?: string;
  address?: {
    streetAddress?: string;
    suburb?: string;
    state?: string;
    postCode?: string;
  };
  geographicalCoordinates?: {
    latitude: number;
    longitude: number;
  };
  managerName?: string;
  telephone?: string;
  emailAddress?: string;
  timeZone?: string;
}

export interface ReeceOrderProductInput {
  productId: number;
  quantity: number;
  unitOfMeasure: string;
  unitPriceExcludingGst: number;
  /** QuoteMate's quote line id, surfaced back via Reece for audit only. */
  quoteNumber?: string | null;
  quoteLineNumber?: number | null;
}

export type ReeceFulfillmentInput =
  | { type: 'PICKUP'; pickupBranch: string }
  | {
      type: 'DELIVERY';
      deliveryDetails: {
        contactName: string;
        deliveryAddress: {
          addressLine1: string;
          addressLine2?: string;
          suburb?: string;
          state?: string;
          postCode: string;
        };
      };
    };

export interface ReeceOrderRequestInput {
  orderByName: string;
  requiredByDateTime: string;        // yyyy-MM-dd'T'HH:mm:ss (no Z suffix)
  fulfillment: ReeceFulfillmentInput;
  products: ReeceOrderProductInput[];
  orderByPhone?: string;
  orderByEmail?: string;
  jobName?: string;
  /** Tradie's PO / job reference, echoed onto the printed order. */
  orderNumber?: string;
  /** Free-text note to branch staff. */
  comment?: string;
}

interface ReeceOrderViolation {
  fieldName: string;
  message: string;
}

interface ReeceOrderError {
  url: string;
  message: string;
}

export interface ReeceOrderPreviewResult {
  preview: any | null;
  /** Set when the user no longer has a valid customer token. */
  reauthRequired?: boolean;
  /** Set when the user hasn't completed Reece onboarding. */
  notConnected?: boolean;
  /** Field-level validation feedback from Reece (4xx). */
  violations?: ReeceOrderViolation[];
  /** Generic upstream errors (parse, 5xx). */
  errors?: ReeceOrderError[];
}

export interface ReecePlaceOrderResult {
  reeceOrderNumber?: string;
  raw?: any;
  reauthRequired?: boolean;
  notConnected?: boolean;
  /** Which step failed, if either /check or /orders rejected. */
  stage?: 'check' | 'place';
  violations?: ReeceOrderViolation[];
  errors?: ReeceOrderError[];
}

export async function listReeceBranches(): Promise<{
  branches: ReeceBranch[];
  reauthRequired?: boolean;
  notConnected?: boolean;
}> {
  try {
    const response = await authedFetch('reeceListBranches', { method: 'GET' });
    if (!response.ok) return { branches: [] };
    const data = await response.json();
    if (data.error === 'reece_reauth_required') return { branches: [], reauthRequired: true };
    if (data.error === 'reece_not_connected') return { branches: [], notConnected: true };
    return { branches: data.branches || [] };
  } catch {
    return { branches: [] };
  }
}

function decodeOrderResponse(data: any): {
  violations?: ReeceOrderViolation[];
  errors?: ReeceOrderError[];
  reauthRequired?: boolean;
  notConnected?: boolean;
} {
  const out: ReturnType<typeof decodeOrderResponse> = {};
  if (data?.error === 'reece_reauth_required') out.reauthRequired = true;
  if (data?.error === 'reece_not_connected') out.notConnected = true;
  if (Array.isArray(data?.violations) && data.violations.length > 0) out.violations = data.violations;
  if (Array.isArray(data?.errors) && data.errors.length > 0) out.errors = data.errors;
  return out;
}

export async function previewReeceOrder(
  request: ReeceOrderRequestInput,
): Promise<ReeceOrderPreviewResult> {
  try {
    const response = await authedFetch('reeceOrderPreview', { body: request });
    if (!response.ok) {
      return { preview: null, errors: [{ url: 'reeceOrderPreview', message: `Request failed (${response.status})` }] };
    }
    const data = await response.json();
    return { preview: data.preview ?? null, ...decodeOrderResponse(data) };
  } catch (e: any) {
    return { preview: null, errors: [{ url: 'reeceOrderPreview', message: e?.message || 'Network error' }] };
  }
}

export async function placeReeceOrder(
  request: ReeceOrderRequestInput & { quoteId?: string },
): Promise<ReecePlaceOrderResult> {
  try {
    const response = await authedFetch('reeceOrderPlace', { body: request });
    if (!response.ok) {
      return { errors: [{ url: 'reeceOrderPlace', message: `Request failed (${response.status})` }] };
    }
    const data = await response.json();
    return {
      reeceOrderNumber: data.order?.reeceOrderNumber,
      raw: data.order?.raw,
      stage: data.stage,
      ...decodeOrderResponse(data),
    };
  } catch (e: any) {
    return { errors: [{ url: 'reeceOrderPlace', message: e?.message || 'Network error' }] };
  }
}
