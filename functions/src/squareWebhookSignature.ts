import * as crypto from 'crypto';

/**
 * Square webhook HMAC-SHA256 verification: base64(HMAC(key, notificationUrl +
 * rawBody)) compared timing-safely against the header value.
 *
 * Extracted from squareWebhook (index.ts) so a fixed byte-for-byte fixture can
 * pin the computation — it is only correct while the functions runtime hands
 * the handler the exact received bytes as req.rawBody, the surface most at
 * risk in firebase-functions/Express major bumps. A regression here silently
 * rejects payment webhooks (invoices never flip to paid) with no client error.
 */
export function verifySquareWebhookSignature(args: {
  signature: string;
  rawBody: string;
  signatureKey: string;
  notificationUrl: string;
}): boolean {
  const expected = crypto
    .createHmac('sha256', args.signatureKey)
    .update(args.notificationUrl + args.rawBody)
    .digest('base64');

  const sigBuf = Buffer.from(args.signature, 'base64');
  const expBuf = Buffer.from(expected, 'base64');
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
}
