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
import { Platform } from 'react-native';

import * as squareService from './squareService';

export type InAppPaymentTarget =
  | { kind: 'invoice'; invoiceId: string }
  | { kind: 'quote_deposit'; quoteId: string };

interface TakeInAppPaymentArgs {
  target: InAppPaymentTarget;
  amountCents: number;       // cents
  note?: string;
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
  note,
}: TakeInAppPaymentArgs): Promise<Payment> {
  if (amountCents <= 0) {
    throw new Error('Amount must be greater than zero.');
  }

  await ensureAuthorized();

  const idempotencyKey = `qm-${target.kind}-${
    target.kind === 'invoice' ? target.invoiceId : target.quoteId
  }-${Date.now()}`;

  const paymentParameters: PaymentParameters = {
    amountMoney: { amount: amountCents, currencyCode: CurrencyCode.AUD },
    processingMode: ProcessingMode.ONLINE_ONLY,
    idempotencyKey,
    note,
    referenceId:
      target.kind === 'invoice' ? target.invoiceId : target.quoteId,
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
