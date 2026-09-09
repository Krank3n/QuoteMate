/**
 * The Square "Pay Now" block on quotes and invoices.
 *
 * Until September 2026 a tradie could opt into a 2.9% card surcharge, and the
 * block printed "Card payments include a 2.9% processing fee" underneath the
 * link. The RBA removed card surcharging from 1 October 2026 and the feature
 * was retired, but the flag that switched it on is still sitting on older
 * business-settings documents. The customer now pays the quoted amount, so
 * that line must never come back — whatever a stored document still says.
 */

import { describe, it, expect } from 'vitest';
import { generatePaymentMethodsHTML } from './htmlBuilders';

const url = 'https://square.link/u/demo';

describe('Square Pay Now block', () => {
  it('renders the button and the printable URL', () => {
    const html = generatePaymentMethodsHTML({ showOnDocuments: true }, { plan: 'pro', squarePaymentLinkUrl: url });
    expect(html).toContain('Pay with Square');
    expect(html).toContain(url);
  });

  it('never prints a card processing fee, even when a stored document still carries the retired surcharge flag', () => {
    const stale = { plan: 'free', squarePaymentLinkUrl: url, surchargePaymentFees: true } as Parameters<typeof generatePaymentMethodsHTML>[1];
    const html = generatePaymentMethodsHTML({ showOnDocuments: true }, stale);
    expect(html).toContain('Pay with Square');
    expect(html).not.toMatch(/processing fee/i);
    expect(html).not.toMatch(/surcharge/i);
    expect(html).not.toContain('2.9%');
  });
});
