// Mate assistant chat endpoint.
//
// Single non-streaming JSON response in v1: client POSTs a turn, server runs a
// tool-use loop against Anthropic, returns { messages, proposals, usage }.
// Streaming (SSE) drops in behind STREAM_ENABLED once the RN ↔ Functions
// transport is proven on device.
//
// Auth + rate limit reuse the same helpers as every other heavy endpoint in
// functions/src/index.ts via dynamic re-export (see end of file).

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import cors from 'cors';

import { SYSTEM_PROMPT } from './assistant/systemPrompt';
import { TOOL_DEFINITIONS, isReadTool, isProposalTool } from './assistant/toolSchemas';
import {
  findCustomer,
  getQuote,
  listRecentQuotes,
  getBusinessDefaults,
} from './assistant/readTools';
import { buildProposal, Proposal } from './assistant/proposalTools';
import { generateMessageId } from './assistant/ids';

const corsHandler = cors({ origin: true });
const db = () => admin.firestore();

// Model identifiers. Haiku is the everyday driver; Sonnet is the retry head
// for hard turns. Keep these as module-level constants so a future swap is a
// one-line edit and the cache key for the system prompt stays stable.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const ESCALATION_MODEL = 'claude-sonnet-4-6';

const MAX_TOOL_ROUNDS = 6;
const MAX_OUTPUT_TOKENS = 2048;
const MAX_INCOMING_TURNS = 20;

// Daily per-user quotas. The dashboard banner picks these up via the usage doc.
const QUOTA = {
  free: { turns: 20, outputTokens: 5_000 },
  trial: { turns: 200, outputTokens: 50_000 },
  pro: { turns: 200, outputTokens: 50_000 },
};

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  messages: ChatTurn[];
}

interface RateLimitConfig { maxRequests: number; windowMs: number }
const HEAVY: RateLimitConfig = { maxRequests: 10, windowMs: 60_000 };

