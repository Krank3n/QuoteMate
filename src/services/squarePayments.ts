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
  ReaderInternalStatus,
  getReaders,
  setReaderChangedCallback,
  type ReaderInfo,
  type PaymentParameters,
  type PromptParameters,
  type Payment,
} from 'mobile-payments-sdk-react-native';
import { Platform, PermissionsAndroid } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';

import * as squareService from './squareService';
import { presentTapToPayEducation } from '../../modules/tap-to-pay-education';

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
 * Square's SDK will not take an in-person payment without location permission,
 * on either platform — it is a card-network requirement, not a Square quirk.
 *
 * Both platforms need us to ASK. Square checks the authorisation status and
 * refuses if it is not already granted; it never triggers the prompt itself. On
 * iOS that surfaced as "location settings have not been granted, please request
 * access" — an error message where a permission dialog should have been, with
 * no way forward for the tradie. The Info.plist usage string is present, so iOS
 * was willing to ask all along; nothing was asking it to.
 */
async function ensureLocationPermission(): Promise<void> {
  if (Platform.OS === 'android') {
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
    return;
  }

  if (Platform.OS !== 'ios') return;

  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return;

  // canAskAgain false means iOS will not show the dialog again — a second
  // request would no-op and the tradie would be stuck on the same error
  // forever. Send them to Settings instead of pretending we can ask.
  if (!current.canAskAgain) {
    throw new Error(
      'Location is off for QuoteMate. Turn it on in Settings › Privacy & Security › Location Services to take card payments.'
    );
  }

  const asked = await Location.requestForegroundPermissionsAsync();
  if (!asked.granted) {
    throw new Error(
      'Location permission is required to take card payments. Allow it when prompted, or turn it on in Settings.'
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

  await ensureLocationPermission();
  await ensureAuthorized();
  // iOS only: if the merchant hasn't accepted Apple's Tap to Pay T&Cs yet,
  // pressing the pay button opens that acceptance first — followed by Apple's
  // merchant education on a fresh acceptance — then continues into the
  // payment. Apple reqs 3.5 / 3.7 / 4.2 / 5.3.
  await acceptTapToPayTermsAndEducate();

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
  await ensureLocationPermission();
  await ensureAuthorized();
  // Apple reqs 3.6 / 4.2: Settings is the enablement path outside checkout, so
  // acceptance and education have to happen here too — not only on the
  // in-checkout trigger. Runs before Square's own settings sheet so the two
  // don't fight over the presented view controller.
  await acceptTapToPayTermsAndEducate();
  await showSettings();
}

export type TapToPayReadiness =
  | 'preparing'
  | 'ready'
  | 'unavailable';

/**
 * Apple req 3.9.1: the app must show a configuration progress indicator while
 * Tap to Pay gets itself ready, and must say it isn't usable yet — during both
 * first-time setup and ordinary use while the reader is preparing.
 *
 * Apple names `PaymentCardReader.Event.updateProgress(_:)` "or the equivalent
 * call from your PSP SDK". Square owns the reader session, so we can't run our
 * own PaymentCardReader alongside it; the equivalent is Square's reader-changed
 * stream, where the Tap to Pay virtual reader walks
 * CONNECTING_TO_DEVICE → CONNECTING_TO_SQUARE → READY.
 *
 * Square reports no percentage, only a state, so callers should render an
 * indeterminate indicator with a status line rather than a progress bar —
 * a fake percentage would be worse than none.
 *
 * Returns an unsubscribe function. Safe to call on Android and web: it emits
 * once and unsubscribes cleanly.
 */
export function observeTapToPayReadiness(
  onChange: (readiness: TapToPayReadiness) => void,
): () => void {
  if (Platform.OS !== 'ios') {
    onChange('unavailable');
    return () => {};
  }

  let cancelled = false;
  const emit = (r: TapToPayReadiness) => {
    if (!cancelled) onChange(r);
  };

  const readinessFor = (readers: ReaderInfo[]): TapToPayReadiness => {
    // The Tap to Pay reader is the built-in one; Square models it alongside
    // any paired hardware, so take the best state on offer rather than the
    // first — a faulty Bluetooth reader in the bag must not report the phone
    // itself as unavailable.
    let best: TapToPayReadiness = 'unavailable';
    for (const reader of readers) {
      const status = reader?.status?.status;
      if (status === ReaderInternalStatus.READY) return 'ready';
      if (
        status === ReaderInternalStatus.CONNECTING_TO_DEVICE ||
        status === ReaderInternalStatus.CONNECTING_TO_SQUARE
      ) {
        best = 'preparing';
      }
    }
    return best;
  };

  const refresh = async () => {
    try {
      emit(readinessFor(await getReaders()));
    } catch {
      emit('unavailable');
    }
  };

  void refresh();
  const unsubscribe = setReaderChangedCallback(() => {
    void refresh();
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

/**
 * Whether the merchant had already accepted Apple's Tap to Pay Terms and
 * Conditions. Callers need the distinction because req 4.2 hangs merchant
 * education off a *fresh* acceptance, not off every payment.
 */
export type AppleAccountLinkResult =
  | 'not_applicable'
  | 'already_linked'
  | 'just_linked';

export type TapToPayWarmUpResult =
  | 'warmed'
  | 'skipped_incapable'
  | 'skipped_unlinked'
  | 'failed';

/**
 * Apple req 1.5: prepare / warm up the reader when the app launches and when
 * it returns to the foreground, so req 5.6 (Tap to Pay UI on screen within one
 * second, 90% of the time) is achievable. Square has no explicit `prepare()`
 * — for the Mobile Payments SDK the expensive step is minting a mobile auth
 * code server-side and authorizing the SDK, so doing that ahead of time IS the
 * warm-up. `getAuthorizationState()` short-circuits when a session is already
 * live, so repeated foregrounds are cheap.
 *
 * Deliberately does NOT link the Apple account: linking is how the merchant
 * accepts Apple's T&Cs, and springing that sheet on app launch would both
 * ambush the tradie and defeat req 3.5's "clear action". An unlinked merchant
 * is left cold and warms up on first press instead.
 *
 * Best-effort by contract — never throws. A tradie who isn't connected to
 * Square, or is offline at launch, must not see an error for something they
 * didn't ask for.
 */
export async function warmUpTapToPay(): Promise<TapToPayWarmUpResult> {
  try {
    if (!(await isTapToPayCapable())) return 'skipped_incapable';
    if (Platform.OS === 'ios') {
      const linked = await TapToPaySettings.isAppleAccountLinked();
      if (!linked) return 'skipped_unlinked';
    }
    await ensureAuthorized();
    return 'warmed';
  } catch {
    return 'failed';
  }
}

/**
 * Link the seller's Apple account so Tap to Pay on iPhone can take payments.
 * Linking is how the merchant accepts Apple's Tap to Pay Terms and Conditions,
 * so this is the "clear action to accept the T&Cs" Apple requires (req 3.5),
 * and calling it from the checkout path is the in-checkout enablement trigger
 * (req 3.7) that lets the button stay live instead of greyed out (req 5.3).
 *
 * Errors propagate. A merchant who backs out of Apple's sheet surfaces as a
 * cancel, which callers already swallow; anything else is a real failure the
 * tradie needs to see rather than a silent no-op payment attempt.
 *
 * Resolves false on Android, where there is no Apple account to link.
 *
 * Apple req 1.6: acceptance state is read back from Apple every time rather
 * than cached locally, so a merchant who unlinks on the device is seen
 * immediately.
 */
export async function linkAppleAccountIfNeeded(): Promise<AppleAccountLinkResult> {
  if (Platform.OS !== 'ios') return 'not_applicable';
  const linked = await TapToPaySettings.isAppleAccountLinked();
  if (linked) return 'already_linked';
  await TapToPaySettings.linkAppleAccount();
  return 'just_linked';
}

/**
 * Apple req 4.2: educational screens must be shown *after* the merchant
 * accepts the Terms and Conditions — so acceptance and education are one
 * gesture, not two features that happen to exist.
 *
 * Only fires on a fresh acceptance. A merchant who linked months ago and is
 * mid-checkout does not want Apple's tutorial between them and the customer's
 * card; req 4.3 keeps it reachable from Settings for them instead.
 *
 * Education failure is swallowed by presentTapToPayEducation, so a flaky
 * content fetch can never block a payment the merchant already consented to.
 */
/**
 * Whether the merchant has already accepted Apple's Tap to Pay Terms and
 * Conditions, read from Apple rather than a local flag (Apple req 1.6).
 *
 * Used by the awareness banner (reqs 3.1 / 3.3) to retire itself once the
 * tradie has acted. Fails closed — an unknown answer is treated as "not
 * accepted", which at worst shows a dismissible banner one more time.
 */
export async function isTapToPayTermsAccepted(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return Boolean(await TapToPaySettings.isAppleAccountLinked());
  } catch {
    return false;
  }
}

export async function acceptTapToPayTermsAndEducate(): Promise<AppleAccountLinkResult> {
  const result = await linkAppleAccountIfNeeded();
  if (result === 'just_linked') {
    await presentTapToPayEducation();
  }
  return result;
}

