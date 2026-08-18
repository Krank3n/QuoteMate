/**
 * PaymentChip rendered inside ViewJobScreen only, so the Jobs list could
 * never show who owed money — a tradie had to open each job in turn to
 * find out. The chip now rides the card's meta row.
 *
 * The predicate is the interesting half: with most jobs sitting at Draft,
 * an unconditional chip would stamp "Unpaid" on every row and mean
 * nothing. It's shared with the job screen so one quote can't show
 * "Unpaid" on its detail view and nothing on its card.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({
  View: () => null,
  StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
  Pressable: () => null,
  Linking: {},
  Platform: { OS: 'web', select: (o: any) => o.web },
  Alert: { alert: vi.fn() },
  Animated: { View: () => null, Value: class { interpolate() { return null; } }, loop: () => ({ start() {}, stop() {} }), sequence: () => ({}), timing: () => ({}) },
}));
vi.mock('react-native-paper', () => ({ Text: () => null, Card: () => null }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({}) }));
vi.mock('../store/useStore', () => ({ useStore: () => null }));
vi.mock('../theme', () => ({ makeStyles: () => () => ({}), useThemeColors: () => ({}) }));
vi.mock('../utils/haptics', () => ({ selectionTap: () => {} }));
vi.mock('../utils/openJobPreview', () => ({ openJobPreview: vi.fn() }));
vi.mock('../hooks/useIsAppActive', () => ({ useIsAppActive: () => true }));
vi.mock('./JobStageSheet', () => ({ stageMetaFor: () => ({}) }));
vi.mock('./ShimmerOverlay', () => ({ ShimmerOverlay: () => null }));
// PaymentChip is loaded for real (its own imports are mocked above), so
// canRecordPaymentFor is exercised against the real derivePaymentState —
// stubbing that out would leave the paid/unpaid call untested.

import { derivePaymentState, shouldShowPaymentChip } from './PaymentChip';
import { canRecordPaymentFor, pickStageStatus } from './JobCard';

describe('shouldShowPaymentChip', () => {
  it('shows on an invoice — there is a balance to owe against', () => {
    expect(shouldShowPaymentChip({ type: 'invoice', stage: 'invoice_sent' } as any)).toBe(true);
    expect(shouldShowPaymentChip({ type: 'invoice', stage: 'partially_paid' } as any)).toBe(true);
    expect(shouldShowPaymentChip({ type: 'invoice', stage: 'paid' } as any)).toBe(true);
  });

  it('stays hidden on an unpaid quote so a Draft-heavy list is not stamped "Unpaid" throughout', () => {
    expect(shouldShowPaymentChip({ type: 'quote', stage: 'draft' } as any)).toBe(false);
    expect(shouldShowPaymentChip({ type: 'quote', stage: 'quote_sent' } as any)).toBe(false);
    expect(shouldShowPaymentChip({ type: 'quote', stage: 'quote_accepted' } as any)).toBe(false);
  });

  it('shows on a quote that has taken a deposit — money has actually landed', () => {
    expect(
      shouldShowPaymentChip({ type: 'quote', stage: 'quote_accepted', paidTotal: 500 } as any),
    ).toBe(true);
  });

  // The chip is the way into TakePaymentSheet when StickyJobActionBar
  // isn't offering "Take Deposit" — it only does when a deposit amount is
  // configured, and never on iOS. Hiding it here would strand the
  // pay-link route on a quote that is genuinely owed money.
  it('shows on a quote with an outstanding deposit, so the deposit route survives', () => {
    expect(
      shouldShowPaymentChip({
        type: 'quote',
        stage: 'quote_sent',
        depositAmount: 500,
        depositPaid: 0,
      } as any),
    ).toBe(true);
  });

  it('shows while a deposit is only part-paid', () => {
    expect(
      shouldShowPaymentChip({
        type: 'quote',
        stage: 'quote_sent',
        depositAmount: 500,
        depositPaid: 200,
      } as any),
    ).toBe(true);
  });

  it('stays hidden once the deposit is settled and nothing else is owed', () => {
    expect(
      shouldShowPaymentChip({
        type: 'quote',
        stage: 'quote_accepted',
        depositAmount: 500,
        depositPaid: 500,
        paidTotal: 0,
      } as any),
    ).toBe(false);
  });

  it('ignores a zero or absent deposit amount', () => {
    expect(
      shouldShowPaymentChip({ type: 'quote', stage: 'quote_sent', depositAmount: 0 } as any),
    ).toBe(false);
    expect(
      shouldShowPaymentChip({ type: 'quote', stage: 'quote_sent', depositAmount: undefined } as any),
    ).toBe(false);
  });

  it('stays hidden on a cancelled doc, whose balance is not owed', () => {
    expect(shouldShowPaymentChip({ type: 'invoice', stage: 'cancelled' } as any)).toBe(false);
    expect(
      shouldShowPaymentChip({ type: 'invoice', stage: 'cancelled', paidTotal: 500 } as any),
    ).toBe(false);
  });

  it('stays hidden when the job has no document at all', () => {
    expect(shouldShowPaymentChip(undefined)).toBe(false);
    expect(shouldShowPaymentChip(null)).toBe(false);
  });

  it('treats a zero or junk paidTotal on a quote as no payment', () => {
    expect(shouldShowPaymentChip({ type: 'quote', stage: 'draft', paidTotal: 0 } as any)).toBe(false);
    expect(
      shouldShowPaymentChip({ type: 'quote', stage: 'draft', paidTotal: undefined } as any),
    ).toBe(false);
    expect(
      shouldShowPaymentChip({ type: 'quote', stage: 'draft', paidTotal: 'abc' } as any),
    ).toBe(false);
  });

  /**
   * A cash job is never invoiced and never touches the ledger, so the Job
   * stage is the only record that the money came in — and now that the
   * timeline rail talks about work alone, this chip is the last place on
   * the card that can say so.
   */
  describe('a cash job whose only record of payment is the Job stage', () => {
    const cashJob = { type: 'quote', stage: 'quote_accepted', total: 6351.54, paidTotal: 0 } as any;

    it('shows the chip once the job itself reads paid', () => {
      expect(shouldShowPaymentChip(cashJob)).toBe(false);
      expect(shouldShowPaymentChip(cashJob, { jobIsPaid: true })).toBe(true);
    });

    it('says Paid rather than the ledger-derived Unpaid', () => {
      expect(derivePaymentState(cashJob)).toBe('unpaid');
      expect(derivePaymentState(cashJob, { jobIsPaid: true })).toBe('paid');
    });

    // An invoice keeps its own books: a stage can't paper over a balance.
    // This is the state a removed payment leaves behind until the server
    // walks the job stage back (see deriveJobStageBump).
    it('never overrides an invoice that still owes money', () => {
      const owing = { type: 'invoice', stage: 'invoice_sent', total: 960, paidTotal: 25 } as any;
      expect(derivePaymentState(owing, { jobIsPaid: true })).toBe('partially_paid');
      const untouched = { type: 'invoice', stage: 'invoice_sent', total: 960, paidTotal: 0 } as any;
      expect(derivePaymentState(untouched, { jobIsPaid: true })).toBe('unpaid');
    });

    it('leaves a deposit on the quote reading as a deposit', () => {
      const deposit = { type: 'quote', stage: 'quote_accepted', total: 1000, paidTotal: 200 } as any;
      expect(derivePaymentState(deposit, { jobIsPaid: true })).toBe('deposit_paid');
    });

    it('still hides a cancelled document', () => {
      expect(
        shouldShowPaymentChip({ type: 'quote', stage: 'cancelled' } as any, { jobIsPaid: true }),
      ).toBe(false);
    });
  });
});

