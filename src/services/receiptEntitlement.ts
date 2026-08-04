import { Platform } from 'react-native';
import { auth } from '../config/firebase';
import { classifyReceiptResponse, ReceiptOutcome } from '../utils/purchaseValidation';
import { billingService } from './billingService';

/**
 * Server-side entitlement for store purchases.
 *
 * Extracted from PaywallScreen so it is no longer the only thing on earth that
 * can turn a paid receipt into Pro. During the Jul-2026 validation outage two
 * buyers were charged and never entitled, and could not recover by reopening
 * the app: the purchase listener lived inside PaywallScreen, so the store's
 * re-delivery was only ever observed while that one screen was mounted. The
 * app told them "it'll finish automatically next time you open the app", which
 * was not true of any code path that existed.
 *
 * recoverPendingPurchases() below is what makes that sentence true. It runs at
 * launch, silently, and finishes what the outage left hanging.
 */

const API_BASE_URL = process.env.API_BASE_URL || 'https://us-central1-hansendev.cloudfunctions.net';

/** Stable identity for a store transaction, for de-duping concurrent handlers. */
export function purchaseKey(purchase: any): string {
  return String(purchase?.transactionId || purchase?.id || purchase?.purchaseToken || '');
}

// PaywallScreen's listener and the launch sweep can observe the same
// transaction. Whoever claims it first validates it; the other leaves it alone
// rather than double-posting and double-finishing.
const inFlight = new Set<string>();

export function claimPurchase(key: string): boolean {
  if (!key || inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function releasePurchase(key: string): void {
  inFlight.delete(key);
}

/**
 * Post a receipt to the platform's validator. Returns 'granted' | 'rejected' |
 * 'retry'; 'retry' means we could not reach a verdict, so the caller must leave
 * the store transaction UNFINISHED for later re-delivery.
 */
export async function validatePurchase(purchase: any): Promise<ReceiptOutcome> {
  const currentUser = auth.currentUser;
  if (!currentUser) return 'retry';

  const endpoint = Platform.OS === 'ios' ? 'validateAppleReceipt' : 'validateGoogleReceipt';
  try {
    const idToken = await currentUser.getIdToken();
    const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        transactionId: purchase.transactionId || purchase.id,
        productId: purchase.productId,
        purchaseToken: purchase.purchaseToken || null,
      }),
    });
    const data = await response.json().catch(() => null);
    return classifyReceiptResponse(response.status, data);
  } catch {
    // Network/parse failure is never a verdict on the buyer's purchase.
    return 'retry';
  }
}

export interface RecoverySummary {
  checked: number;
  granted: number;
  rejected: number;
  retry: number;
}

/**
 * Sweep purchases the stores still consider outstanding and try to entitle
 * them. Silent by design — this runs at launch and must never interrupt a
 * tradie mid-job with a modal about billing.
 *
 * onGranted fires only when the server actually granted, so callers can
 * refresh subscription state without polling.
 */
export async function recoverPendingPurchases(
  opts: { onGranted?: (purchase: any) => Promise<void> | void } = {},
): Promise<RecoverySummary> {
  const summary: RecoverySummary = { checked: 0, granted: 0, rejected: 0, retry: 0 };

  if (Platform.OS === 'web') return summary;
  if (!auth.currentUser) return summary;

  let purchases: any[] = [];
  try {
    await billingService.initialize();
    purchases = await billingService.getRecoverablePurchases();
  } catch {
    return summary;
  }

  for (const purchase of purchases) {
    const key = purchaseKey(purchase);
    if (!claimPurchase(key)) continue;
    try {
      summary.checked += 1;
      const outcome = await validatePurchase(purchase);

      if (outcome === 'granted') {
        summary.granted += 1;
        await billingService.finishTransaction(purchase);
        await opts.onGranted?.(purchase);
      } else if (outcome === 'rejected') {
        // The store affirmatively disowned it — finishing stops the store
        // re-delivering a receipt that will never validate.
        summary.rejected += 1;
        await billingService.finishTransaction(purchase);
      } else {
        // Leave unfinished so the store hands it back next launch.
        summary.retry += 1;
      }
    } catch {
      summary.retry += 1;
    } finally {
      releasePurchase(key);
    }
  }

  return summary;
}
