// @vitest-environment jsdom
/**
 * Apple's Tap to Pay on iPhone review requirements land on two seams in
 * squarePayments:
 *
 *  - req 1.5  warm the reader at launch / foreground so req 5.6's one-second
 *             open is achievable
 *  - req 3.5  accepting Apple's Terms and Conditions is a clear, deliberate
 *             action — and linking the merchant's Apple account IS that
 *             acceptance
 *  - req 3.7  pressing the pay button in checkout is a valid trigger for that
 *             acceptance, which is what lets req 5.3 keep the button live
 *
 * The warm-up must never force the T&C sheet: that would ambush the tradie at
 * app launch and defeat 3.5's "clear action".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  authorizationState: 'NOT_AUTHORIZED' as string,
  appleAccountLinked: false,
  deviceCapable: true,
  readers: [] as any[],
  readerListener: null as null | (() => void),
  authorize: vi.fn(async (_code: string, _loc: string) => {}),
  linkAppleAccount: vi.fn(async () => {}),
  startPayment: vi.fn(async () => ({
    id: 'pay_1',
    orderId: 'ord_1',
    totalMoney: { amount: 1000 },
  })),
  getReaders: vi.fn(async () => sdk.readers),
  unsubscribe: vi.fn(),
}));

const education = vi.hoisted(() => ({
  present: vi.fn(async () => ({ shown: true })),
}));
vi.mock('../../../modules/tap-to-pay-education', () => ({
  presentTapToPayEducation: education.present,
  isTapToPayEducationAvailable: () => true,
}));

vi.mock('mobile-payments-sdk-react-native', () => ({
  AuthorizationState: { AUTHORIZED: 'AUTHORIZED', NOT_AUTHORIZED: 'NOT_AUTHORIZED' },
  AdditionalPaymentMethodType: { ALL: 'ALL' },
  CurrencyCode: { AUD: 'AUD' },
  PromptMode: { DEFAULT: 'DEFAULT' },
  ProcessingMode: { ONLINE_ONLY: 'ONLINE_ONLY' },
  TapToPaySettings: {
    isDeviceCapable: async () => sdk.deviceCapable,
    isAppleAccountLinked: async () => sdk.appleAccountLinked,
    linkAppleAccount: sdk.linkAppleAccount,
  },
  getAuthorizationState: async () => sdk.authorizationState,
  authorize: sdk.authorize,
  showSettings: vi.fn(async () => {}),
  startPayment: sdk.startPayment,
  getReaders: sdk.getReaders,
  setReaderChangedCallback: (cb: () => void) => {
    sdk.readerListener = cb;
    return sdk.unsubscribe;
  },
  ReaderInternalStatus: {
    CONNECTING_TO_DEVICE: 'CONNECTING_TO_DEVICE',
    CONNECTING_TO_SQUARE: 'CONNECTING_TO_SQUARE',
    READER_UNAVAILABLE: 'READER_UNAVAILABLE',
    FAULTY: 'FAULTY',
    READY: 'READY',
  },
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

// Square refuses an in-person payment without location permission and never
// prompts for it itself, so the app has to. See ensureLocationPermission.
const location = vi.hoisted(() => ({
  granted: true,
  canAskAgain: true,
  askGrants: true,
  requestCalls: 0,
}));
vi.mock('expo-location', () => ({
  getForegroundPermissionsAsync: vi.fn(async () => ({
    granted: location.granted,
    canAskAgain: location.canAskAgain,
  })),
  requestForegroundPermissionsAsync: vi.fn(async () => {
    location.requestCalls += 1;
    return { granted: location.askGrants, canAskAgain: location.canAskAgain };
  }),
}));

const squareService = vi.hoisted(() => ({
  getMobileAuthCode: vi.fn(async () => ({
    authorizationCode: 'code_1',
    locationId: 'loc_1',
  })),
  recordInAppPayment: vi.fn(async () => {}),
}));
vi.mock('../squareService', () => squareService);

// Mutable so req 1.4's OS floor can be exercised on both sides of the line
// without a second mock factory.
const platform = vi.hoisted(() => ({
  os: 'ios' as string,
  version: '18.6.2' as string | number,
}));

// The service branches on Platform.OS; react-native-web reports 'web', which
// would skip every iOS-only path under test.
vi.mock('react-native', async () => {
  const actual = await vi.importActual<any>('react-native');
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return platform.os;
      },
      get Version() {
        return platform.version;
      },
    },
    PermissionsAndroid: {
      request: vi.fn(async () => 'granted'),
      PERMISSIONS: { ACCESS_FINE_LOCATION: 'loc' },
      RESULTS: { GRANTED: 'granted' },
    },
  };
});

import {
  warmUpTapToPay,
  linkAppleAccountIfNeeded,
  acceptTapToPayTermsAndEducate,
  observeTapToPayReadiness,
  takeInAppPayment,
} from '../squarePayments';

beforeEach(() => {
  vi.clearAllMocks();
  sdk.authorizationState = 'NOT_AUTHORIZED';
  sdk.appleAccountLinked = false;
  sdk.deviceCapable = true;
  sdk.readers = [];
  sdk.readerListener = null;
  education.present.mockResolvedValue({ shown: true } as any);
  squareService.getMobileAuthCode.mockResolvedValue({
    authorizationCode: 'code_1',
    locationId: 'loc_1',
  });
});

describe('warmUpTapToPay — Apple req 1.5', () => {
  it('authorizes ahead of time for a linked merchant on a capable device', async () => {
    sdk.appleAccountLinked = true;

    await expect(warmUpTapToPay()).resolves.toBe('warmed');
    expect(sdk.authorize).toHaveBeenCalledWith('code_1', 'loc_1');
  });

  it('never springs the T&C sheet on an unlinked merchant — that is req 3.5\'s job', async () => {
    sdk.appleAccountLinked = false;

    await expect(warmUpTapToPay()).resolves.toBe('skipped_unlinked');
    expect(sdk.linkAppleAccount).not.toHaveBeenCalled();
    expect(sdk.authorize).not.toHaveBeenCalled();
  });

  it('skips an incapable device without touching the network', async () => {
    sdk.deviceCapable = false;

    await expect(warmUpTapToPay()).resolves.toBe('skipped_incapable');
    expect(squareService.getMobileAuthCode).not.toHaveBeenCalled();
  });

  it('swallows a failure — the tradie never asked for this', async () => {
    sdk.appleAccountLinked = true;
    squareService.getMobileAuthCode.mockRejectedValueOnce(new Error('offline'));

    await expect(warmUpTapToPay()).resolves.toBe('failed');
  });

  it('does not re-mint an auth code when a session is already live', async () => {
    sdk.appleAccountLinked = true;
    sdk.authorizationState = 'AUTHORIZED';

    await expect(warmUpTapToPay()).resolves.toBe('warmed');
    expect(squareService.getMobileAuthCode).not.toHaveBeenCalled();
  });
});

describe('linkAppleAccountIfNeeded — Apple req 3.5', () => {
  it('links an unlinked merchant, which is how they accept Apple\'s T&Cs', async () => {
    sdk.appleAccountLinked = false;

    await expect(linkAppleAccountIfNeeded()).resolves.toBe('just_linked');
    expect(sdk.linkAppleAccount).toHaveBeenCalled();
  });

  it('does not re-prompt a merchant who has already accepted', async () => {
    sdk.appleAccountLinked = true;

    await expect(linkAppleAccountIfNeeded()).resolves.toBe('already_linked');
    expect(sdk.linkAppleAccount).not.toHaveBeenCalled();
  });

  it('propagates a backed-out sheet instead of failing silently', async () => {
    sdk.appleAccountLinked = false;
    sdk.linkAppleAccount.mockRejectedValueOnce(new Error('user cancelled'));

    await expect(linkAppleAccountIfNeeded()).rejects.toThrow(/cancel/i);
  });
});

describe('takeInAppPayment — Apple reqs 3.7 / 5.3', () => {
  const args = {
    target: { kind: 'invoice' as const, invoiceId: 'inv-1' },
    amountCents: 1000,
    appFeeCents: 15,
  };

  it('opens T&C acceptance before the payment sheet for an unlinked merchant', async () => {
    sdk.appleAccountLinked = false;

    await takeInAppPayment(args);

    expect(sdk.linkAppleAccount).toHaveBeenCalled();
    // Acceptance has to come first, or Square's sheet appears over it.
    const linkOrder = sdk.linkAppleAccount.mock.invocationCallOrder[0];
    const payOrder = sdk.startPayment.mock.invocationCallOrder[0];
    expect(linkOrder).toBeLessThan(payOrder);
  });

  it('goes straight to payment when the merchant has already accepted', async () => {
    sdk.appleAccountLinked = true;

    await takeInAppPayment(args);

    expect(sdk.linkAppleAccount).not.toHaveBeenCalled();
    expect(sdk.startPayment).toHaveBeenCalled();
  });

  it('does not charge when the merchant backs out of the T&C sheet', async () => {
    sdk.appleAccountLinked = false;
    sdk.linkAppleAccount.mockRejectedValueOnce(new Error('user cancelled'));

    await expect(takeInAppPayment(args)).rejects.toThrow(/cancel/i);
    expect(sdk.startPayment).not.toHaveBeenCalled();
  });
});


describe('acceptTapToPayTermsAndEducate — Apple req 4.2', () => {
  it('shows Apple\'s education immediately after a first acceptance', async () => {
    sdk.appleAccountLinked = false;

    await expect(acceptTapToPayTermsAndEducate()).resolves.toBe('just_linked');
    expect(education.present).toHaveBeenCalledTimes(1);
  });

  it('does not replay the tutorial for a merchant who accepted long ago', async () => {
    sdk.appleAccountLinked = true;

    await expect(acceptTapToPayTermsAndEducate()).resolves.toBe('already_linked');
    expect(education.present).not.toHaveBeenCalled();
  });

  it('still completes when the education content cannot be fetched', async () => {
    sdk.appleAccountLinked = false;
    education.present.mockResolvedValueOnce({ shown: false, reason: 'offline' } as any);

    await expect(acceptTapToPayTermsAndEducate()).resolves.toBe('just_linked');
  });

  it('educates before the payment sheet, not after it', async () => {
    sdk.appleAccountLinked = false;

    await takeInAppPayment({
      target: { kind: 'invoice', invoiceId: 'inv-1' },
      amountCents: 1000,
      appFeeCents: 15,
    });

    expect(education.present).toHaveBeenCalled();
    expect(education.present.mock.invocationCallOrder[0]).toBeLessThan(
      sdk.startPayment.mock.invocationCallOrder[0],
    );
  });
});

describe('observeTapToPayReadiness — Apple req 3.9.1', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('reports preparing while Square is still connecting', async () => {
    sdk.readers = [{ status: { status: 'CONNECTING_TO_SQUARE' } }];
    const seen: string[] = [];

    observeTapToPayReadiness((r) => seen.push(r));
    await flush();

    expect(seen).toContain('preparing');
  });

  it('reports ready once the reader is up', async () => {
    sdk.readers = [{ status: { status: 'READY' } }];
    const seen: string[] = [];

    observeTapToPayReadiness((r) => seen.push(r));
    await flush();

    expect(seen).toContain('ready');
  });

  it('a faulty paired reader does not mask the phone being ready', async () => {
    sdk.readers = [
      { status: { status: 'FAULTY' } },
      { status: { status: 'READY' } },
    ];
    const seen: string[] = [];

    observeTapToPayReadiness((r) => seen.push(r));
    await flush();

    expect(seen[seen.length - 1]).toBe('ready');
  });

  it('re-reads readiness when Square reports a reader change', async () => {
    sdk.readers = [{ status: { status: 'CONNECTING_TO_DEVICE' } }];
    const seen: string[] = [];

    observeTapToPayReadiness((r) => seen.push(r));
    await flush();
    sdk.readers = [{ status: { status: 'READY' } }];
    sdk.readerListener?.();
    await flush();

    expect(seen[seen.length - 1]).toBe('ready');
  });

  it('stops emitting after unsubscribe', async () => {
    sdk.readers = [{ status: { status: 'CONNECTING_TO_DEVICE' } }];
    const seen: string[] = [];

    const stop = observeTapToPayReadiness((r) => seen.push(r));
    await flush();
    const countAtStop = seen.length;

    stop();
    sdk.readers = [{ status: { status: 'READY' } }];
    sdk.readerListener?.();
    await flush();

    expect(seen.length).toBe(countAtStop);
    expect(sdk.unsubscribe).toHaveBeenCalled();
  });

  it('reports unavailable rather than throwing when Square cannot be reached', async () => {
    sdk.getReaders.mockRejectedValueOnce(new Error('sdk down'));
    const seen: string[] = [];

    observeTapToPayReadiness((r) => seen.push(r));
    await flush();

    expect(seen).toContain('unavailable');
  });
});

describe('location permission on iOS', () => {
  beforeEach(() => {
    location.granted = true;
    location.canAskAgain = true;
    location.askGrants = true;
    location.requestCalls = 0;
    sdk.authorizationState = 'AUTHORIZED';
    sdk.appleAccountLinked = true;
  });

  it('asks for location rather than failing with "not granted"', async () => {
    location.granted = false;
    const { takeInAppPayment } = await import('../squarePayments');
    await takeInAppPayment({
      target: { kind: 'invoice', invoiceId: 'inv-1' },
      amountCents: 1000,
      appFeeCents: 10,
    });
    expect(location.requestCalls).toBe(1);
  });

  it('does not re-ask when permission is already granted', async () => {
    const { takeInAppPayment } = await import('../squarePayments');
    await takeInAppPayment({
      target: { kind: 'invoice', invoiceId: 'inv-1' },
      amountCents: 1000,
      appFeeCents: 10,
    });
    expect(location.requestCalls).toBe(0);
  });

  it('points at Settings when iOS will not show the prompt again', async () => {
    location.granted = false;
    location.canAskAgain = false;
    const { takeInAppPayment } = await import('../squarePayments');
    await expect(
      takeInAppPayment({
        target: { kind: 'invoice', invoiceId: 'inv-1' },
        amountCents: 1000,
        appFeeCents: 10,
      }),
    ).rejects.toThrow(/Settings/);
    // Asking again would be a no-op and strand the tradie on the same error.
    expect(location.requestCalls).toBe(0);
  });

  it('explains itself when the tradie declines the prompt', async () => {
    location.granted = false;
    location.askGrants = false;
    const { takeInAppPayment } = await import('../squarePayments');
    await expect(
      takeInAppPayment({
        target: { kind: 'invoice', invoiceId: 'inv-1' },
        amountCents: 1000,
        appFeeCents: 10,
      }),
    ).rejects.toThrow(/Location permission is required/);
  });

  it('never starts a payment without location', async () => {
    location.granted = false;
    location.askGrants = false;
    const { takeInAppPayment } = await import('../squarePayments');
    await takeInAppPayment({
      target: { kind: 'invoice', invoiceId: 'inv-1' },
      amountCents: 1000,
      appFeeCents: 10,
    }).catch(() => {});
    expect(sdk.startPayment).not.toHaveBeenCalled();
  });
});