/**
 * Tapping the chip opens RecordPaymentScreen. That screen dead-ends on
 * anything but an invoice with a balance still owing, so the tap target
 * is narrower than the chip itself.
 */
describe('canRecordPaymentFor', () => {
  it('opens on an invoice with nothing paid yet', () => {
    expect(
      canRecordPaymentFor({ type: 'invoice', stage: 'invoice_sent', total: 1000, paidTotal: 0 } as any),
    ).toBe(true);
  });

  it('opens on a part-paid invoice — there is still a balance to record against', () => {
    expect(
      canRecordPaymentFor({ type: 'invoice', stage: 'partially_paid', total: 1000, paidTotal: 400 } as any),
    ).toBe(true);
  });

  it('stays inert on a settled invoice, whose $0 balance the record screen would refuse', () => {
    expect(
      canRecordPaymentFor({ type: 'invoice', stage: 'paid', total: 1000, paidTotal: 1000 } as any),
    ).toBe(false);
  });

  it('stays inert on an overpaid invoice', () => {
    expect(
      canRecordPaymentFor({ type: 'invoice', stage: 'paid', total: 1000, paidTotal: 1200 } as any),
    ).toBe(false);
  });

  it('stays inert on a deposit-paid quote — the record screen rejects quotes outright', () => {
    expect(
      canRecordPaymentFor({ type: 'quote', stage: 'quote_accepted', total: 1000, paidTotal: 250 } as any),
    ).toBe(false);
  });

  it('stays inert on a cancelled invoice and on a job with no document', () => {
    expect(
      canRecordPaymentFor({ type: 'invoice', stage: 'cancelled', total: 1000, paidTotal: 0 } as any),
    ).toBe(false);
    expect(canRecordPaymentFor(undefined)).toBe(false);
    expect(canRecordPaymentFor(null)).toBe(false);
  });

  it('treats a within-half-a-cent balance as settled, matching derivePaymentState', () => {
    expect(
      canRecordPaymentFor({ type: 'invoice', stage: 'partially_paid', total: 1000, paidTotal: 999.999 } as any),
    ).toBe(false);
  });
});

