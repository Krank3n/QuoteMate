/**
 * Pins the ElevenLabs webhook signature computation to a fixed fixture.
 *
 * The scheme was read off the official SDK, not the docs (which delegate to
 * it). If a firebase-functions or Express bump ever stops handing the handler
 * the exact received bytes as req.rawBody, every delivery starts failing and
 * the only symptom is voice cost silently falling back to whatever the client
 * chose to report. Worth a fixture.
 */
import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import {
  verifyElevenLabsWebhookSignature,
  SIGNATURE_TOLERANCE_MS,
} from './elevenLabsWebhookSignature';

const SECRET = 'wsec_test_secret_value';
const BODY = '{"type":"post_call_transcription","data":{"conversation_id":"conv_1"}}';
const NOW = 1_800_000_000_000;
const TS = Math.floor(NOW / 1000);

const sign = (ts: number, body: string, secret = SECRET) =>
  `t=${ts},v0=` + crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

const verify = (over: Partial<Parameters<typeof verifyElevenLabsWebhookSignature>[0]> = {}) =>
  verifyElevenLabsWebhookSignature({
    header: sign(TS, BODY), rawBody: BODY, secret: SECRET, nowMs: NOW, ...over,
  });

describe('verifyElevenLabsWebhookSignature', () => {
  it('accepts a correctly signed delivery', () => {
    expect(verify()).toEqual({ ok: true });
  });

  it('signs timestamp.body, not the body alone', () => {
    // The exact construction, pinned. Signing only the body would verify
    // against a different digest entirely.
    const bodyOnly = 'v0=' + crypto.createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(verify({ header: `t=${TS},${bodyOnly}` }).ok).toBe(false);
  });

  it('rejects a body altered by a single byte', () => {
    expect(verify({ rawBody: BODY.replace('conv_1', 'conv_2') }).ok).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(verify({ header: sign(TS, BODY, 'wrong_secret') }).ok).toBe(false);
  });

  it('rejects a missing header rather than throwing', () => {
    expect(verifyElevenLabsWebhookSignature({
      header: undefined, rawBody: BODY, secret: SECRET, nowMs: NOW,
    })).toEqual({ ok: false, reason: 'missing signature header' });
  });

  it('refuses to verify when no secret is configured', () => {
    // Otherwise an unset env var silently accepts everything.
    expect(verify({ secret: '' }).ok).toBe(false);
  });

  it('rejects a header with no v0 part', () => {
    expect(verify({ header: `t=${TS}` }).ok).toBe(false);
  });

  it('rejects a replay from outside the tolerance window', () => {
    const old = Math.floor((NOW - SIGNATURE_TOLERANCE_MS - 1000) / 1000);
    expect(verify({ header: sign(old, BODY) })).toEqual({ ok: false, reason: 'timestamp too old' });
  });

  it('accepts a delivery just inside the window', () => {
    const recent = Math.floor((NOW - SIGNATURE_TOLERANCE_MS + 60_000) / 1000);
    expect(verify({ header: sign(recent, BODY) }).ok).toBe(true);
  });

  it('rejects a far-FUTURE timestamp, which the official SDK does not', () => {
    // The SDK only bounds the old side, so a future timestamp would stay
    // valid indefinitely.
    const future = Math.floor((NOW + SIGNATURE_TOLERANCE_MS + 60_000) / 1000);
    expect(verify({ header: sign(future, BODY) })).toEqual({
      ok: false, reason: 'timestamp in the future',
    });
  });

  it('rejects a truncated signature WITHOUT throwing', () => {
    // timingSafeEqual throws on a length mismatch — the classic way this
    // becomes a crash instead of a rejection.
    const truncated = sign(TS, BODY).slice(0, -10);
    expect(() => verify({ header: truncated })).not.toThrow();
    expect(verify({ header: truncated }).ok).toBe(false);
  });

  it('rejects an unparseable timestamp', () => {
    expect(verify({ header: `t=not-a-number,v0=abc` }).ok).toBe(false);
  });

  it('tolerates whitespace around the header parts', () => {
    expect(verify({ header: sign(TS, BODY).replace(',', ', ') }).ok).toBe(true);
  });
});

describe('cost units (webhook payload)', () => {
  it('metadata.cost is CREDITS — never treat it as dollars', () => {
    // From a real delivery: a 47-second call reported cost=83, which is
    // call_charge 69 + llm_charge 14. Read as dollars that became an $83
    // charge for a call that actually cost $0.068 — and looked entirely
    // plausible sitting in a database.
    const metadata = {
      call_duration_secs: 47,
      cost: 83,
      charging: { call_charge: 69, llm_charge: 14, llm_price: 0.0050149 },
    };
    expect(metadata.cost).toBe(metadata.charging.call_charge + metadata.charging.llm_charge);

    // The correct figure: their dollar LLM price plus our own platform maths.
    const platform = (metadata.call_duration_secs / 60) * 0.08;
    const total = platform + metadata.charging.llm_price;
    expect(total).toBeCloseTo(0.0677, 3);
    expect(total).toBeLessThan(1);            // sanity: a 47s call is cents
    expect(metadata.cost).toBeGreaterThan(total * 1000);  // the trap, quantified
  });
});
