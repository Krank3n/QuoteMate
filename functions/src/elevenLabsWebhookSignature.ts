import * as crypto from 'crypto';

/**
 * ElevenLabs post-call webhook HMAC verification.
 *
 * Scheme read off the official SDK rather than the docs, which delegate to it:
 *
 *   header:  ElevenLabs-Signature: t=<unix_seconds>,v0=<hex>
 *   message: `${timestamp}.${rawBody}`
 *   digest:  HMAC-SHA256, lowercase hex, prefixed "v0="
 *
 * Extracted as a pure function for the same reason squareWebhookSignature is:
 * the computation is only correct while the functions runtime hands the
 * handler the exact received bytes as req.rawBody, which is the surface most
 * at risk in a firebase-functions or Express major bump. A regression here
 * silently rejects every delivery, and the only symptom is voice costs
 * quietly reverting to whatever the client felt like reporting.
 *
 * One deliberate difference from the SDK: it only rejects timestamps that are
 * too OLD. A far-future timestamp would sail through its check forever, so
 * this bounds both directions.
 */

/** Matches the SDK's 30-minute replay window. */
export const SIGNATURE_TOLERANCE_MS = 30 * 60 * 1000;

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: string };

export function verifyElevenLabsWebhookSignature(args: {
  header: string | undefined;
  rawBody: string;
  secret: string;
  nowMs?: number;
}): SignatureResult {
  if (!args.header) return { ok: false, reason: 'missing signature header' };
  if (!args.secret) return { ok: false, reason: 'webhook secret not configured' };

  const parts = args.header.split(',').map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const provided = parts.find((p) => p.startsWith('v0='));
  if (!timestamp || !provided) {
    return { ok: false, reason: 'no v0 signature in header' };
  }

  const tsMs = Number(timestamp) * 1000;
  if (!Number.isFinite(tsMs)) return { ok: false, reason: 'unparseable timestamp' };
  const now = args.nowMs ?? Date.now();
  if (tsMs < now - SIGNATURE_TOLERANCE_MS) return { ok: false, reason: 'timestamp too old' };
  if (tsMs > now + SIGNATURE_TOLERANCE_MS) return { ok: false, reason: 'timestamp in the future' };

  const expected =
    'v0=' +
    crypto.createHmac('sha256', args.secret).update(`${timestamp}.${args.rawBody}`).digest('hex');

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch — guard first, or a truncated
  // signature crashes the function instead of being rejected.
  if (a.length !== b.length) return { ok: false, reason: 'signature mismatch' };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'signature mismatch' };
  return { ok: true };
}
