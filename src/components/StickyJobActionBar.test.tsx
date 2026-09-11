// @vitest-environment jsdom
/**
 * Regression tests for the draft-quote path in the sticky job action bar.
 *
 * Before Jul 2026 every draft quote — including one abandoned halfway
 * through the wizard — showed "Send Quote" as the primary action, so the
 * only route back into the wizard at the right step was the dashboard's
 * draft banner, and tapping "Send" could email a half-built quote. An
 * unfinished draft (draftStep stamped, not yet at JobPreview) must lead
 * with "Continue Quote" instead.
 */
import { describe, it, expect, vi } from 'vitest';

// Heavy native/expo dependency graphs irrelevant to the pure action
// resolver under test — same approach as JobCard.ghost.test.tsx.
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', () => ({
  MD3DarkTheme: { colors: {} },
  Text: () => null,
  ActivityIndicator: () => null,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('../utils/haptics', () => ({
  lightTap: () => {},
  selectionTap: () => {},
  successTap: () => {},
}));

import { resolveJobActions, isUnfinishedDraftQuote } from './StickyJobActionBar';
import type { Document } from '../types/document';

function quoteDoc(overrides: Partial<Document>): Document {
  return {
    id: 'doc-1',
    type: 'quote',
    stage: 'draft',
    ...overrides,
  } as Document;
}

describe('isUnfinishedDraftQuote', () => {
  it('is true for a draft quote stopped mid-wizard', () => {
    expect(isUnfinishedDraftQuote(quoteDoc({ draftStep: 'MaterialsList' }))).toBe(true);
    expect(isUnfinishedDraftQuote(quoteDoc({ draftStep: 'CustomerDetails' }))).toBe(true);
  });

  it('is false for a draft that reached the preview step', () => {
    expect(isUnfinishedDraftQuote(quoteDoc({ draftStep: 'JobPreview' }))).toBe(false);
  });

  it('is false without a wizard step stamped', () => {
    expect(isUnfinishedDraftQuote(quoteDoc({}))).toBe(false);
  });

  it('is false for non-draft stages, invoices, and null', () => {
    expect(isUnfinishedDraftQuote(quoteDoc({ stage: 'quote_sent', draftStep: 'MaterialsList' }))).toBe(false);
    expect(isUnfinishedDraftQuote(quoteDoc({ type: 'invoice', draftStep: 'MaterialsList' }))).toBe(false);
    expect(isUnfinishedDraftQuote(null)).toBe(false);
  });
});

describe('resolveJobActions — draft quote', () => {
  it('leads with Continue Quote for an unfinished draft', () => {
    const actions = resolveJobActions('inquiry', quoteDoc({ draftStep: 'LaborMarkup' }));
    expect(actions.map((a) => a.id)).toEqual(['continueQuote', 'sendQuote']);
    expect(actions[0].tone).toBe('primary');
    expect(actions[1].tone).toBe('ghost');
  });

  it('leads with Send Quote once the draft reached preview', () => {
    const actions = resolveJobActions('inquiry', quoteDoc({ draftStep: 'JobPreview' }));
    expect(actions[0].id).toBe('sendQuote');
    expect(actions[0].tone).toBe('primary');
  });

  it('leads with Send Quote for a draft with no wizard step (e.g. reopened doc)', () => {
    const actions = resolveJobActions('inquiry', quoteDoc({}));
    expect(actions[0].id).toBe('sendQuote');
  });

  it('keeps the invoice-draft path unchanged', () => {
    const actions = resolveJobActions(
      'in_progress',
      quoteDoc({ type: 'invoice', draftStep: 'MaterialsList' }),
    );
    expect(actions.map((a) => a.id)).toEqual(['sendInvoice', 'editQuote']);
  });
});

// Sep 2026: ten of the eleven accounts that ever paid had an accepted quote
// first, and 38 accounts with one never collected a cent. The bar used to
// lead an accepted job with "Pick a Date" and park the money in the ghost
// slot. The customer said yes — the next move is the deposit they asked for,
// else the invoice, the same step the "job won" sheet and the dashboard's
// next-action card name (all three read depositOwed).
describe('resolveJobActions — accepted quote leads with the money', () => {
  const accepted = quoteDoc({ stage: 'quote_accepted' });
  const depositOwing = quoteDoc({ stage: 'quote_accepted', depositAmount: 100, depositPaid: 0 });
  const depositPaid = quoteDoc({ stage: 'quote_accepted', depositAmount: 100, depositPaid: 100 });

  it('leads with Create Invoice when no deposit is owed, date second', () => {
    const actions = resolveJobActions('accepted', accepted);
    expect(actions.map((a) => a.id)).toEqual(['generateInvoice', 'schedule']);
    expect(actions[0]).toMatchObject({ label: 'Create Invoice', tone: 'primary' });
    expect(actions[1].tone).toBe('ghost');
  });

  it('leads with Take Deposit while the deposit asked for is unpaid', () => {
    const actions = resolveJobActions('accepted', depositOwing);
    expect(actions.map((a) => a.id)).toEqual(['takeDeposit', 'schedule']);
    expect(actions[0]).toMatchObject({ label: 'Take Deposit', tone: 'primary' });
  });

  it('goes back to Create Invoice once the deposit is in', () => {
    expect(resolveJobActions('accepted', depositPaid)[0].id).toBe('generateInvoice');
  });

  it('a deposit asked for but never paid stays first on every job stage', () => {
    expect(resolveJobActions('scheduled', depositOwing).map((a) => a.id)).toEqual(['takeDeposit', 'startJob']);
    expect(resolveJobActions('in_progress', depositOwing).map((a) => a.id)).toEqual(['takeDeposit', 'markComplete']);
    expect(resolveJobActions('completed', depositOwing).map((a) => a.id)).toEqual(['takeDeposit', 'generateInvoice']);
  });

  it('with no deposit owed the invoice leads and the stage step rides second', () => {
    expect(resolveJobActions('scheduled', accepted).map((a) => a.id)).toEqual(['generateInvoice', 'startJob']);
    expect(resolveJobActions('in_progress', accepted).map((a) => a.id)).toEqual(['generateInvoice', 'markComplete']);
    expect(resolveJobActions('completed', accepted).map((a) => a.id)).toEqual(['generateInvoice']);
  });

  it('never leads an accepted quote with anything but the money step', () => {
    for (const stage of ['accepted', 'scheduled', 'in_progress', 'completed'] as const) {
      for (const doc of [accepted, depositOwing, depositPaid]) {
        const [primary] = resolveJobActions(stage, doc);
        expect(['takeDeposit', 'generateInvoice']).toContain(primary.id);
        expect(primary.tone).toBe('primary');
      }
    }
  });
});

