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

// Regression (Jul 2026): an accepted quote had NO conversion affordance
// anywhere on the job screen — Generate Invoice only appeared once the job
// reached in_progress, forcing stage gymnastics to invoice an accepted job.
describe('resolveJobActions — accepted quote conversion access', () => {
  it('offers Generate Invoice alongside scheduling when no deposit is owed', () => {
    const actions = resolveJobActions(
      'accepted',
      quoteDoc({ stage: 'quote_accepted' }),
    );
    expect(actions.map((a) => a.id)).toEqual(['schedule', 'generateInvoice']);
    expect(actions[1].tone).toBe('ghost');
  });

  it('keeps money first: deposit owed still shows Take Deposit, not convert', () => {
    const actions = resolveJobActions(
      'accepted',
      quoteDoc({ stage: 'quote_accepted', depositAmount: 100, depositPaid: 0 }),
    );
    expect(actions.map((a) => a.id)).toEqual(['schedule', 'takeDeposit']);
  });

  it('in_progress still leads with Generate Invoice (unchanged)', () => {
    const actions = resolveJobActions(
      'in_progress',
      quoteDoc({ stage: 'quote_accepted' }),
    );
    expect(actions.map((a) => a.id)).toEqual(['generateInvoice', 'markComplete']);
  });
});
