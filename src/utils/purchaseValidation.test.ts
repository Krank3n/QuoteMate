import { describe, it, expect } from 'vitest';
import { classifyReceiptResponse } from './purchaseValidation';

describe('classifyReceiptResponse (PAY-01)', () => {
  it('grants only when the server explicitly confirms success', () => {
    expect(classifyReceiptResponse(200, { success: true, validated: true })).toBe('granted');
  });

  it('rejects a 402 RECEIPT_VALIDATION_FAILED — regression for the old "always set local premium" fallback', () => {
    expect(
      classifyReceiptResponse(402, { success: false, error: 'RECEIPT_VALIDATION_FAILED', reason: 'not_validated' }),
    ).toBe('rejected');
  });

  it('rejects a 400 bad-request response', () => {
    expect(classifyReceiptResponse(400, { error: 'Missing required parameters' })).toBe('rejected');
  });

  it('does not grant on success:false even with HTTP 200', () => {
    expect(classifyReceiptResponse(200, { success: false })).toBe('rejected');
  });

  it('does not grant on a malformed body', () => {
    expect(classifyReceiptResponse(200, null)).toBe('rejected');
    expect(classifyReceiptResponse(200, 'ok')).toBe('rejected');
    expect(classifyReceiptResponse(200, { success: 'true' })).toBe('rejected');
  });

  it('retries on server errors so the store re-delivers the transaction', () => {
    expect(classifyReceiptResponse(500, null)).toBe('retry');
    expect(classifyReceiptResponse(503, { error: 'unavailable' })).toBe('retry');
  });
});
