/**
 * "Convert to Invoice" is offered from two doors — its own row in the
 * kebab, and inside the "Change status" submenu. The submenu door exists
 * because there is no "Invoiced" Job stage: invoicing lives on the
 * document, so anyone looking for it in a status list finds nothing.
 *
 * Both doors ask this one predicate, so they can't disagree about whether
 * conversion is on the table — and neither can re-offer a one-way action
 * that has already happened.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: any) => o.ios },
  View: () => null,
  StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
  Pressable: () => null,
}));
vi.mock('react-native-paper', () => ({ Text: () => null }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../theme', () => ({ makeStyles: () => () => ({}), useThemeColors: () => ({}) }));
vi.mock('./BottomSheet', () => ({ BottomSheet: () => null }));
vi.mock('../utils/haptics', () => ({ selectionTap: () => {}, lightTap: () => {} }));
vi.mock('./JobStageSheet', () => ({ jobStageMetaFor: () => ({}) }));

import { canConvert } from './JobActionsSheet';

describe('canConvert', () => {
  it('offers conversion on a quote at any point in its life', () => {
    expect(canConvert({ type: 'quote', stage: 'draft' } as any)).toBe(true);
    expect(canConvert({ type: 'quote', stage: 'quote_sent' } as any)).toBe(true);
    expect(canConvert({ type: 'quote', stage: 'quote_accepted' } as any)).toBe(true);
  });

  // The Owed pile is entirely invoices — this is why the row was nowhere
  // to be found while filtering by it.
  it('hides on a document that is already an invoice', () => {
    expect(canConvert({ type: 'invoice', stage: 'invoice_sent' } as any)).toBe(false);
    expect(canConvert({ type: 'invoice', stage: 'paid' } as any)).toBe(false);
  });

  // Conversion is one-way; re-offering it invites a double-tap on an
  // action that mints invoice numbers and rewrites totals.
  it('never re-offers once the quote has been invoiced', () => {
    expect(canConvert({ type: 'quote', stage: 'draft', invoicedAt: 123 } as any)).toBe(false);
  });

  it('hides when the job has no document at all', () => {
    expect(canConvert(undefined)).toBe(false);
    expect(canConvert(null)).toBe(false);
  });
});
