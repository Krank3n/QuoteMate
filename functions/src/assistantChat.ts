// Mate assistant — text-chat proxy. The client speaks Gemini generateContent
// wire shapes; the server routes them to the configured provider (Claude via
// claudeChatAdapter, or the legacy Gemini path).
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

import * as functions from 'firebase-functions/v1';
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
import {
  buildClaudeRequest,
  claudeContentToGeminiParts,
  claudeUsageToGeminiUsage,
} from './claudeChatAdapter';

const corsHandler = cors({ origin: true });

/**
 * Is this upstream failure the PROVIDER being dead, rather than our request
 * being wrong? Only these classes may fall back to Gemini: a fallback on a
 * generic 400 would mask real request bugs behind a silent quality downgrade —
 * the exact failure mode the Opus-generation no-op taught us to fear.
 *
 * The billing case is the one that has actually happened, twice: an
 * out-of-credit ANTHROPIC_API_KEY 502'd every Mate turn while the resolver,
 * which checks key PRESENCE only, kept routing to Claude. Mate is the app's
 * front door; it must degrade to Gemini, not die.
 */
export function isProviderDeadError(status: number, bodyText: string): boolean {
  if (status === 401 || status === 403 || status === 429 || status === 529) return true;
  if (status >= 500) return true;
  if (status === 400 && /credit balance|billing|payment/i.test(bodyText)) return true;
  return false;
}

/**
 * Claude thinking rides the Gemini-shaped parts as thoughtSignature blobs.
 * Gemini rejects signatures it did not mint, so a conversation replayed to the
 * fallback must shed them — the thinking context is lost for that turn, which
 * degrades, but the turn ANSWERS.
 */
export function stripThoughtSignatures(contents: unknown[]): unknown[] {
  return (contents || []).map((c: any) => {
    if (!c || !Array.isArray(c.parts)) return c;
    return {
      ...c,
      parts: c.parts.map((p: any) => {
        if (!p || p.thoughtSignature === undefined) return p;
        const { thoughtSignature, ...rest } = p;
        return rest;
      }),
    };
  });
}

// The text brain. Claude Sonnet 5 replaced gemini-3-flash-preview after the
// Aug 2026 audit: flash-tier instruction-following was producing empty
// replies mid-tool-loop, chain-of-thought leaks, and name slop
// ("Henderson" searched as "Hansen") — each one conversation-terminal in
// prod transcripts. The wire format to the client is still Gemini-shaped
// (see claudeChatAdapter), so reverting is: flip CHAT_PROVIDER back.
// Voice stays on Gemini Live — Claude has no realtime-audio equivalent.
const CHAT_PROVIDER: 'claude' | 'gemini' = 'claude';
const CLAUDE_CHAT_MODEL = 'claude-sonnet-5';
const CLAUDE_MAX_TOKENS = 8192;
// Legacy Gemini text model, kept as the revert path.
const CHAT_MODEL = 'gemini-3.7-flash';

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

      // Provider resolution: Claude unless its key is missing, in which case
      // the legacy Gemini path keeps Mate alive rather than 500ing everyone.
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      const geminiKey = process.env.GEMINI_API_KEY;
      const provider: 'claude' | 'gemini' =
        CHAT_PROVIDER === 'claude' && anthropicKey ? 'claude' : 'gemini';
      if (provider === 'gemini' && !geminiKey) {
        res.status(500).json({ error: 'Mate is offline (no API key).' });
        return;
      }

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

      // Build the upstream request. Either way the client keeps speaking
      // Gemini shapes — for Claude, the adapter translates both directions.
      let url: string;
      let upstreamBody: Record<string, unknown>;
      let headers: Record<string, string>;
      if (provider === 'claude') {
        url = 'https://api.anthropic.com/v1/messages';
        headers = {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey!,
          'anthropic-version': '2023-06-01',
        };
        upstreamBody = buildClaudeRequest({
          model: CLAUDE_CHAT_MODEL,
          maxTokens: CLAUDE_MAX_TOKENS,
          contents,
          systemInstruction,
          tools,
        });
      } else {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${geminiKey}`;
        headers = { 'Content-Type': 'application/json' };
        upstreamBody = { contents };
        if (systemInstruction) upstreamBody.systemInstruction = systemInstruction;
        if (tools) upstreamBody.tools = tools;
      }

      let activeProvider = provider;
      let upstreamRes: Awaited<ReturnType<typeof fetch>> | null = null;
      let text = '';
      try {
        upstreamRes = await fetch(url, { method: 'POST', headers, body: JSON.stringify(upstreamBody) });
        text = await upstreamRes.text();
      } catch (err: any) {
        // Network-level failure counts as provider-dead below.
        text = String(err?.message || err);
      }

      // Claude down (billing, auth, quota, outage, network)? Replay the turn
      // on Gemini instead of 502ing — Mate is the front door and an unfunded
      // key has taken it offline before. Never for request-shaped 400s.
      if (
        activeProvider === 'claude' &&
        geminiKey &&
        (!upstreamRes || (!upstreamRes.ok && isProviderDeadError(upstreamRes.status, text)))
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          '[assistantChat] Claude unavailable, falling back to Gemini:',
          upstreamRes ? `${upstreamRes.status} ${text.slice(0, 200)}` : text.slice(0, 200),
        );
        activeProvider = 'gemini';
        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${geminiKey}`;
        const gBody: Record<string, unknown> = { contents: stripThoughtSignatures(contents) };
        if (systemInstruction) gBody.systemInstruction = systemInstruction;
        if (tools) gBody.tools = tools;
        try {
          upstreamRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(gBody),
          });
          text = await upstreamRes.text();
        } catch (err: any) {
          if (reservedTurn) await refundQuotaTurn(decoded.uid);
          res.status(502).json({ error: 'Mate is offline — try again in a moment.', detail: err?.message });
          return;
        }
      }

      if (!upstreamRes) {
        if (reservedTurn) await refundQuotaTurn(decoded.uid);
        res.status(502).json({ error: 'Mate is offline — try again in a moment.', detail: text.slice(0, 200) });
        return;
      }
      if (!upstreamRes.ok) {
        // eslint-disable-next-line no-console
        console.warn('[assistantChat]', activeProvider, 'error', upstreamRes.status, text.slice(0, 300));
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

      // Hand the model turn's parts back in the Gemini shape the client
      // echoes verbatim. For Claude, thinking blocks ride the parts'
      // thoughtSignature field so the next hop can restore them; for Gemini,
      // functionCall parts carry their native thoughtSignature untouched.
      const model = activeProvider === 'claude' ? CLAUDE_CHAT_MODEL : CHAT_MODEL;
      const parts =
        activeProvider === 'claude'
          ? claudeContentToGeminiParts(parsed?.content || [], parsed?.stop_reason)
          : parsed?.candidates?.[0]?.content?.parts || [];
      const usageMetadata =
        activeProvider === 'claude'
          ? claudeUsageToGeminiUsage(parsed?.usage)
          : parsed?.usageMetadata || {};

      // Record real token usage for cost tracking. Best-effort — a failed
      // write must not break the user-facing reply.
      try {
        await recordChatUsage({
          uid: decoded.uid,
          model,
          usage: usageMetadata,
          countedTurn: !!countTurn,
        });
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn('[assistantChat] usage record failed', err?.message);
      }

      res.status(200).json({ parts, model, usageMetadata });
    });
  });
