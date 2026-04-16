/**
 * Square Mobile Payments SDK wrapper.
 *
 * Composes the native SDK (authorize / startPayment / TapToPaySettings) with
 * our backend helpers (getMobileAuthCode → access token; recordInAppPayment →
 * webhook reconciliation). All callers should go through `takeInAppPayment`
 * below; it handles auth state, idempotency, and result reconciliation.
 *
 * Native init lives in the withSquareSDK config plugin — by the time JS
 * runs, the SDK is already initialized with the production application ID.
 */

import {
  authorize,
  getAuthorizationState,
  showSettings,
  startPayment,
  AuthorizationState,
  AdditionalPaymentMethodType,
  CurrencyCode,
  PromptMode,
  ProcessingMode,
  TapToPaySettings,
  type PaymentParameters,
  type PromptParameters,
  type Payment,
} from 'mobile-payments-sdk-react-native';
import { Platform, PermissionsAndroid } from 'react-native';
import * as Crypto from 'expo-crypto';

import * as squareService from './squareService';

export type InAppPaymentTarget =
  | { kind: 'invoice'; invoiceId: string }
  | { kind: 'quote_deposit'; quoteId: string };

interface TakeInAppPaymentArgs {
  target: InAppPaymentTarget;
  amountCents: number;       // cents — final amount charged to the customer (incl. any passthrough surcharge)
  /**
   * QuoteMate platform fee in cents, deducted from the tradie's payout via
   * Square's appFeeMoney mechanism. Callers should compute this from the
   * charged amount using QM_APP_FEE_PCT_IN_PERSON in shared/pdf/squareFees.ts
   * so server + client stay in lockstep.
   */
  appFeeCents: number;
  note?: string;
  /**
   * Forwarded to the server. Used only when the target doc has no terms of
   * its own — the server snapshots these onto the doc so the webhook can
   * stamp a proper acceptance record. See recordInAppPayment.fallbackTerms.
   */
  fallbackTerms?: string;
}

/**
 * Square's Android SDK refuses to pair a reader (even the virtual Tap to Pay
 * one) without runtime-granted fine location permission. iOS handles this
 * via the Info.plist usage string + system prompt on first use. Call this
 * before `authorize()` on Android or the SDK throws `payment_no_permission_location`.
 */
async function ensureAndroidLocationPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Location permission required',
      message:
        'Square requires location access to process in-person card payments.',
      buttonPositive: 'Allow',
      buttonNegative: 'Cancel',
    }
  );
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error(
      'Location permission is required to take card payments. Enable it in system settings and try again.'
    );
  }
}

/**
 * Ensure the SDK has a valid authorized session. If already authorized we
 * skip the round-trip; otherwise we mint a fresh mobile auth code on the
 * server and authorize the SDK with it.
 */
async function ensureAuthorized(): Promise<void> {
  const state = await getAuthorizationState();
  if (state === AuthorizationState.AUTHORIZED) return;

  const { authorizationCode, locationId } = await squareService.getMobileAuthCode();
  if (!authorizationCode || !locationId) {
    throw new Error('Square is not connected. Reconnect from Settings.');
  }
  await authorize(authorizationCode, locationId);
}

/**
 * Take an in-app card payment (Tap to Pay or manual entry). Square presents
 * its own payment UI; this Promise resolves once the native flow completes.
 *
 * On success we record the payment server-side so the existing Square
 * webhook flips invoice/quote status when `payment.updated` fires — the
 * webhook is the source of truth, this call just primes the orderId index.
 */
export async function takeInAppPayment({
  target,
  amountCents,
  appFeeCents,
  note,
  fallbackTerms,
}: TakeInAppPaymentArgs): Promise<Payment> {
  if (amountCents <= 0) {
    throw new Error('Amount must be greater than zero.');
  }
  if (appFeeCents < 0 || appFeeCents >= amountCents) {
    // Defence in depth — Square rejects these anyway, surface a clear error.
    throw new Error('Invalid app fee amount.');
  }

  await ensureAndroidLocationPermission();
  await ensureAuthorized();

  const targetId =
    target.kind === 'invoice' ? target.invoiceId : target.quoteId;
  const idempotencyKey = `qm-${target.kind}-${targetId}-${Date.now()}`;
  // Square's Android SDK rejects payments without a paymentAttemptId. It's
  // marked optional in the TS types but required at runtime; use a UUID per
  // attempt so retries get fresh IDs (idempotencyKey handles dedupe).
  const paymentAttemptId = Crypto.randomUUID();

  const paymentParameters: PaymentParameters = {
    amountMoney: { amount: amountCents, currencyCode: CurrencyCode.AUD },
    // QuoteMate platform fee routed to our Square developer account. The
    // passthrough surcharge (if any) is baked into amountCents upstream, so
    // Square's own allowCardSurcharge prompt stays off.
    appFeeMoney: { amount: appFeeCents, currencyCode: CurrencyCode.AUD },
    processingMode: ProcessingMode.ONLINE_ONLY,
    idempotencyKey,
    paymentAttemptId,
    allowCardSurcharge: false,
    note,
    referenceId: targetId,
  };

  const promptParameters: PromptParameters = {
    additionalMethods: [AdditionalPaymentMethodType.ALL],
    mode: PromptMode.DEFAULT,
  };

  const payment = await startPayment(paymentParameters, promptParameters);

  // Best-effort: prime the webhook index. Failure here just delays
  // reconciliation until the webhook arrives — we don't block the UX.
  try {
    await squareService.recordInAppPayment({
      kind: target.kind,
      targetId:
        target.kind === 'invoice' ? target.invoiceId : target.quoteId,
      paymentId: String(payment.id),
      orderId: String(payment.orderId),
      amountCents: Number(payment.totalMoney?.amount) || amountCents,
      fallbackTerms,
    });
  } catch (err) {
    console.warn('[squarePayments] recordInAppPayment failed', err);
  }

  return payment;
}

/**
 * Whether the current device + OS is capable of Tap to Pay. iOS additionally
 * requires the Apple account to be linked; Android assumes contactless-capable
 * hardware (NFC). Callers should AND this with a remote feature flag while
 * Apple's Tap-to-Pay entitlement is still pending.
 */
export async function isTapToPayCapable(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    try {
      const capable = await TapToPaySettings.isDeviceCapable();
      return Boolean(capable);
    } catch {
      return false;
    }
  }
  // Android: Square's SDK checks NFC + reader capability internally at
  // startPayment time. Treat all Android devices as eligible at the UI layer.
  return Platform.OS === 'android';
}

/**
 * Trigger Square's built-in reader-setup UI so the tradie can complete the
 * one-time Tap-to-Pay activation during onboarding (instead of in front of
 * a paying customer). Ensures location permission + SDK authorization first.
 *
 * The SDK's settings sheet shows a Tap-to-Pay reader that needs to be
 * "paired" — for the phone's built-in NFC, this pair step is the one-time
 * Google secure-element handshake. Unskippable per payment-network rules.
 */
export async function primeTapToPayOnDevice(): Promise<void> {
  await ensureAndroidLocationPermission();
  await ensureAuthorized();
  await showSettings();
}

/**
 * Link the seller's Apple account so Tap to Pay on iPhone can take payments.
 * No-op (and resolves false) on Android.
 */
export async function linkAppleAccountIfNeeded(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const linked = await TapToPaySettings.isAppleAccountLinked();
    if (linked) return true;
    await TapToPaySettings.linkAppleAccount();
    return true;
  } catch (err) {
    console.warn('[squarePayments] linkAppleAccount failed', err);
    return false;
  }
}
