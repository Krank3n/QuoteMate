// Mate assistant — text-chat proxy to Gemini generateContent.
//
// Why this exists separately from assistantToken/the Live WS path:
// the voice path runs over the Live WebSocket on a native-audio model
// (gemini-3.1-flash-live-preview), which only emits AUDIO. Text chat needs a
// model that emits TEXT, and none of the Live (bidiGenerateContent) models on
// this project can — so text can't share that transport. This endpoint is a
// thin authenticated proxy: the client posts a Gemini generateContent request
// (contents + systemInstruction + tools), we attach the master key (kept off
// the device) and forward it to a text-capable flash model.
//
// Mate's tools execute on the client (they read the local store), so a single
// user turn can take several round-trips: model asks for a tool → client runs
// it → client posts the result back here → model replies. The client drives
// that function-calling loop and calls this endpoint once per model step.
//
// Quota: one user turn = one assistantUsage turn, matched to the token mint on
// the voice side. The client sets countTurn=true only on the first call of a
// turn; tool-loop continuations pass countTurn=false, so a reply with three
// tool calls still costs exactly one turn.

import * as functions from 'firebase-functions';
import fetch from 'node-fetch';
import cors from 'cors';
import {
  verifyAuth,
  checkRateLimit,
  getEffectivePlan,
  checkAndReserveQuota,
  refundQuotaTurn,
  RateLimitConfig,
} from './assistantToken';
import { userRateLimitKey } from './rateLimitKey';
import { recordChatUsage } from './assistantCosts';

const corsHandler = cors({ origin: true });

// Text-capable flash model. Deliberately distinct from the Live native-audio
// model the voice path uses — that one can't emit text.
const CHAT_MODEL = 'gemini-3-flash-preview';

// A text turn fans out into up to 8 tool round-trips (the client's
// MAX_TOOL_HOPS), so 30/min capped real usage at ~4 turns/min. 60 clears
// honest turns while still bounding abuse; the token mint stays at 10/min.
const CHAT_RATE: RateLimitConfig = { maxRequests: 60, windowMs: 60_000 };

// 512MB, not 256: a turn carrying two photos posts a ~6MB base64 body that
// exists ~3x over concurrently (request buffer, parsed JSON, forwarded body).
// An OOM kills the process BEFORE refundQuotaTurn runs, so the tradie is
// charged a turn for nothing. analyzeJobDescription runs multi-MB base64 at
// 512MB for the same reason.
export const assistantChat = functions
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

      const decoded = await verifyAuth(req, res);
      if (!decoded) return;
      const ok = await checkRateLimit(userRateLimitKey(decoded.uid, CHAT_RATE, 'chat'), CHAT_RATE, res);
      if (!ok) return;

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) { res.status(500).json({ error: 'Mate is offline (no API key).' }); return; }

      const { contents, systemInstruction, tools, countTurn } = req.body || {};
      if (!Array.isArray(contents) || !contents.length) {
        res.status(400).json({ error: 'contents required.' });
        return;
      }

      // Reserve quota once per user turn (first call only). Tool-loop
      // continuations pass countTurn=false and don't re-charge. If the
      // Gemini call below then fails, the reserved turn is refunded — a
      // failed request must not eat the user's daily allowance.
      let reservedTurn = false;
      if (countTurn) {
        const plan = await getEffectivePlan(decoded.uid);
        const quota = await checkAndReserveQuota(decoded.uid, plan);
        if (!quota.ok) {
          res.status(402).json({ error: quota.reason, code: 'QUOTA_EXCEEDED' });
          return;
        }
        reservedTurn = true;
      }

      const body: Record<string, unknown> = { contents };
      if (systemInstruction) body.systemInstruction = systemInstruction;
      if (tools) body.tools = tools;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${apiKey}`;
      let geminiRes: Awaited<ReturnType<typeof fetch>>;
      try {
        geminiRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (err: any) {
        if (reservedTurn) await refundQuotaTurn(decoded.uid);
        res.status(502).json({ error: 'Mate is offline — try again in a moment.', detail: err?.message });
        return;
      }

      const text = await geminiRes.text();
      if (!geminiRes.ok) {
        // eslint-disable-next-line no-console
        console.warn('[assistantChat] gemini error', geminiRes.status, text.slice(0, 300));
        if (reservedTurn) await refundQuotaTurn(decoded.uid);
        res.status(502).json({ error: 'Mate hit a snag — try again in a moment.' });
        return;
      }

      let parsed: any;
      try { parsed = JSON.parse(text); } catch {
        if (reservedTurn) await refundQuotaTurn(decoded.uid);
        res.status(502).json({ error: 'Mate returned an unreadable reply.' });
        return;
      }

      // Hand the model turn's parts straight back. They may contain text and/or
      // functionCall parts (each carrying a thoughtSignature the client must
      // echo verbatim on the next round-trip so the thinking model keeps its
      // reasoning context).
      const parts = parsed?.candidates?.[0]?.content?.parts || [];

      // Record real token usage from Gemini for cost tracking. Best-effort —
      // a failed write must not break the user-facing reply.
      const usageMetadata = parsed?.usageMetadata || {};
      try {
        await recordChatUsage({
          uid: decoded.uid,
          model: CHAT_MODEL,
          usage: usageMetadata,
          countedTurn: !!countTurn,
        });
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn('[assistantChat] usage record failed', err?.message);
      }

      res.status(200).json({ parts, model: CHAT_MODEL, usageMetadata });
    });
  });
