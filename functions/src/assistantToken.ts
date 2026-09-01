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

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import cors from 'cors';
import {
  todayKey,
  reserveTurnUpdate,
  refundTurnUpdate,
  reserveVoiceSecondsUpdate,
  refundVoiceSecondsUpdate,
  remainingVoiceSeconds,
  MAX_SESSION_SECONDS,
  Plan,
} from './assistantQuota.helpers';
import { decideRateLimitWindow } from './rateLimitWindow';
import { userRateLimitKey } from './rateLimitKey';
import { decideVoiceProvider, VoiceConfigDoc } from './assistantVoiceProvider';
import {
  mintElevenLabsConversationToken,
  mintOpenAiRealtimeToken,
  participantNameForUid,
  EL_VOICE_MODEL_LABEL,
  OA_VOICE_MODEL_LABEL,
  OA_REALTIME_MODEL,
} from './assistantVoiceToken';

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

// ---------------------------------------------------------------------------
// Voice provider selection + the ElevenLabs branch
// ---------------------------------------------------------------------------

// config/assistantVoice rides the existing `match /config/{docId}` rule in
// firestore.rules (public read, no client write), so this needs no rules change.
// Cached briefly because Functions instances are reused and every voice open
// would otherwise pay a Firestore read for a document that changes maybe twice
// a week.
const VOICE_CONFIG_TTL_MS = 60_000;
let voiceConfigCache: { at: number; doc: VoiceConfigDoc | undefined } | null = null;

export async function getVoiceConfig(now: number = Date.now()): Promise<VoiceConfigDoc | undefined> {
  if (voiceConfigCache && now - voiceConfigCache.at < VOICE_CONFIG_TTL_MS) {
    return voiceConfigCache.doc;
  }
  try {
    const snap = await db().doc('config/assistantVoice').get();
    const doc = snap.exists ? (snap.data() as VoiceConfigDoc) : undefined;
    voiceConfigCache = { at: now, doc };
    return doc;
  } catch (err: any) {
    // Fail toward Gemini: an unreadable config must never be the thing that
    // moves users onto a new provider.
    // eslint-disable-next-line no-console
    console.warn('[assistantToken] voice config read failed', err?.message);
    voiceConfigCache = { at: now, doc: undefined };
    return undefined;
  }
}

/** Test seam — the module-level cache would otherwise leak between cases. */
export function __resetVoiceConfigCache(): void {
  voiceConfigCache = null;
}

