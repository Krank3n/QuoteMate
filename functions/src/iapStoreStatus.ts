/**
 * Ask the stores whether a subscription is still live.
 *
 * Neither App Store Server Notifications nor Play RTDN are wired up, so the
 * only way the backend learns about a renewal is the phone re-posting its
 * receipt on launch. The nightly expiry sweep used to cut a sub off three days
 * after its recorded period end without asking anyone — which locked a paying
 * Play subscriber out for five days in Sep 2026 because they simply hadn't
 * opened the app after the renewal. Both lookups here answer with a
 * StoreStatus the sweep (and the Play receipt endpoint) can act on:
 *
 *   valid        — the store knows the sub; expiryDate is its own view
 *   invalid      — the store says lapsed / revoked / no such purchase
 *   unavailable  — we could not get an answer (config, network, 5xx)
 *
 * 'unavailable' is never a verdict on the buyer — callers must fail safe.
 */
import { AppStoreServerAPIClient, Environment, Status } from '@apple/app-store-server-library';
import { APPLE_BUNDLE_ID, verifyAppleJws } from './appleJws.helpers';
import type { StoreStatus } from './receiptValidation.helpers';

// ---------------------------------------------------------------------------
// Google Play
// ---------------------------------------------------------------------------

export type GooglePlayLookup = {
  productId: string;
  purchaseToken: string;
  /** For log lines only. */
  userId?: string;
};

type GoogleDeps = {
  fetch: typeof fetch;
  serviceAccountJson: string | undefined;
  packageName: string;
  getAccessToken: (serviceAccount: { client_email: string; private_key: string }) => Promise<string | null | undefined>;
};

async function defaultGoogleAccessToken(serviceAccount: { client_email: string; private_key: string }) {
  // REST via google-auth-library rather than `googleapis` — that package was
  // never a dependency of functions/, so it threw MODULE_NOT_FOUND the moment
  // a service account was configured.
  const { JWT } = require('google-auth-library');
  const authClient = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const { token } = await authClient.getAccessToken();
  return token;
}

function defaultGoogleDeps(): GoogleDeps {
  return {
    fetch: globalThis.fetch,
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    packageName: process.env.GOOGLE_PACKAGE_NAME || 'com.quotemate.app',
    getAccessToken: defaultGoogleAccessToken,
  };
}

/**
 * purchases.subscriptions.get — Play's view of one subscription token.
 * Prices come back too: Play reports what THIS subscriber is billed, which is
 * not the current SKU price for anyone grandfathered on an older one.
 */
