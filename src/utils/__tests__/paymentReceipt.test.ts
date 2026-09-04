/**
 * Apple req 5.10, approved half — the receipt a customer gets after paying.
 *
 * "Confidential" is the word doing the work in the requirement, and it is the
 * one a receipt template is most likely to violate: the temptation is to add
 * the card's last four to make it look official. The app is never given card
 * details, and a receipt shared over SMS or WhatsApp is not where they would
 * belong even if it were.
 */
import { describe, it, expect } from 'vitest';

import { buildPaymentReceipt } from '../paymentReceipt';

// Local components on purpose — an absolute instant renders a different day in
// a different timezone, and the receipt reads in the tradie's local time.
const at = new Date(2026, 8, 4, 11, 13);

describe('buildPaymentReceipt', () => {
  it('leads with the tradie business name', () => {
    const out = buildPaymentReceipt({ businessName: 'Slimjims', amount: 1, at });
    expect(out.split('\n')[0]).toBe('Slimjims');
  });

  it('confirms the payment plainly', () => {
    const out = buildPaymentReceipt({ amount: 1, at });
    expect(out).toMatch(/payment received/i);
  });

  it('states the amount actually charged', () => {
    const out = buildPaymentReceipt({ amount: 3337.64, at });
    expect(out).toContain('$3,337.64');
  });

  it('carries the invoice reference when there is one', () => {
    const out = buildPaymentReceipt({ reference: 'INV-1042', amount: 1, at });
    expect(out).toContain('For: INV-1042');
  });

  it('omits the reference line rather than printing an empty one', () => {
    const out = buildPaymentReceipt({ reference: '  ', amount: 1, at });
    expect(out).not.toMatch(/^For:/m);
  });

  it('omits the business name line when the tradie has not set one', () => {
    const out = buildPaymentReceipt({ businessName: ' ', amount: 1, at });
    expect(out.split('\n')[0]).toMatch(/payment received/i);
  });

  it('stays confidential — no card number, last four, or brand', () => {
    const out = buildPaymentReceipt({ businessName: 'Slimjims', amount: 1, at });
    // The year is the only four-digit run that belongs on a receipt.
    const withoutYear = out.replace(/\b2026\b/g, '');
    expect(withoutYear).not.toMatch(/\b\d{4}\b/);
    expect(out).not.toMatch(/visa|mastercard|amex|last four|ending/i);
  });

  it('never puts the app on a customer-facing artifact', () => {
    const out = buildPaymentReceipt({ businessName: 'Slimjims', amount: 1, at });
    expect(out).not.toMatch(/quotemate/i);
  });

  it('timestamps from the injected time, not the clock', () => {
    const out = buildPaymentReceipt({ amount: 1, at });
    expect(out).toMatch(/When: 4 Sept? 2026, 11:13 am/);
  });
});
