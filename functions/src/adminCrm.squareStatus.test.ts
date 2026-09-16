import { describe, expect, it } from 'vitest';
import { squareStatusOf } from './adminCrm';

const sq = (over: Record<string, unknown> = {}) => ({
  connected: true, merchantId: 'M', merchantName: 'M', locationName: 'L', env: 'production',
  connectedAt: '2026-09-16T09:43:39.813Z', disconnectedReason: null, paymentReadiness: null,
  ...over,
} as any);

describe('squareStatusOf', () => {
  it('no connection doc is none, a dead token is broken', () => {
    expect(squareStatusOf(null)).toBe('none');
    expect(squareStatusOf(sq({ connected: false, disconnectedReason: 'token_refresh_failed' }))).toBe('broken');
  });

  it('a connected account Square will not charge a card for is not_ready, not connected', () => {
    const notReady = sq({ paymentReadiness: { ready: false, reasons: ['no_card_processing'], checkedAt: 1, currency: 'AUD', capabilities: ['AUTOMATIC_TRANSFERS'] } });
    expect(squareStatusOf(notReady)).toBe('not_ready');
  });

  it('a ready verdict, or a connection that predates the probe, is connected', () => {
    expect(squareStatusOf(sq({ paymentReadiness: { ready: true, reasons: [], checkedAt: 1, currency: 'AUD', capabilities: ['CREDIT_CARD_PROCESSING'] } }))).toBe('connected');
    expect(squareStatusOf(sq())).toBe('connected');
  });

  it('a dead token outranks the readiness verdict', () => {
    expect(squareStatusOf(sq({ connected: false, disconnectedReason: 'x', paymentReadiness: { ready: false, reasons: ['no_card_processing'], checkedAt: 1, currency: null, capabilities: null } }))).toBe('broken');
  });
});