export async function fetchGooglePlaySubscription(
  lookup: GooglePlayLookup,
  deps: Partial<GoogleDeps> = {},
): Promise<StoreStatus> {
  const d = { ...defaultGoogleDeps(), ...deps };
  const { productId, purchaseToken, userId } = lookup;
  if (!d.serviceAccountJson) return { outcome: 'unavailable', expiryDate: null, detail: 'no_service_account' };
  if (!purchaseToken) return { outcome: 'unavailable', expiryDate: null, detail: 'no_purchase_token' };

  try {
    const serviceAccount = JSON.parse(d.serviceAccountJson);
    const accessToken = await d.getAccessToken(serviceAccount);
    const url = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
      `${encodeURIComponent(d.packageName)}/purchases/subscriptions/` +
      `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
    const res = await d.fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (res.ok) {
      const data = await res.json() as any;
      const priceMicros = Number(data?.priceAmountMicros);
      const currency = data?.priceCurrencyCode || null;
      const expiryTimeMs = parseInt(data?.expiryTimeMillis || '0', 10);
      const expiryDate = expiryTimeMs > 0 ? new Date(expiryTimeMs) : null;
      // A past expiry is Google confirming the sub has lapsed.
      const live = expiryTimeMs > Date.now();
      return {
        outcome: live ? 'valid' : 'invalid',
        expiryDate,
        priceMicros: Number.isFinite(priceMicros) ? priceMicros : null,
        currency,
        detail: live ? 'live' : 'lapsed',
      };
    }

    // 401/403 mean OUR service account lacks Play Console access — a config
    // fault, not a verdict on the buyer's purchase. 5xx is Google's problem.
    // Only a true 4xx about the token itself (400/404/410) is a rejection.
    const unavailable = res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500;
    const body = (await res.text().catch(() => '')).slice(0, 300);
    console.warn('[receipts] Google subscriptions.get failed', {
      userId, httpStatus: res.status, outcome: unavailable ? 'unavailable' : 'invalid', body,
    });
    return { outcome: unavailable ? 'unavailable' : 'invalid', expiryDate: null, detail: `http_${res.status}` };
  } catch (err) {
    // Network/JWT failure — never a verdict on the purchase.
    console.warn('[receipts] Google validation threw', { userId, error: String(err) });
    return { outcome: 'unavailable', expiryDate: null, detail: `threw:${String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Apple App Store
// ---------------------------------------------------------------------------

export type AppleLookup = {
  /** Any transaction id of the subscription — original or a renewal. */
  transactionId: string;
  /** 'Production' | 'Sandbox' as stored on the doc; anything else → Production. */
  environment?: string | null;
  userId?: string;
};

/** The slice of AppStoreServerAPIClient we use, so tests can hand in a fake. */
export type AppleStatusClient = Pick<AppStoreServerAPIClient, 'getAllSubscriptionStatuses'>;

type AppleDeps = {
  makeClient: (environment: Environment) => AppleStatusClient | null;
  decodeTransaction: typeof verifyAppleJws;
  now: () => number;
};

function defaultAppleClient(environment: Environment): AppleStatusClient | null {
  const keyId = process.env.ASC_KEY_ID;
  const issuerId = process.env.ASC_ISSUER_ID;
  const privateKey = (process.env.ASC_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!keyId || !issuerId || !privateKey) return null;
  return new AppStoreServerAPIClient(privateKey, keyId, issuerId, APPLE_BUNDLE_ID, environment);
}

function defaultAppleDeps(): AppleDeps {
  return { makeClient: defaultAppleClient, decodeTransaction: verifyAppleJws, now: () => Date.now() };
}

/** Apple statuses under which the subscriber still has access. */
const APPLE_LIVE_STATUSES = new Set<number>([Status.ACTIVE, Status.BILLING_GRACE_PERIOD]);

/**
 * Get All Subscription Statuses — Apple's current view, renewals included.
 * The stored JWS is a snapshot of the ORIGINAL purchase and cannot tell us
 * about a renewal, so this is the only way to learn one happened.
 */
export async function fetchAppleSubscriptionStatus(
  lookup: AppleLookup,
  deps: Partial<AppleDeps> = {},
): Promise<StoreStatus> {
  const d = { ...defaultAppleDeps(), ...deps };
  const { transactionId, userId } = lookup;
  if (!transactionId) return { outcome: 'unavailable', expiryDate: null, detail: 'no_transaction_id' };
  const environment = (lookup.environment || '').toLowerCase() === 'sandbox' ? Environment.SANDBOX : Environment.PRODUCTION;

  let client: AppleStatusClient | null;
  try {
    client = d.makeClient(environment);
  } catch (err) {
    return { outcome: 'unavailable', expiryDate: null, detail: `client_init_failed:${String(err)}` };
  }
  if (!client) return { outcome: 'unavailable', expiryDate: null, detail: 'no_asc_key' };

  let response: Awaited<ReturnType<AppleStatusClient['getAllSubscriptionStatuses']>>;
  try {
    response = await client.getAllSubscriptionStatuses(transactionId);
  } catch (err: any) {
    // APIException carries the HTTP status. 401/403 = our key lacks the
    // In-App Purchase role; 404 = Apple doesn't know the id in THIS
    // environment (sandbox/production mix-up is far likelier than a vanished
    // sale); 429/5xx = come back later. None of these are a verdict.
    const httpStatus = typeof err?.httpStatusCode === 'number' ? err.httpStatusCode : null;
    console.warn('[receipts] Apple subscription status lookup failed', { userId, httpStatus, error: String(err?.errorMessage || err) });
    return { outcome: 'unavailable', expiryDate: null, detail: httpStatus ? `http_${httpStatus}` : `threw:${String(err)}` };
  }

  const items = (response?.data || []).flatMap((group) => group.lastTransactions || []);
  if (items.length === 0) return { outcome: 'invalid', expiryDate: null, detail: 'no_transactions' };

  // A subscriber can hold several subs in the group over time (monthly →
  // yearly). Any live one keeps them Pro; report the latest expiry we can read.
  let live = false;
  let latestExpiry: Date | null = null;
  for (const item of items) {
    const status = typeof item.status === 'number' ? item.status : -1;
    if (!APPLE_LIVE_STATUSES.has(status)) continue;
    live = true;
    if (item.signedTransactionInfo) {
      const decoded = await d.decodeTransaction(item.signedTransactionInfo);
      if (decoded.expiryDate && (!latestExpiry || decoded.expiryDate.getTime() > latestExpiry.getTime())) {
        latestExpiry = decoded.expiryDate;
      }
    }
  }
  if (!live) return { outcome: 'invalid', expiryDate: null, detail: `statuses:${items.map((i) => i.status).join(',')}` };
  if (latestExpiry && latestExpiry.getTime() <= d.now()) {
    // Apple says active but the signed expiry is behind us — trust the
    // status (it is the fresher signal) and let the doc keep its period end.
    return { outcome: 'valid', expiryDate: null, detail: 'active_without_future_expiry' };
  }
  return { outcome: 'valid', expiryDate: latestExpiry, detail: 'live' };
}