/**
 * The meta line said "Quote sent 7 minutes ago" on a job whose document
 * was already an invoice — the same lie the timeline pill told, from a
 * second source.
 */
describe('pickStageStatus', () => {
  const T = 1_700_000_000_000;

  it('REGRESSION: drops the quote wording when the document is an invoice', () => {
    const status = pickStageStatus(
      { stage: 'quoted', quotedAt: T } as any,
      { type: 'invoice', stage: 'draft' } as any,
    );
    expect(status.label).not.toMatch(/quote/i);
    expect(status.label).toBe('Updated');
  });

  // The timestamp is the JOB's stage stamp, so naming the invoice event
  // would be a second lie — and moving it would break the list's sort,
  // which is keyed to exactly this value.
  it('keeps the job stage stamp as the timestamp', () => {
    expect(
      pickStageStatus(
        { stage: 'quoted', quotedAt: T, updatedAt: T + 5000 } as any,
        { type: 'invoice', stage: 'invoice_sent' } as any,
      ).ms,
    ).toBe(T);
  });

  it('leaves the quote wording alone for an actual quote', () => {
    expect(
      pickStageStatus({ stage: 'quoted', quotedAt: T } as any, { type: 'quote', stage: 'quote_sent' } as any)
        .label,
    ).toBe('Quote sent');
  });

  it('leaves later job stages alone even with an invoice attached', () => {
    expect(
      pickStageStatus({ stage: 'paid', paidAt: T } as any, { type: 'invoice', stage: 'paid' } as any)
        .label,
    ).toBe('Paid');
  });

  it('ignores a cancelled invoice', () => {
    expect(
      pickStageStatus(
        { stage: 'quoted', quotedAt: T } as any,
        { type: 'invoice', stage: 'cancelled' } as any,
      ).label,
    ).toBe('Quote sent');
  });
});
