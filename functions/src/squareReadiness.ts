/**
 * Can this Square connection actually take a card payment?
 *
 * Square happily mints a hosted checkout link for a seller account that has
 * never finished activation — the link resolves to a page that says "This
 * business is currently not accepting payments". Nothing on our side ever
 * failed, so the tradie ships a dead Pay Now button and only finds out when
 * a customer rings. Found 16 Sep 2026 on a test invoice; a probe of every
 * live connection put three of six in the same state.
 *
 * Square tells us up front. A location's `capabilities` list carries
 * CREDIT_CARD_PROCESSING once the account can charge cards; an unactivated
 * account lists only AUTOMATIC_TRANSFERS. The merchant and location also
 * carry a status and a currency, and a payment request in AUD against an
 * account based elsewhere fails the same way.
 *
 * Pure assessment here; the probe that fetches from Square is injected so
 * the tests need no network.
 */

export type SquareReadinessReason =
  | 'no_card_processing'
  | 'location_inactive'
  | 'merchant_inactive'
  | 'currency_mismatch';

export interface SquarePaymentReadiness {
  ready: boolean;
  reasons: SquareReadinessReason[];
  /** ms epoch of the Square probe this verdict came from. */
  checkedAt: number;
  currency?: string;
  country?: string;
  capabilities?: string[];
}

export interface SquareMerchantLike {
  status?: string;
  currency?: string;
  country?: string;
  main_location_id?: string;
}

export interface SquareLocationLike {
  id?: string;
  status?: string;
  capabilities?: string[];
  currency?: string;
  country?: string;
}

export const SQUARE_CARD_CAPABILITY = 'CREDIT_CARD_PROCESSING';
/** The only currency the mint paths ever charge in. */
export const SQUARE_EXPECTED_CURRENCY = 'AUD';

/** A flagged account is asked again this often, so activation clears itself. */
export const READINESS_RECHECK_NOT_READY_MS = 5 * 60 * 1000;
/** A healthy account is re-confirmed daily; regression is rare. */
export const READINESS_RECHECK_READY_MS = 24 * 60 * 60 * 1000;

/**
 * Verdict from what Square reports. Absent fields never flag: an old API
 * shape that omits `capabilities` must not switch every Pay button off.
 */
export function assessSquareReadiness(
  merchant: SquareMerchantLike | null | undefined,
  location: SquareLocationLike | null | undefined,
  now: number = Date.now(),
): SquarePaymentReadiness {
  const reasons: SquareReadinessReason[] = [];

  if (merchant?.status && merchant.status !== 'ACTIVE') reasons.push('merchant_inactive');
  if (location?.status && location.status !== 'ACTIVE') reasons.push('location_inactive');

  const capabilities = Array.isArray(location?.capabilities) ? location!.capabilities : undefined;
  if (capabilities && !capabilities.includes(SQUARE_CARD_CAPABILITY)) reasons.push('no_card_processing');

  const currency = location?.currency || merchant?.currency;
  if (currency && currency !== SQUARE_EXPECTED_CURRENCY) reasons.push('currency_mismatch');

  const verdict: SquarePaymentReadiness = { ready: reasons.length === 0, reasons, checkedAt: now };
  if (currency) verdict.currency = currency;
  const country = location?.country || merchant?.country;
  if (country) verdict.country = country;
  if (capabilities) verdict.capabilities = capabilities;
  return verdict;
}

/**
 * What to tell the tradie. Plain words, no product vocabulary: Square has
 * not switched card payments on for this account, or the account is not an
 * Australian one. Mirrored on the phone in src/utils/squareReadinessCopy.ts.
 */
export function squareNotReadyMessage(
  readiness: Pick<SquarePaymentReadiness, 'reasons' | 'currency'>,
  merchantName?: string | null,
): string {
  const who = merchantName ? `${merchantName}` : 'this Square account';
  if (readiness.reasons.includes('currency_mismatch')) {
    const cur = readiness.currency ? ` (${readiness.currency})` : '';
    return `${who} isn't set up for Australian dollars${cur}. Connect an Australian Square account to take card payments.`;
  }
  return `Square hasn't switched on card payments for ${who} yet. Finish activating the account at squareup.com (identity and bank details), then try again.`;
}

/** Whether a stored verdict is old enough to ask Square again. */
export function shouldReprobeReadiness(
  stored: SquarePaymentReadiness | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!stored || typeof stored.checkedAt !== 'number') return true;
  const age = now - stored.checkedAt;
  // "Ready" earns the daily cadence only when the location's capabilities
  // were actually observed. A verdict built from a merchant answer alone
  // (locations call failed) is a guess, and a guess is re-checked soon.
  const confirmedReady = stored.ready && Array.isArray(stored.capabilities);
  return age >= (confirmedReady ? READINESS_RECHECK_READY_MS : READINESS_RECHECK_NOT_READY_MS);
}

export interface ReadinessProbeInput {
  apiBase: string;
  accessToken: string;
  merchantId: string;
  /** The location links are minted against. Falls back to the merchant's main location. */
  locationId?: string | null;
  fetchFn?: typeof fetch;
  now?: number;
}

/**
 * Ask Square about the merchant and the mint location. Null when neither
 * call answered, so a Square outage keeps the previous verdict rather than
 * flipping the tradie's Pay button off.
 */
export async function probeSquareReadiness(input: ReadinessProbeInput): Promise<SquarePaymentReadiness | null> {
  const fetchFn = input.fetchFn ?? fetch;
  const headers = { Authorization: `Bearer ${input.accessToken}`, 'Square-Version': '2024-10-17' };

  const getJson = async (path: string): Promise<any | null> => {
    try {
      const resp = await fetchFn(`${input.apiBase}${path}`, { headers });
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  };

  const merchantJson = await getJson(`/v2/merchants/${input.merchantId}`);
  const merchant: SquareMerchantLike | null = merchantJson?.merchant ?? null;

  const locationId = input.locationId || merchant?.main_location_id;
  const locationJson = locationId ? await getJson(`/v2/locations/${locationId}`) : null;
  const location: SquareLocationLike | null = locationJson?.location ?? null;

  if (!merchant && !location) return null;
  return assessSquareReadiness(merchant, location, input.now ?? Date.now());
}
