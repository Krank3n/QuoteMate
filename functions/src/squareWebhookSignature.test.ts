import { describe, expect, it } from 'vitest';
import { verifySquareWebhookSignature } from './squareWebhookSignature';

/**
 * Fixed byte-for-byte fixtures: the signatures below were computed once with
 * node's crypto over these exact strings and hard-coded, so the test pins the
 * computation itself (key + url-prefix + base64 HMAC-SHA256) rather than
 * comparing the function against itself. If an SDK/runtime bump changes how
 * body bytes reach the handler, or a refactor changes the signed input, this
 * fails loudly instead of Square payments silently going unverified.
 */
const KEY = 'test-signature-key-fixture';
const URL = 'https://example.test/squareWebhook';
const BODY =
  '{"type":"payment.updated","data":{"object":{"payment":{"id":"PAY-1","status":"COMPLETED","amount_money":{"amount":12345,"currency":"AUD"}}}}}';
const SIG = 'rxcN/vS89dYNTQ7UYUkwQ0G5s7xHhWzvZSPo0KMAE0w=';

const UNICODE_BODY = '{"type":"payment.updated","note":"café — déjà vu"}';
const UNICODE_SIG = 'W6Alq5niKnHCHpv6wjnB3CFIb40Rl1aJ1Y9RJRXXGPc=';

describe('verifySquareWebhookSignature', () => {
  it('accepts the known-good fixture', () => {
    expect(
      verifySquareWebhookSignature({
        signature: SIG,
        rawBody: BODY,
        signatureKey: KEY,
        notificationUrl: URL,
      }),
    ).toBe(true);
  });

  it('accepts a body with non-ASCII bytes (utf8 exactness)', () => {
    expect(
      verifySquareWebhookSignature({
        signature: UNICODE_SIG,
        rawBody: UNICODE_BODY,
        signatureKey: KEY,
        notificationUrl: URL,
      }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(
      verifySquareWebhookSignature({
        signature: SIG,
        rawBody: BODY.replace('12345', '12346'),
        signatureKey: KEY,
        notificationUrl: URL,
      }),
    ).toBe(false);
  });

  it('rejects a signature minted for a different notification URL', () => {
    expect(
      verifySquareWebhookSignature({
        signature: SIG,
        rawBody: BODY,
        signatureKey: KEY,
        notificationUrl: 'https://evil.test/squareWebhook',
      }),
    ).toBe(false);
  });

  it('rejects an empty signature without throwing', () => {
    expect(
      verifySquareWebhookSignature({
        signature: '',
        rawBody: BODY,
        signatureKey: KEY,
        notificationUrl: URL,
      }),
    ).toBe(false);
  });

  it('rejects a wrong-length signature without throwing (timingSafeEqual guard)', () => {
    expect(
      verifySquareWebhookSignature({
        signature: 'c2hvcnQ=',
        rawBody: BODY,
        signatureKey: KEY,
        notificationUrl: URL,
      }),
    ).toBe(false);
  });
});
