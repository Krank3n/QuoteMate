/**
 * The fastest way to record a payment in this app is the payment chip: two
 * taps from the jobs list to a pre-filled Record Payment screen. It shipped
 * looking like the inert status pills either side of it — muted grey text on
 * a pressed-surface background — and a paying tradie went looking for the
 * feature, didn't find it, and told us the app couldn't do it.
 *
 * These pin the two halves of the fix: the chip only dresses as a door where
 * money is genuinely owed, and it says something different from the stage
 * chip it sits next to.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: any) => o.android },
}));
vi.mock('react-native-paper', () => ({ Text: () => null }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../theme', () => ({ makeStyles: () => () => ({}), useThemeColors: () => ({}) }));
vi.mock('../utils/haptics', () => ({ selectionTap: () => {} }));

import { derivePaymentState, paymentChipRoute } from './PaymentChip';

const invoice = (over: Record<string, any> = {}): any => ({
  id: 'inv1', type: 'invoice', stage: 'invoice_sent',
  total: 972.4, paidTotal: 0, ...over,
});

/** Mirrors the component: a chip is dressed as an action only when it has a
 *  handler AND the document still owes money. */
const isActionable = (doc: any, hasHandler: boolean) => {
  const state = derivePaymentState(doc);
  return hasHandler && (state === 'unpaid' || state === 'partially_paid');
};

describe('payment chip affordance', () => {
  it('dresses as a door on an unpaid invoice', () => {
    expect(isActionable(invoice(), true)).toBe(true);
  });

  it('dresses as a door on a part-paid invoice — the balance is still owed', () => {
    expect(isActionable(invoice({ stage: 'partially_paid', paidTotal: 400 }), true)).toBe(true);
  });

  it('stays a plain label on a settled invoice — a receipt, not an invitation', () => {
    expect(isActionable(invoice({ stage: 'paid', paidTotal: 972.4 }), true)).toBe(false);
  });

  it('stays a plain label wherever there is no handler to tap through to', () => {
    // Read-only surfaces pass no onPress. Colouring those as actions would
    // promise a door that isn't there.
    expect(isActionable(invoice(), false)).toBe(false);
    expect(isActionable(invoice({ stage: 'partially_paid', paidTotal: 400 }), false)).toBe(false);
  });
});

describe('paymentChipRoute (job screen chip)', () => {
  it('sends an unpaid invoice straight to Record Payment', () => {
    expect(paymentChipRoute(invoice())).toBe('record');
  });

  it('opens the payment history on a part-paid invoice, where a payment can be fixed', () => {
    // The case that prompted this: $3,000 recorded on a $9,850.40 invoice, and no
    // way to reach that entry while the balance was owing.
    expect(paymentChipRoute(invoice({ total: 9850.40, paidTotal: 3000 }))).toBe('history');
  });

  it('opens the payment history on a paid invoice', () => {
    expect(paymentChipRoute(invoice({ paidTotal: 972.4 }))).toBe('history');
  });

  it('sends a quote with a deposit owing to the take-payment sheet', () => {
    expect(paymentChipRoute(invoice({ type: 'quote', stage: 'quote_sent' }))).toBe('takePayment');
  });

  it('opens the history for a zero-total doc rather than a form with nothing to collect', () => {
    expect(paymentChipRoute(invoice({ total: 0 }))).toBe('history');
  });
});
