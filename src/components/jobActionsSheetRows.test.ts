/**
 * Row-visibility rules for the job actions sheet (the card's ⋮ menu).
 * Regression context (Jul 2026): quote→invoice conversion had no entry
 * point on the job screen; the sheet now offers it for unconverted quotes.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({ View: () => null, StyleSheet: { create: (s: any) => s, hairlineWidth: 1 }, TouchableOpacity: () => null, Platform: { OS: 'android', select: (o: any) => o.android ?? o.default }, Pressable: () => null }));
vi.mock('react-native-paper', () => ({ DefaultTheme: { colors: {} }, MD3DarkTheme: { colors: {} }, Text: () => null }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('./BottomSheet', () => ({ BottomSheet: () => null }));
vi.mock('../utils/haptics', () => ({ selectionTap: () => {}, lightTap: () => {} }));

import { ROWS } from './JobActionsSheet';

const convertRow = ROWS.find((r: any) => r.id === 'convertToInvoice')!;
const job = { id: 'j1', archivedAt: undefined } as any;
const ctx = (primaryDoc: any) => ({ job, primaryDoc, xeroConnected: false }) as any;

describe('JobActionsSheet — Convert to Invoice row', () => {
  it('exists in the sheet', () => {
    expect(convertRow).toBeTruthy();
  });

  it('shows for an unconverted quote at any stage', () => {
    expect(convertRow.when(ctx({ type: 'quote', stage: 'draft' }))).toBe(true);
    expect(convertRow.when(ctx({ type: 'quote', stage: 'quote_sent' }))).toBe(true);
    expect(convertRow.when(ctx({ type: 'quote', stage: 'quote_accepted' }))).toBe(true);
  });

  it('hides for invoices', () => {
    expect(convertRow.when(ctx({ type: 'invoice', stage: 'invoice_sent' }))).toBe(false);
  });

  it('hides once the quote has already been invoiced', () => {
    expect(convertRow.when(ctx({ type: 'quote', stage: 'quote_accepted', invoicedAt: 123 }))).toBe(false);
  });

  it('hides when the job has no doc yet', () => {
    expect(convertRow.when(ctx(null))).toBe(false);
  });
});
