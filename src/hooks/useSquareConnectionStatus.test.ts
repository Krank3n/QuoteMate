import { describe, expect, it } from 'vitest';
import { readSquareConnection } from './useSquareConnectionStatus';

describe('readSquareConnection', () => {
  it('a failed or missing answer is unknown, never "not connected"', () => {
    expect(readSquareConnection(null)).toEqual({ connected: null, paymentsReady: null });
    expect(readSquareConnection(undefined)).toEqual({ connected: null, paymentsReady: null });
  });

  it('not connected carries no readiness', () => {
    expect(readSquareConnection({ connected: false })).toEqual({ connected: false, paymentsReady: null });
  });

  it('connected reports the server verdict, and null until Square has been asked', () => {
    expect(readSquareConnection({ connected: true })).toEqual({ connected: true, paymentsReady: null });
    expect(readSquareConnection({ connected: true, paymentReadiness: null })).toEqual({ connected: true, paymentsReady: null });
    expect(
      readSquareConnection({ connected: true, paymentReadiness: { ready: false, reasons: ['no_card_processing'], checkedAt: 1 } }),
    ).toEqual({ connected: true, paymentsReady: false });
    expect(
      readSquareConnection({ connected: true, paymentReadiness: { ready: true, reasons: [], checkedAt: 1 } }),
    ).toEqual({ connected: true, paymentsReady: true });
  });
});
