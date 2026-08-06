/**
 * StoreKit 2 signed-transaction verification for validateAppleReceipt.
 *
 * expo-iap 3.x hands the client a JWS signed transaction ("iOS JWS, Android
 * purchaseToken" in its own types), NOT the legacy base64 app receipt. Posting
 * a JWS to Apple's /verifyReceipt as `receipt-data` returns status 21002
 * (malformed), which the previous code read as an AFFIRMATIVE rejection — so
 * simply configuring APPLE_SHARED_SECRET would have converted today's harmless
 * 503-retry into a terminal 402 that burns genuine purchases.
 *
 * There is no shared secret in this path at all. A StoreKit 2 JWS carries its
 * own Apple-issued certificate chain (x5c) and verifies offline against Apple's
 * root CA, so this needs no Apple credentials — only the root cert below.
 *
 * The root is embedded rather than read from disk: functions run from lib/ with
 * a different cwd than source, and a missing cert file would silently degrade
 * every purchase to 'unavailable'. 583 bytes is cheaper than that failure mode.
 * Apple Root CA - G3, valid to 2039-04-30. Both real production and sandbox
 * transactions observed in this project chain to exactly this certificate.
 */

import { SignedDataVerifier, Environment } from '@apple/app-store-server-library';
import type { ValidationOutcome } from './receiptValidation.helpers';

const APPLE_ROOT_CA_G3_B64 =
  'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==';

export const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.hansendev.quotemate';
// Numeric App Store id for com.hansendev.quotemate. The library refuses to
// construct a PRODUCTION verifier without it.
export const APPLE_APP_APPLE_ID = Number(process.env.APPLE_APP_APPLE_ID || 6754000046);

export interface AppleJwsVerification {
  outcome: ValidationOutcome;
  expiryDate: Date | null;
  environment: string | null;
  productId: string | null;
  transactionId: string | null;
  /** Short machine-readable note for logs; never surfaced to the buyer. */
  detail: string;
}

function rootCertificates(): Buffer[] {
  return [Buffer.from(APPLE_ROOT_CA_G3_B64, 'base64')];
}

/**
 * Reads the UNVERIFIED payload purely to decide which environment's verifier to
 * construct. This is not a trust decision: verifyAndDecodeTransaction re-checks
 * the environment against the verifier's own, and a forged claim still has to
 * survive Apple's signature. Returns null when the token isn't JWS-shaped.
 */
export function peekJwsEnvironment(jws: string): string | null {
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload?.environment === 'string' ? payload.environment : null;
  } catch {
    return null;
  }
}

// Verifiers are stateless and cache verified public keys, so build once per
// instance rather than per request.
const verifierCache = new Map<string, SignedDataVerifier>();

function verifierFor(environment: Environment): SignedDataVerifier {
  const key = String(environment);
  const cached = verifierCache.get(key);
  if (cached) return cached;
  const verifier = new SignedDataVerifier(
    rootCertificates(),
    // Online checks add an OCSP round-trip to Apple on every purchase; a blip
    // there would read as 'unavailable' and stall real buyers. The chain and
    // signature are still fully verified offline, and entitlement is gated on
    // the transaction's own expiresDate below.
    false,
    environment,
    APPLE_BUNDLE_ID,
    environment === Environment.PRODUCTION ? APPLE_APP_APPLE_ID : undefined,
  );
  verifierCache.set(key, verifier);
  return verifier;
}

/**
 * Verify a StoreKit 2 signed transaction and report an outcome in the same
 * vocabulary as receiptVerdict(): 'valid' | 'invalid' | 'unavailable'.
 *
 * 'invalid' is reserved for tokens Apple's own signature says are not genuine
 * (bad signature, wrong bundle id, wrong environment). Anything that reflects
 * OUR inability to reach a verdict — a non-JWS token from an older client, a
 * library/config fault — stays 'unavailable' so the store transaction is left
 * unfinished and retried rather than burned.
 */
export async function verifyAppleJws(jws: unknown): Promise<AppleJwsVerification> {
  const base: AppleJwsVerification = {
    outcome: 'unavailable',
    expiryDate: null,
    environment: null,
    productId: null,
    transactionId: null,
    detail: '',
  };

  if (typeof jws !== 'string' || !jws) {
    return { ...base, detail: 'no_token' };
  }

  const declared = peekJwsEnvironment(jws);
  if (declared === null) {
    // Legacy base64 receipt from an older build, or garbage. We cannot reach a
    // verdict on it, so do not reject a potentially real purchase.
    return { ...base, detail: 'not_jws' };
  }

  const environment =
    declared.toLowerCase() === 'production' ? Environment.PRODUCTION : Environment.SANDBOX;

  let verifier: SignedDataVerifier;
  try {
    verifier = verifierFor(environment);
  } catch (err) {
    // Misconfiguration (e.g. missing appAppleId) — our fault, not the buyer's.
    return { ...base, environment: declared, detail: `verifier_init_failed:${String(err)}` };
  }

  try {
    const payload = await verifier.verifyAndDecodeTransaction(jws);
    const expiresMs = typeof payload.expiresDate === 'number' ? payload.expiresDate : 0;
    return {
      outcome: 'valid',
      expiryDate: expiresMs > 0 ? new Date(expiresMs) : null,
      environment: payload.environment ?? declared,
      productId: payload.productId ?? null,
      transactionId: payload.transactionId ?? null,
      detail: 'verified',
    };
  } catch (err: any) {
    // VerificationException means Apple's signature/identity checks failed —
    // an affirmative "this is not a genuine transaction".
    const status = err?.status;
    if (status !== undefined) {
      return {
        ...base,
        outcome: 'invalid',
        environment: declared,
        detail: `verification_failed:${String(status)}`,
      };
    }
    return { ...base, environment: declared, detail: `verify_threw:${String(err)}` };
  }
}