/** Park a voice-second hold for today. Mirrors checkAndReserveQuota. */
export async function checkAndReserveVoiceSeconds(
  uid: string,
  plan: Plan,
): Promise<{ ok: true; heldSeconds: number } | { ok: false; reason: string }> {
  const ref = db().doc(`users/${uid}/assistantUsage/${todayKey()}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const result = reserveVoiceSecondsUpdate(snap.data(), plan);
    if (!result.ok) return { ok: false, reason: result.reason } as const;
    tx.set(
      ref,
      { ...result.update, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { ok: true, heldSeconds: result.heldSeconds } as const;
  });
}

/** Give a hold back when the session never opened. Best-effort, like refundQuotaTurn. */
export async function refundVoiceSeconds(uid: string, seconds: number): Promise<void> {
  const ref = db().doc(`users/${uid}/assistantUsage/${todayKey()}`);
  try {
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const update = refundVoiceSecondsUpdate(snap.data(), seconds);
      if (!update) return;
      tx.set(
        ref,
        { ...update, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn('[assistantVoice] second refund failed', err?.message);
  }
}

/**
 * conversationId → uid, written at mint.
 *
 * The ElevenLabs post-call webhook carries a conversation id and no Firebase
 * identity, so without this row there is nothing to reconcile a session's real
 * duration and cost against. Server-only collection.
 */
async function recordVoiceSession(args: {
  uid: string;
  plan: Plan;
  conversationId: string;
  heldSeconds: number;
  maxDurationSeconds: number;
}): Promise<void> {
  if (!args.conversationId) return;
  try {
    await db().doc(`voiceSessions/${args.conversationId}`).set({
      uid: args.uid,
      plan: args.plan,
      model: EL_VOICE_MODEL_LABEL,
      heldSeconds: args.heldSeconds,
      maxDurationSeconds: args.maxDurationSeconds,
      mintedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn('[assistantVoice] session mapping write failed', err?.message);
  }
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

      // ---- ElevenLabs voice branch -------------------------------------
      // Only voice opens can land here; text keeps the Gemini path untouched.
      const elKey = process.env.ELEVENLABS_API_KEY;
      const elAgentId = process.env.ELEVENLABS_AGENT_ID;
      const oaKey = process.env.OPENAI_API_KEY;
      const envEnabled = process.env.ELEVENLABS_VOICE_ENABLED === 'true';
      // Either provider having credentials is enough to consider a non-Gemini
      // route; which one is then decided by the config doc.
      const credentialsPresent = Boolean((elKey && elAgentId) || oaKey);
      // Only pay the config read when the answer could actually be ElevenLabs.
      // With the flag off — which is every request until the rollout starts —
      // this is a Firestore round-trip per voice open for a decision already
      // made, on the hot path of a tradie tapping the mic.
      const voiceEligible = req.body?.mode === 'voice' && envEnabled && credentialsPresent;
      const decision = decideVoiceProvider({
        uid,
        config: voiceEligible ? await getVoiceConfig() : undefined,
        envEnabled,
        credentialsPresent,
        clientSupports: Array.isArray(req.body?.supports) ? req.body.supports : undefined,
      });

      // ---- OpenAI Realtime branch (evaluation) -------------------------
      // Rides the same budget and quota path as ElevenLabs; only the mint
      // differs. Kept separate rather than generalised because the two are
      // being compared, and a shared abstraction would hide the differences
      // that comparison is about.
      if (req.body?.mode === 'voice' && decision.provider === 'openai' && oaKey) {
        const held = await checkAndReserveVoiceSeconds(uid, plan);
        if (!held.ok) {
          res.status(402).json({ error: held.reason, code: 'VOICE_BUDGET_EXCEEDED', remainingVoiceSeconds: 0 });
          return;
        }
        const oaQuota = await checkAndReserveQuota(uid, plan);
        if (!oaQuota.ok) {
          await refundVoiceSeconds(uid, held.heldSeconds);
          res.status(402).json({ error: oaQuota.reason, code: 'QUOTA_EXCEEDED' });
          return;
        }
        try {
          const minted = await mintOpenAiRealtimeToken({ apiKey: oaKey });
          const usage = await db().doc(`users/${uid}/assistantUsage/${todayKey()}`).get();
          res.status(200).json({
            provider: 'openai',
            token: minted.token,
            model: OA_REALTIME_MODEL,
            voice: process.env.OPENAI_REALTIME_VOICE || 'cedar',
            modelLabel: OA_VOICE_MODEL_LABEL,
            maxDurationSeconds: MAX_SESSION_SECONDS[plan],
            heldSeconds: held.heldSeconds,
            remainingVoiceSeconds: remainingVoiceSeconds(usage.data(), plan),
          });
          return;
        } catch (err: any) {
          // eslint-disable-next-line no-console
          console.warn('[assistantVoice] OpenAI mint failed, falling back to Gemini', err?.message);
          await refundVoiceSeconds(uid, held.heldSeconds);
          await refundQuotaTurn(uid);
        }
      }

      if (req.body?.mode === 'voice' && decision.provider === 'elevenlabs') {
        // Seconds first: a user out of talk time shouldn't also lose a turn.
        const held = await checkAndReserveVoiceSeconds(uid, plan);
        if (!held.ok) {
          res.status(402).json({
            error: held.reason,
            code: 'VOICE_BUDGET_EXCEEDED',
            remainingVoiceSeconds: 0,
          });
          return;
        }
        const voiceQuota = await checkAndReserveQuota(uid, plan);
        if (!voiceQuota.ok) {
          await refundVoiceSeconds(uid, held.heldSeconds);
          res.status(402).json({ error: voiceQuota.reason, code: 'QUOTA_EXCEEDED' });
          return;
        }
        try {
          const minted = await mintElevenLabsConversationToken({
            apiKey: elKey!,
            agentId: elAgentId!,
            participantName: participantNameForUid(uid),
          });
          const maxDurationSeconds = MAX_SESSION_SECONDS[plan];
          await recordVoiceSession({
            uid,
            plan,
            conversationId: minted.conversationId,
            heldSeconds: held.heldSeconds,
            maxDurationSeconds,
          });
          const usage = await db().doc(`users/${uid}/assistantUsage/${todayKey()}`).get();
          res.status(200).json({
            provider: 'elevenlabs',
            token: minted.token,
            conversationId: minted.conversationId,
            agentId: elAgentId,
            model: EL_VOICE_MODEL_LABEL,
            maxDurationSeconds,
            heldSeconds: held.heldSeconds,
            remainingVoiceSeconds: remainingVoiceSeconds(usage.data(), plan),
          });
          return;
        } catch (err: any) {
          // Degrade, don't 502. The Gemini path is still deployed and still
          // works; a tradie on a job site should get a working voice session,
          // not an outage, because a third party had a bad minute. Falls
          // through to the Gemini mint below.
          // eslint-disable-next-line no-console
          console.warn('[assistantVoice] ElevenLabs mint failed, falling back to Gemini', err?.message);
          await refundVoiceSeconds(uid, held.heldSeconds);
          await refundQuotaTurn(uid);
        }
      }
      // ---- end ElevenLabs branch ---------------------------------------

      const quota = await checkAndReserveQuota(uid, plan);
      if (!quota.ok) {
        res.status(402).json({ error: quota.reason, code: 'QUOTA_EXCEEDED' });
        return;
      }

      try {
        const { token, expiresAt } = await mintEphemeralToken(apiKey);
        res.status(200).json({
          provider: 'gemini',
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
