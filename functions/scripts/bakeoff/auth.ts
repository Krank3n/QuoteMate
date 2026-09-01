/**
 * Mints a real Firebase ID token so the bake-off can drive the DEPLOYED
 * production endpoints (analyzeJobDescription, reconcilePricedMaterials)
 * rather than a local reimplementation of them. Fidelity is the whole point:
 * a replay that re-derives the prompt drifts the moment prod's prompt changes,
 * and prod's materials prompt is ~200 lines of accumulated rules.
 *
 * Uses a dedicated harness UID so the feature-usage telemetry the endpoint
 * writes (recordMaterialsRecommend) never lands on a real tradie's account.
 * surveyCustomerJobs.ts excludes this account from any corpus.
 */

import * as admin from 'firebase-admin';
import fetch from 'node-fetch';

/**
 * Defaults to deployed production. Override to point the harness at a local
 * emulator when the change under test is not deployed yet — otherwise the run
 * silently measures whatever is currently live, which is the OLD code, and
 * reports it as a result for the new one.
 *
 *   BAKEOFF_FUNCTIONS_BASE=http://127.0.0.1:5001/hansendev/us-central1
 */
export const FUNCTIONS_BASE =
  process.env.BAKEOFF_FUNCTIONS_BASE || 'https://us-central1-hansendev.cloudfunctions.net';

/**
 * A POOL of harness identities, not one.
 *
 * The endpoints are limited to 10 requests/60s PER UID, and a single job fires
 * analyze + two reconciles + one searchMaterialPrice per unpriced row across
 * two app variants — easily 30 calls on a big concreting quote. One uid turns
 * that into minutes of pure rate-limit waiting. Round-robining over a few
 * internal uids keeps the run honest (nothing is skipped or counted as failed)
 * without touching any real tradie's bucket. surveyCustomerJobs excludes them.
 */
export const HARNESS_UIDS = [
  'bakeoff-harness-internal',
  'bakeoff-harness-internal-2',
  'bakeoff-harness-internal-3',
  'bakeoff-harness-internal-4',
];
export const HARNESS_UID = HARNESS_UIDS[0];

const cachedByUid = new Map<string, { token: string; expiresAt: number }>();
let rr = 0;

export async function harnessIdToken(uid: string = HARNESS_UID): Promise<string> {
  const cached = cachedByUid.get(uid);
  if (cached && Date.now() < cached.expiresAt - 120_000) return cached.token;

  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) throw new Error('Missing FIREBASE_API_KEY (source ../.env)');

  // ADC (user credentials) cannot sign a custom token — createCustomToken needs
  // a service account key. GOOGLE_SERVICE_ACCOUNT_JSON in functions/.env can
  // sign but has no Auth admin read access, so it lives on its OWN named app:
  // the default app stays on ADC for the Firestore reads the corpus needs.
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON (source functions/.env)');
  const signer =
    admin.apps.find((a) => a?.name === 'bakeoff-signer') ||
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)), projectId: 'hansendev' }, 'bakeoff-signer');

  // No getUser/createUser here — the signing account has no Auth admin rights,
  // and signInWithCustomToken provisions the uid on first exchange anyway.
  const customToken = await signer!.auth().createCustomToken(uid);
  // Retried like every other network call: this had none, so one bad DNS
  // moment failed the job outright — 12 of 24 in a single run.
  let res: any;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: customToken, returnSecureToken: true }),
        },
      );
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === 5) throw new Error(redact(String((err as Error)?.message || err)));
      await sleep(3_000 * attempt);
    }
  }
  if (lastErr) throw new Error(redact(String((lastErr as Error)?.message || lastErr)));
  if (!res.ok) {
    throw new Error(`Token exchange ${res.status}: ${redact((await res.text()).slice(0, 300))}`);
  }
  const data: any = await res.json();
  const entry = { token: data.idToken, expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000 };
  cachedByUid.set(uid, entry);
  return entry.token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Never let an API key reach a log line. These URLs carry `?key=...`, and a
 * fetch failure stringifies the whole URL into its message — this repo is
 * public and has leaked a key through committed output before.
 */
const redact = (msg: string): string => msg.replace(/key=[^&\s"']+/g, 'key=REDACTED');

/**
 * Transient network failures worth retrying.
 *
 * DNS was NOT in this set, so a momentary `getaddrinfo ENOTFOUND` was treated
 * as a hard failure. A single flaky stretch on this machine cost 17 of 24 jobs
 * in one run — the measurement is long, and the odds of a clean hour are worse
 * than the odds of any individual call succeeding on a retry.
 */
const isTransient = (err: unknown): boolean =>
  /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ENETUNREACH|ECONNREFUSED|EHOSTUNREACH|getaddrinfo|aborted|socket hang up|network|fetch failed|50\d /i.test(
    String((err as { message?: string })?.message || err),
  );

/**
 * POST to a deployed function with the harness identity.
 *
 * These endpoints sit behind RATE_LIMITS.heavy (10 requests / 60s per uid) and
 * one bake-off job can fire a dozen — analyze, two reconciles, and a
 * searchMaterialPrice per unpriced row. A 429 is a harness pacing problem, not
 * a pipeline result, so it is waited out rather than recorded as a failure;
 * counting it as one would silently make the app look worse than it is.
 */
export async function callFunction(name: string, body: any, timeoutMs = 420_000): Promise<any> {
  let lastErr: any;
  for (let attempt = 1; attempt <= 6; attempt++) {
    // Rotate identities so the per-uid heavy limit is not the bottleneck.
    const token = await harnessIdToken(HARNESS_UIDS[rr++ % HARNESS_UIDS.length]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal: controller.signal as any,
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (res.status === 429) {
        // The window is 60s; wait it out rather than hammering.
        await sleep(20_000 * attempt);
        lastErr = new Error(`${name} 429 rate limited`);
        continue;
      }
      if (!res.ok) throw new Error(`${name} ${res.status}: ${text.slice(0, 400)}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${name} returned non-JSON: ${text.slice(0, 200)}`);
      }
    } catch (err: any) {
      lastErr = err;
      if (!isTransient(err) || attempt === 6) throw new Error(redact(String(err?.message || err)));
      await sleep(5_000 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
