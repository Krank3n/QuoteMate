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
  connectedAt?: string | null;
}

interface PriceSearchResult {
  price: number | null;
  productName?: string;
  store?: string;
  itemNumber?: string;
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
 * Composite: search by name then return the matched product's trade price.
 * Surfaces structured `reauthRequired` / `notConnected` flags so the caller
 * can route the user to the right UI without parsing error strings.
 */
export async function searchReeceMaterialPrice(
  materialName: string,
): Promise<PriceSearchResult> {
  try {
    const searchResponse = await authedFetch('searchReeceProduct', {
      body: { productName: materialName },
    });
    if (!searchResponse.ok) return { price: null };
    const searchData = await searchResponse.json();

    if (searchData.error === 'reece_reauth_required') {
      return { price: null, reauthRequired: true };
    }
    if (searchData.error === 'reece_not_connected') {
      return { price: null, notConnected: true };
    }

    const product = searchData.product;
    if (!product) return { price: null };

    const priceResponse = await authedFetch('getReecePrice', {
      body: { itemNumber: product.itemNumber },
    });
    if (!priceResponse.ok) return { price: null };
    const priceData = await priceResponse.json();

    if (priceData.error === 'reece_reauth_required') {
      return { price: null, reauthRequired: true };
    }
    if (priceData.error === 'reece_not_connected') {
      return { price: null, notConnected: true };
    }
    if (priceData.price == null) return { price: null };

    return {
      price: priceData.price,
      productName: product.description,
      store: 'Reece Plumbing',
      itemNumber: product.itemNumber,
    };
  } catch {
    return { price: null };
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
  const data = await response.json();
  if (!response.ok) {
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
  const data = await response.json();
  if (!response.ok) {
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
