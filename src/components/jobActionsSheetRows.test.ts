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

/**
 * "Record a payment" — the manual door.
 *
 * It used to be the THIRD row INSIDE the sheet that "Take Payment — tap to
 * pay or share the Square link" opens, so a tradie who simply wanted to write
 * down a bank transfer had to go through a door labelled for card payments to
 * reach it. One told us the app couldn't record payments at all. It is now a
 * top-level row, above the card-reader one, because banking a transfer that
 * already landed is the everyday act and taking a card is the occasional one.
 */
const recordRow = ROWS.find((r: any) => r.id === 'recordPayment')!;

describe('JobActionsSheet — Record a payment row', () => {
  it('exists, and sits above the card-reader row', () => {
    expect(recordRow).toBeTruthy();
    const iRecord = ROWS.findIndex((r: any) => r.id === 'recordPayment');
    const iTake = ROWS.findIndex((r: any) => r.id === 'takePayment');
    expect(iRecord).toBeGreaterThanOrEqual(0);
    expect(iRecord).toBeLessThan(iTake);
  });

  it('shows while an invoice still owes money', () => {
    expect(recordRow.when(ctx({ type: 'invoice', stage: 'invoice_sent', total: 972.4, paidTotal: 0 }))).toBe(true);
    expect(recordRow.when(ctx({ type: 'invoice', stage: 'partially_paid', total: 972.4, paidTotal: 400 }))).toBe(true);
  });

  it('hides once the invoice is settled', () => {
    expect(recordRow.when(ctx({ type: 'invoice', stage: 'paid', total: 972.4, paidTotal: 972.4 }))).toBe(false);
  });

  it('treats a sub-cent remainder as settled', () => {
    expect(recordRow.when(ctx({ type: 'invoice', stage: 'invoice_sent', total: 1000, paidTotal: 999.999 }))).toBe(false);
  });

  it('hides on quotes and cancelled invoices — nothing to bank against', () => {
    expect(recordRow.when(ctx({ type: 'quote', stage: 'quote_sent', total: 972.4, paidTotal: 0 }))).toBe(false);
    expect(recordRow.when(ctx({ type: 'invoice', stage: 'cancelled', total: 972.4, paidTotal: 0 }))).toBe(false);
  });

  it('hides when the job has no document at all', () => {
    expect(recordRow.when(ctx(null))).toBe(false);
  });

  it('does NOT gate on Square or platform', () => {
    // Recording a transfer you already received needs neither a reader nor a
    // Square account, so it must reach every platform.
    const src = recordRow.when.toString();
    expect(src).not.toContain('Platform');
  });
});

/**
 * "Take Payment" — the collect-now door (tap to pay / Square pay link).
 *
 * Gated on money, not platform (Aug 2026). It used to be `any doc, Android
 * only`: a settled invoice still offered Take Payment after Record had gone,
 * and iPhones got neither — even though the Square pay link is server-minted
 * and works everywhere. Only the tap-to-pay row INSIDE the sheet waits on
 * Apple approval, and it gates itself via config/squareTapToPay.
 */
const takeRow = ROWS.find((r: any) => r.id === 'takePayment')!;

describe('JobActionsSheet — Take Payment row', () => {
  it('shows while an invoice still owes money', () => {
    expect(takeRow.when(ctx({ type: 'invoice', stage: 'invoice_sent', total: 972.4, paidTotal: 0 }))).toBe(true);
    expect(takeRow.when(ctx({ type: 'invoice', stage: 'partially_paid', total: 972.4, paidTotal: 400 }))).toBe(true);
  });

  it('shows on quotes with money left to collect — deposits go through the same sheet', () => {
    expect(takeRow.when(ctx({ type: 'quote', stage: 'quote_sent', total: 972.4, paidTotal: 0 }))).toBe(true);
    expect(takeRow.when(ctx({ type: 'quote', stage: 'quote_accepted', total: 972.4, paidTotal: 300 }))).toBe(true);
  });

  it('hides once there is nothing left to collect', () => {
    expect(takeRow.when(ctx({ type: 'invoice', stage: 'paid', total: 972.4, paidTotal: 972.4 }))).toBe(false);
    expect(takeRow.when(ctx({ type: 'quote', stage: 'quote_accepted', total: 972.4, paidTotal: 972.4 }))).toBe(false);
    expect(takeRow.when(ctx({ type: 'quote', stage: 'draft', total: 0 }))).toBe(false);
  });

  it('hides on cancelled docs and jobs with no doc', () => {
    expect(takeRow.when(ctx({ type: 'invoice', stage: 'cancelled', total: 972.4, paidTotal: 0 }))).toBe(false);
    expect(takeRow.when(ctx(null))).toBe(false);
  });

  it('no longer gates on platform — the pay link works on iPhone', () => {
    const src = takeRow.when.toString();
    expect(src).not.toContain('Platform');
  });
});