async function verifyAuth(req: functions.https.Request, res: functions.Response): Promise<admin.auth.DecodedIdToken | null> {
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

async function checkRateLimit(key: string, cfg: RateLimitConfig, res: functions.Response): Promise<boolean> {
  const now = Date.now();
  const ref = db().collection('rateLimits').doc(key);
  try {
    const ok = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      let timestamps: number[] = snap.data()?.timestamps ?? [];
      timestamps = timestamps.filter((t) => t > now - cfg.windowMs);
      if (timestamps.length >= cfg.maxRequests) return false;
      timestamps.push(now);
      tx.set(ref, { timestamps, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
    if (!ok) { res.status(429).json({ error: 'Too many requests. Please try again later.' }); return false; }
    return true;
  } catch {
    return true; // fail open — same as the other endpoints
  }
}

async function getEffectivePlan(uid: string): Promise<'free' | 'trial' | 'pro'> {
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

interface UsageDoc {
  turns: number;
  outputTokens: number;
  inputTokens: number;
  updatedAt: admin.firestore.FieldValue;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function checkAndReserveQuota(uid: string, plan: 'free' | 'trial' | 'pro'): Promise<{ ok: true } | { ok: false; reason: string }> {
  const limit = QUOTA[plan];
  const ref = db().doc(`users/${uid}/assistantUsage/${todayKey()}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.data() as Partial<UsageDoc>) || {};
    const turns = (data.turns ?? 0) + 1;
    if (turns > limit.turns) {
      return { ok: false, reason: `You've hit today's Mate limit (${limit.turns} turns). It resets at midnight UTC.` } as const;
    }
    if ((data.outputTokens ?? 0) >= limit.outputTokens) {
      return { ok: false, reason: 'You\'ve hit today\'s Mate output limit. It resets at midnight UTC.' } as const;
    }
    tx.set(
      ref,
      {
        turns,
        outputTokens: data.outputTokens ?? 0,
        inputTokens: data.inputTokens ?? 0,
        plan,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true } as const;
  });
}

async function recordUsage(uid: string, inputTokens: number, outputTokens: number): Promise<void> {
  const ref = db().doc(`users/${uid}/assistantUsage/${todayKey()}`);
  await ref.set(
    {
      inputTokens: admin.firestore.FieldValue.increment(inputTokens),
      outputTokens: admin.firestore.FieldValue.increment(outputTokens),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

// Anthropic content block shapes — typed loosely because the SDK isn't a dep here.
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: any; is_error?: boolean };

interface AnthropicResponse {
  id: string;
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
}

async function callAnthropic(args: {
  apiKey: string;
  model: string;
  messages: any[];
}): Promise<AnthropicResponse> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': args.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: TOOL_DEFINITIONS,
      messages: args.messages,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText}`);
  }
  return (await res.json()) as AnthropicResponse;
}

async function executeReadTool(uid: string, name: string, input: any): Promise<unknown> {
  switch (name) {
    case 'find_customer':
      return findCustomer(uid, input);
    case 'list_recent_quotes':
      return listRecentQuotes(uid, input);
    case 'get_quote':
      return getQuote(uid, input);
    case 'get_business_defaults':
      return getBusinessDefaults(uid);
    default:
      return { error: `Unknown read tool ${name}` };
  }
}

export const assistantChat = functions
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

      const decodedToken = await verifyAuth(req, res);
      if (!decodedToken) return;
      const ok = await checkRateLimit(`user:${decodedToken.uid}`, HEAVY, res);
      if (!ok) return;
      const uid = decodedToken.uid;

      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicApiKey) { res.status(500).json({ error: 'Mate is offline (no API key).' }); return; }

      const body = (req.body || {}) as ChatRequest;
      const incoming = Array.isArray(body.messages) ? body.messages : [];
      if (incoming.length === 0) { res.status(400).json({ error: 'Missing messages[].' }); return; }
      // Take only the last N turns to keep input small + predictable.
      const trimmed = incoming.slice(-MAX_INCOMING_TURNS).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, 6000),
      }));

      const plan = await getEffectivePlan(uid);
      const quota = await checkAndReserveQuota(uid, plan);
      if (!quota.ok) { res.status(402).json({ error: quota.reason, code: 'QUOTA_EXCEEDED' }); return; }

      const conversation: any[] = trimmed.map((m) => ({ role: m.role, content: m.content }));
      const proposals: Proposal[] = [];
      let assistantText = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let model = DEFAULT_MODEL;
      let escalated = false;

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
          let response: AnthropicResponse;
          try {
            response = await callAnthropic({ apiKey: anthropicApiKey, model, messages: conversation });
          } catch (err: any) {
            if (!escalated && /max_tokens|parse|invalid/i.test(String(err?.message || ''))) {
              model = ESCALATION_MODEL;
              escalated = true;
              response = await callAnthropic({ apiKey: anthropicApiKey, model, messages: conversation });
            } else {
              throw err;
            }
          }
          totalInputTokens += response.usage.input_tokens || 0;
          totalOutputTokens += response.usage.output_tokens || 0;

          // Collect text and proposals from this turn.
          const toolResults: any[] = [];
          let hasToolUse = false;
          for (const block of response.content) {
            if (block.type === 'text') {
              assistantText += (assistantText ? '\n' : '') + block.text;
            } else if (block.type === 'tool_use') {
              if (isProposalTool(block.name)) {
                const { proposal, error } = buildProposal(block.name, block.id, block.input);
                if (proposal) {
                  proposals.push(proposal);
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: JSON.stringify({ ok: true, proposalId: proposal.id }),
                  });
                } else {
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    is_error: true,
                    content: JSON.stringify({ error }),
                  });
                }
                hasToolUse = true;
              } else if (isReadTool(block.name)) {
                let result: unknown;
                try {
                  result = await executeReadTool(uid, block.name, block.input || {});
                } catch (err: any) {
                  result = { error: err?.message || 'Tool execution failed.' };
                }
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: JSON.stringify(result),
                });
                hasToolUse = true;
              } else {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  is_error: true,
                  content: JSON.stringify({ error: `Unknown tool ${block.name}` }),
                });
                hasToolUse = true;
              }
            }
          }

          // Echo the assistant turn back into the conversation, then user turn with results.
          conversation.push({ role: 'assistant', content: response.content });
          if (hasToolUse) {
            conversation.push({ role: 'user', content: toolResults });
          }

          if (response.stop_reason !== 'tool_use') break;
        }
      } catch (err: any) {
        await recordUsage(uid, totalInputTokens, totalOutputTokens);
        res.status(502).json({ error: 'Mate is offline — try again in a moment.', detail: err?.message });
        return;
      }

      await recordUsage(uid, totalInputTokens, totalOutputTokens);

      res.status(200).json({
        messageId: generateMessageId(),
        text: assistantText.trim(),
        proposals,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          model,
          escalated,
        },
      });
    });
  });