// Pay-up-front trades reach `paid` before the work exists. The bar's only
// button was an accented "Close Job" — an invitation to archive a job the
// tradie hasn't turned up to yet, with no way to the date from this screen.
describe('resolveJobActions — paid before the work is done', () => {
  const paidInvoice = quoteDoc({ type: 'invoice', stage: 'paid' });

  it('leads with the date, not the archive, while the booking is ahead', () => {
    const actions = resolveJobActions('paid', paidInvoice, true);
    expect(actions.map((a) => a.id)).toEqual(['schedule', 'closeJob']);
    expect(actions[0].tone).toBe('primary');
    expect(actions[1].tone).toBe('ghost');
  });

  it('goes back to Close Job once the day has passed', () => {
    const actions = resolveJobActions('paid', paidInvoice, false);
    expect(actions.map((a) => a.id)).toEqual(['closeJob']);
    expect(actions[0].tone).toBe('primary');
  });

  it('leaves an unpaid invoice on the money path either way', () => {
    const owing = quoteDoc({ type: 'invoice', stage: 'invoice_sent', total: 1000, paidTotal: 0 });
    expect(resolveJobActions('scheduled', owing, true).map((a) => a.id)).not.toContain('schedule');
  });
});

/**
 * Log Payment on a sent-but-unpaid invoice.
 *
 * The second slot used to be "Resend", and Log Payment only appeared once an
 * invoice was PARTLY paid — so the one state a tradie is in every single time
 * (invoice sent, cash or transfer received, nothing recorded yet) was the one
 * state with no button for banking it. Resend still lives in the kebab.
 */
describe('sticky bar — banking a payment on an unpaid invoice', () => {
  const invoice = (over: Record<string, any> = {}): any => ({
    id: 'inv1', type: 'invoice', stage: 'invoice_sent',
    total: 972.4, paidTotal: 0, ...over,
  });

  it('offers Log Payment on a sent, unpaid invoice', () => {
    const ids = resolveJobActions('in_progress', invoice()).map((a: any) => a.id);
    expect(ids).toContain('recordPayment');
  });

  it('still offers it once partly paid', () => {
    const ids = resolveJobActions('in_progress', invoice({ stage: 'partially_paid', paidTotal: 400 }))
      .map((a: any) => a.id);
    expect(ids).toContain('recordPayment');
  });

  it('no longer spends the slot on Resend while money is owed', () => {
    const ids = resolveJobActions('in_progress', invoice()).map((a: any) => a.id);
    expect(ids).not.toContain('resendInvoice');
  });

  it('leaves a settled invoice alone', () => {
    const ids = resolveJobActions('paid', invoice({ stage: 'paid', paidTotal: 972.4 }))
      .map((a: any) => a.id);
    expect(ids).not.toContain('recordPayment');
  });
});

/**
 * iOS takes the same money path as everyone else (Aug 2026).
 *
 * Only the tap-to-pay flow waits on Apple approval, and the in-sheet row
 * gates that itself (config/squareTapToPay). Hiding the whole Take Payment
 * button on iOS also took away the Square pay link — an iPhone tradie on a
 * part-paid invoice had no way to collect the rest by card at all.
 */
describe('sticky bar — iOS shares the invoice money path', () => {
  async function resolveOnIos(doc: any) {
    vi.resetModules();
    vi.doMock('react-native', async () => {
      const actual: any = await vi.importActual('react-native');
      return { ...actual, Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default } };
    });
    const { resolveJobActions: resolveIos } = await import('./StickyJobActionBar');
    const actions = resolveIos('in_progress', doc);
    vi.doUnmock('react-native');
    vi.resetModules();
    return actions;
  }

  it('leads with Take Payment on a sent, unpaid invoice — the pay link works on iPhone', async () => {
    const actions = await resolveOnIos({
      id: 'inv1', type: 'invoice', stage: 'invoice_sent', total: 972.4, paidTotal: 0,
    });
    expect(actions[0]).toMatchObject({ id: 'takeFinalPayment', label: 'Take Payment', tone: 'primary' });
    expect(actions.map((a: any) => a.id)).toContain('recordPayment');
  });

  it('offers Take Remaining on a part-paid invoice', async () => {
    const actions = await resolveOnIos({
      id: 'inv1', type: 'invoice', stage: 'partially_paid', total: 972.4, paidTotal: 400,
    });
    expect(actions[0]).toMatchObject({ id: 'takeFinalPayment', label: 'Take Remaining' });
  });

  it('still offers Log Payment alongside: no reader or Square account needed', async () => {
    const actions = await resolveOnIos({
      id: 'inv1', type: 'invoice', stage: 'invoice_sent', total: 972.4, paidTotal: 0,
    });
    expect(actions.map((a: any) => a.id)).toContain('recordPayment');
  });
});
