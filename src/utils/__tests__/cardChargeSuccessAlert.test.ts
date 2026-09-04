/**
 * Apple req 5.10 — the receipt offer has to reach every screen that can take a
 * payment.
 *
 * This alert was previously hand-rolled in ViewJobScreen, JobPreviewScreen and
 * useJobActionsSheet. A Required behaviour added to two of the three is a
 * review failure on whichever one the reviewer opens, so the point of the
 * builder is that there is only one to get right.
 */
import { describe, it, expect, vi } from 'vitest';

import { cardChargeSuccessAlert } from '../cardChargeSuccessAlert';

describe('cardChargeSuccessAlert', () => {
  it('offers the customer a receipt after an approved charge', () => {
    const sendReceipt = vi.fn();
    const alert = cardChargeSuccessAlert({ amount: 1, sendReceipt });
    expect(alert.secondaryButtonText).toBe('Send receipt');
    expect(alert.secondaryButtonAction).toBe(sendReceipt);
  });

  it('still confirms the money was taken', () => {
    const alert = cardChargeSuccessAlert({ amount: 3337.64, sendReceipt: vi.fn() });
    expect(alert.type).toBe('success');
    expect(alert.title).toBe('Payment received');
    expect(alert.message).toContain('$3,337.64');
  });

  it('keeps Done as the primary — the receipt is an offer, not a step', () => {
    const alert = cardChargeSuccessAlert({ amount: 1, sendReceipt: vi.fn() });
    expect(alert.primaryButtonText).toBe('Done');
  });

  it('shows no receipt button when there is nothing to send', () => {
    // Better no button than one that does nothing.
    const alert = cardChargeSuccessAlert({ amount: 1 });
    expect(alert.secondaryButtonText).toBeUndefined();
    expect(alert.secondaryButtonAction).toBeUndefined();
  });
});
