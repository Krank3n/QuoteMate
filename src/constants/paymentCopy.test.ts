/**
 * Guard rails for the payment copy standard: labels stay Aussie-plain, never
 * mention "AI", and payment surfaces never soften a dismissal into
 * "Later" / "Not now" — those are the labels this pass retired.
 */
import { describe, it, expect } from 'vitest';
import { paymentCopy } from './paymentCopy';

describe('paymentCopy standard', () => {
  const values = Object.values(paymentCopy);

  it('never mentions AI', () => {
    for (const value of values) {
      expect(value).not.toMatch(/\bAI\b/);
    }
  });

  it('has no soft dismiss labels (Later / Not now)', () => {
    for (const value of values) {
      expect(value).not.toMatch(/\b(Later|Not now)\b/i);
    }
  });

  it('uses "Record Payment", not the retired variants', () => {
    expect(paymentCopy.recordPayment).toBe('Record Payment');
    for (const value of values) {
      expect(value).not.toMatch(/Log Payment/i);
    }
  });
});
