/**
 * PaymentChip renders inside ViewJobScreen only, so the Jobs list could
 * never show who owed money — a tradie had to open each job in turn to
 * find out. The chip now rides the card's meta row.
 *
 * The predicate is the interesting half: with most jobs sitting at Draft,
 * an unconditional chip would stamp "Unpaid" on every row and mean nothing.
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
vi.mock('./PaymentChip', () => ({ PaymentChip: () => null }));

import { shouldShowPaymentChip } from './JobCard';

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
});
