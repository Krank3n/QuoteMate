// Mate assistant — Gemini Live ephemeral-token minter.
//
// The Live API speaks WebSocket only, so the RN client opens the socket
// directly (Firebase Functions HTTPS can't proxy a persistent WS session).
// To keep the master GEMINI_API_KEY off the device, the client first calls
// this endpoint, we mint a short-lived ephemeral token bound to a single
// session, and the client uses that as the WS `access_token` query param.
//
// Quota and rate-limit gate the mint itself: one mint = one
// assistantUsage turn, regardless of how many text or voice turns the
// resulting Live session goes on to serve.

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import cors from 'cors';
import { todayKey, reserveTurnUpdate, refundTurnUpdate, Plan } from './assistantQuota.helpers';
import { decideRateLimitWindow } from './rateLimitWindow';
import { userRateLimitKey } from './rateLimitKey';

const corsHandler = cors({ origin: true });
const db = () => admin.firestore();

// Keep model identity here so the client can render "Mate (gemini-3.1-flash)"
// without hard-coding the string. Bind the same model into the ephemeral
// token's liveConnectConstraints — the client can't escalate to a more
// expensive model with the same token.
const GEMINI_MODEL = 'gemini-3.1-flash-live-preview';
const TOKEN_TTL_MINUTES = 30;
const NEW_SESSION_WINDOW_MINUTES = 1;

export interface RateLimitConfig { maxRequests: number; windowMs: number }
const HEAVY: RateLimitConfig = { maxRequests: 10, windowMs: 60_000 };

export async function verifyAuth(
  req: functions.https.Request,
  res: functions.Response,
): Promise<admin.auth.DecodedIdToken | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return null;
  }
  try {
    return await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
  } catch {
    res.status(401).json({ error: 'Invalid or expired auth token' });
    return null;
  }
}

export async function checkRateLimit(key: string, cfg: RateLimitConfig, res: functions.Response): Promise<boolean> {
  const now = Date.now();
  const ref = db().collection('rateLimits').doc(key);
  try {
    const ok = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const decision = decideRateLimitWindow(snap.data()?.timestamps, now, cfg);
      if (!decision.allowed) return false;
      tx.set(ref, { timestamps: decision.timestamps, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
    if (!ok) { res.status(429).json({ error: 'Too many requests. Please try again later.' }); return false; }
    return true;
  } catch {
    return true; // fail open — matches the other endpoints
  }
}

export async function getEffectivePlan(uid: string): Promise<'free' | 'trial' | 'pro'> {
  try {
    const snap = await db().doc(`users/${uid}/profile/subscription`).get();
    const data = snap.data() || {};
    if (data.plan === 'pro' || data.isPro === true) return 'pro';
    if (data.plan === 'free') return 'free';
    if (data.trialStartedAt) {
      const started = data.trialStartedAt.toDate
        ? data.trialStartedAt.toDate()
        : new Date(data.trialStartedAt);
      const trialMs = 14 * 24 * 60 * 60 * 1000;
      return Date.now() - started.getTime() < trialMs ? 'trial' : 'free';
    }
    return 'trial';
  } catch {
    return 'trial';
  }
}

export async function checkAndReserveQuota(
  uid: string,
  plan: Plan,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ref = db().doc(`users/${uid}/assistantUsage/${todayKey()}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const result = reserveTurnUpdate(snap.data(), plan);
    if (!result.ok) return { ok: false, reason: result.reason } as const;
    tx.set(
      ref,
      { ...result.update, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { ok: true } as const;
  });
}

// Give back a turn reserved by checkAndReserveQuota when the downstream call
// (Gemini / token mint) failed — a failed request must not eat the user's
// daily allowance. Best-effort: a refund that itself fails is logged and
// swallowed, never surfaced to the user.
export async function refundQuotaTurn(uid: string): Promise<void> {
  const ref = db().doc(`users/${uid}/assistantUsage/${todayKey()}`);
  try {
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const update = refundTurnUpdate(snap.data());
      if (!update) return;
      tx.set(
        ref,
        { ...update, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn('[assistantQuota] refund failed', err?.message);
  }
}

interface AuthTokenResponse {
  // v1alpha returns the resource — the `name` field is the value the client
  // passes to the WebSocket as `access_token`.
  name?: string;
  error?: { message?: string };
}

async function mintEphemeralToken(apiKey: string): Promise<{ token: string; expiresAt: string }> {
  const now = new Date();
  const expireTime = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60_000).toISOString();
  const newSessionExpireTime = new Date(now.getTime() + NEW_SESSION_WINDOW_MINUTES * 60_000).toISOString();

  // The v1alpha REST shape for AuthToken accepts only `uses`, `expireTime`,
  // and `newSessionExpireTime`. The Python SDK's `live_connect_constraints`
  // option is transcoded differently and rejected here ("Unknown name
  // liveConnectConstraints at auth_token"). Single-use + a 1-minute window
  // for session start is the security envelope; a leaked token can't be
  // re-used and can't open a second session.
  const body = {
    uses: 1,
    expireTime,
    newSessionExpireTime,
  };

  const url = 'https://generativelanguage.googleapis.com/v1alpha/auth_tokens';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`auth_tokens.create ${res.status}: ${text}`);
  }
  const parsed = JSON.parse(text) as AuthTokenResponse;
  if (!parsed.name) {
    throw new Error(`auth_tokens.create returned no token name: ${text}`);
  }
  return { token: parsed.name, expiresAt: expireTime };
}

export const assistantToken = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

      const decodedToken = await verifyAuth(req, res);
      if (!decodedToken) return;
      // Token reconnects must not consume the materials-analysis bucket (or
      // vice versa). Both used to write `user:<uid>`, so a voice reconnect
      // storm could block the user's next quote generation.
      const ok = await checkRateLimit(
        userRateLimitKey(decodedToken.uid, HEAVY, 'assistant-token'),
        HEAVY,
        res,
      );
      if (!ok) return;
      const uid = decodedToken.uid;

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: 'Mate is offline (no API key).' });
        return;
      }

      const plan = await getEffectivePlan(uid);
      const quota = await checkAndReserveQuota(uid, plan);
      if (!quota.ok) {
        res.status(402).json({ error: quota.reason, code: 'QUOTA_EXCEEDED' });
        return;
      }

      try {
        const { token, expiresAt } = await mintEphemeralToken(apiKey);
        res.status(200).json({
          token,
          expiresAt,
          model: GEMINI_MODEL,
        });
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn('[assistantToken] mint failed', err?.message);
        // The turn was reserved above but no session came of it — refund.
        await refundQuotaTurn(uid);
        res.status(502).json({ error: 'Mate is offline — try again in a moment.', detail: err?.message });
      }
    });
  });
