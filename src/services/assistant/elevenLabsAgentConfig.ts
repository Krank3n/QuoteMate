// Pure repo → ElevenLabs agent config conversion.
//
// Mate's tools are declared once, in toolSchemas.ts, in Gemini's OpenAPI-ish
// dialect. ElevenLabs wants near-identical JSON Schema, so this is mostly a
// pass-through — the value is entirely in the edge cases, which is why it's a
// pure module with tests rather than inline logic in the sync script.
//
// Nothing here touches the network, the filesystem, or process.env. The script
// at scripts/syncMateAgent.ts does the I/O; this decides WHAT to send.
//
// No node:crypto import on purpose: this file sits under src/ and must stay
// importable from anywhere without dragging Node built-ins into a bundle.

import {
  ALL_TOOL_DECLARATIONS,
  GeminiFunctionDeclaration,
  TOOL_RUNTIME,
} from './toolSchemas';
import { MATE_SYSTEM_PROMPT } from './systemPrompt';

/** The LLM the agent runs. Verify against the create-agent enum before shipping. */
export const AGENT_LLM = 'claude-sonnet-5';

/**
 * Hard ceiling on a single conversation, set on the AGENT (not per session).
 * `conversation.max_duration_seconds` is not in the documented per-conversation
 * override list, so the agent-level value is the one guaranteed to bite. Set it
 * to the most generous plan allowance; tighter per-plan limits are enforced by
 * the daily voice-second budget server-side and a client-side timer.
 */
export const AGENT_MAX_DURATION_SECONDS = 900;

/**
 * Silence after which the agent hangs up on its own. The API default is -1
 * (never), which means a phone left connected in a ute pocket bills at
 * $0.08/min until the daily budget stops it. 60s of dead air is over.
 */
export const AGENT_SILENCE_END_CALL_SECONDS = 60;

/**
 * How long the agent sits through SILENCE before taking a turn of its own.
 *
 * Not the end-of-utterance threshold — that was my misreading, and a device
 * test caught it. At 2s Mate filled every gap: five unprompted turns in the
 * first 32 seconds of a session where nobody said anything ("Still there?",
 * "Just checking in", "I'll be here when you're ready"). A tradie holding a
 * tape measure would be interrupted before they got the reading out.
 *
 * How fast Mate answers once the tradie HAS spoken is turn_eagerness, below.
 * These are two different knobs and only one of them is about latency.
 */
export const AGENT_TURN_TIMEOUT_SECONDS = 20;

/**
 * How readily Mate takes a turn once the tradie is talking.
 *
 * 'patient' was the instinct — worksite speech has long pauses in it — but a
 * real conversation measured 2-5 seconds from the tradie finishing to Mate
 * answering, and it read as sluggish. Most of that is end-of-speech detection,
 * which is exactly what this knob governs.
 *
 * 'normal' buys the latency back. The risk it reintroduces is cutting in on a
 * mid-measurement pause; if that shows up, the fix is here rather than
 * turn_timeout, which only ever fires on total silence.
 */
export const AGENT_TURN_EAGERNESS = 'normal';

/**
 * TTS model.
 *
 * The default was eleven_flash_v2 — the fastest and flattest of them, tuned
 * for latency over delivery. It came across as, in the tradie's words, "a
 * little unhappy". v3 Conversational is the expressive one.
 *
 * This costs some latency, which is why turn_eagerness moved back to 'normal'
 * in the same change: paying for warmth out of the turn-detection budget
 * rather than adding it on top.
 */
export const AGENT_TTS_MODEL = 'eleven_v3_conversational';

/**
 * Lower stability means more variation in delivery; higher flattens it toward
 * monotone. 0.5 with a latency-first model is what "unhappy" sounded like.
 * Nudged down for warmth, not so far that a noisy worksite gets an unreliable
 * read of the numbers.
 */
export const AGENT_TTS_STABILITY = 0.4;
export const AGENT_TTS_SIMILARITY_BOOST = 0.8;

/**
 * ASR keyword boosting — the highest-leverage setting in the migration, and one
 * with no Gemini equivalent. The system prompt already documents that line names
 * arrive mangled ("weight belt" for "weed mat", "brick wash" for "brickwork");
 * this is the lever that stops it at the transcription layer instead of asking
 * the model to guess.
 *
 * Capped at 50 by the API. Kept under that deliberately so a session can spend
 * the remainder on the tradie's own customer surnames.
 */
export const MATE_ASR_KEYWORDS: string[] = [
  // Deliberately SHORT. The cap is 50 for the whole list, and a real
  // transcript showed where the budget is better spent: "Geraldine Luffaga"
  // came back as "Jared Dane" twice and the tradie ended up spelling it out,
  // furious. Names are what ASR actually loses, so most of the budget goes to
  // the tradie's own contacts at session start — see buildSessionAsrKeywords.
  //
  // What survives here is only vocabulary a general model would not have:
  // words that are odd, trade-specific, or Australian. "quote", "invoice" and
  // "GST" were dropped — a speech model has no trouble with those, and every
  // slot they occupied is a customer whose name gets mangled.
  'Bunnings', 'Reece', 'Colorbond', 'Gyprock', 'Villaboard',
  'weed mat', 'brickwork', 'cornice', 'architrave', 'noggin',
  'purlin', 'sarking', 'reo mesh', 'lintel', 'screed',
  'LVL', 'CFC sheet', 'lineal metre', 'PC sum', 'provisional sum',
];

/** Slots reserved for the tradie's own contacts. See buildSessionAsrKeywords. */
export const ASR_NAME_BUDGET = 30;

/**
 * Words too common to be worth a keyword slot, and too common to be a useful
 * boost even when they ARE part of a name.
 */
const COMMON_NAME_TOKENS = new Set([
  'the', 'and', 'pty', 'ltd', 'inc', 'group', 'services', 'and sons',
  'mr', 'mrs', 'ms', 'dr', 'building', 'constructions', 'homes',
]);

/**
 * The keyword list for one session: trade vocabulary plus this tradie's own
 * customer names, capped at what the API accepts.
 *
 * The names are the point. A generic speech model has never heard of Luffaga,
 * and getting a customer's name wrong on a quote is both the most likely
 * failure and the most annoying one — it happened twice in a single 313-second
 * conversation and cost five turns and a spelling-out to recover.
 *
 * Most recent contacts first, since the person being quoted today is far more
 * likely to be someone recently dealt with than one of 500 historical rows.
 */
export function buildSessionAsrKeywords(contactNames: string[]): string[] {
  const out: string[] = [...MATE_ASR_KEYWORDS];
  const seen = new Set(out.map((k) => k.toLowerCase()));
  let added = 0;

  for (const full of contactNames) {
    if (added >= ASR_NAME_BUDGET || out.length >= MAX_ASR_KEYWORDS) break;
    for (const token of String(full || '').split(/[\s,]+/)) {
      const word = token.replace(/[^\p{L}'-]/gu, '').trim();
      if (word.length < 3) continue;                       // initials boost nothing
      const key = word.toLowerCase();
      if (COMMON_NAME_TOKENS.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(word);
      added++;
      if (added >= ASR_NAME_BUDGET || out.length >= MAX_ASR_KEYWORDS) break;
    }
  }
  return out.slice(0, MAX_ASR_KEYWORDS);
}

/** Max ASR keywords the API accepts per agent / per conversation. */
export const MAX_ASR_KEYWORDS = 50;

// ---------------------------------------------------------------------------
// Schema conversion
// ---------------------------------------------------------------------------

export interface ElevenLabsSchema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  properties?: Record<string, ElevenLabsSchema>;
  required?: string[];
  enum?: string[];
  items?: ElevenLabsSchema;
}

export interface ElevenLabsClientTool {
  type: 'client';
  name: string;
  description: string;
  /**
   * ALWAYS true. The API defaults this to false, which fires the call and moves
   * on without the result — for a read tool that is Mate inventing the answer.
   */
  expects_response: true;
  response_timeout_secs: number;
  parameters: ElevenLabsSchema;
}

/**
 * "quoteId" → "Quote id.", "customerDraft" → "Customer draft."
 *
 * Several declarations leave leaf properties undescribed (every field of
 * propose_create_contact, propose_add_line_item.quoteId). A humanised name beats
 * an absent description for prompt quality, and it sidesteps any agent-side
 * validation that insists on one.
 */
export function humanisePropertyName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!words) return 'Value.';
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
}

/**
 * Convert one Gemini schema node. Recurses through objects and arrays, keeping
 * each nested object's own `required` (propose_draft_quote.customerDraft
 * requires `name`, and losing that would let Mate draft a nameless contact).
 *
 * Only known keys are emitted, so a future Gemini-ism added upstream can't leak
 * into the agent config unnoticed.
 */
export function toElevenLabsSchema(
  node: any,
  propertyName?: string,
): ElevenLabsSchema {
  const out: ElevenLabsSchema = { type: node?.type || 'object' };

  const description = node?.description || (propertyName ? humanisePropertyName(propertyName) : undefined);
  if (description) out.description = description;

  if (Array.isArray(node?.enum)) out.enum = [...node.enum];

  if (out.type === 'object') {
    const props = node?.properties || {};
    out.properties = {};
    for (const key of Object.keys(props)) {
      out.properties[key] = toElevenLabsSchema(props[key], key);
    }
    // Always emit an array, never undefined — `required: []` and an absent
    // `required` are the same thing semantically but different to a fingerprint,
    // and the difference would show up as permanent phantom drift in --check.
    out.required = Array.isArray(node?.required) ? [...node.required] : [];
  }

  if (out.type === 'array' && node?.items) {
    const items = toElevenLabsSchema(node.items);
    // Array item schemas have no property name to humanise, and the API
    // rejects a node with no description outright:
    //   "Must set one of: description, dynamic_variable, is_system_provided,
    //    constant_value, or is_omitted"
    // — a 422 on tool creation, so the whole agent fails to provision rather
    // than degrading quietly. Verified against the live API.
    if (!items.description) {
      items.description = propertyName
        ? `One entry in ${humanisePropertyName(propertyName).replace(/\.$/, '').toLowerCase()}.`
        : 'One entry in the list.';
    }
    out.items = items;
  }

  return out;
}

/** One Mate tool declaration → one ElevenLabs client tool config. */
export function toElevenLabsTool(decl: GeminiFunctionDeclaration): ElevenLabsClientTool {
  const runtime = TOOL_RUNTIME[decl.name];
  if (!runtime) {
    throw new Error(
      `No TOOL_RUNTIME entry for "${decl.name}". Add one in toolSchemas.ts — a tool ` +
        `without a declared timeout is a tool nobody decided a budget for.`,
    );
  }
  return {
    type: 'client',
    name: decl.name,
    description: decl.description,
    expects_response: true,
    response_timeout_secs: runtime.timeoutSecs,
    parameters: toElevenLabsSchema(decl.parameters),
  };
}

/** Every tool the agent should know about, converted. */
export function buildAgentToolConfigs(): ElevenLabsClientTool[] {
  return ALL_TOOL_DECLARATIONS.map(toElevenLabsTool);
}

// ---------------------------------------------------------------------------
// Fingerprinting — drives the sync script's create/patch/skip decision
// ---------------------------------------------------------------------------

/** Deterministic JSON: object keys sorted at every depth. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * FNV-1a over the stable serialisation. Not cryptographic — it only has to
 * change when the tool changes and stay put when it doesn't, so a collision
 * costs a skipped PATCH, not a security problem. Avoids a node:crypto import.
 */
export function toolFingerprint(tool: unknown): string {
  const s = stableStringify(tool);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Agent patch
// ---------------------------------------------------------------------------

export interface AgentPatchOptions {
  toolIds: string[];
  voiceId: string;
  /** Set only when overriding the default; the API picks a sensible TTS model. */
  ttsModelId?: string;
  firstMessage: string;
}

/**
 * The PATCH body for /v1/convai/agents/{id}.
 *
 * `platform_settings.overrides` enables exactly the fields the client actually
 * sends and nothing else — every enabled override is a field anyone holding a
 * conversation token can rewrite. tts.* and conversation.text_only buy the
 * server nothing and stay off.
 */
export function buildAgentPatch(opts: AgentPatchOptions) {
  return {
    conversation_config: {
      agent: {
        prompt: {
          prompt: MATE_SYSTEM_PROMPT,
          llm: AGENT_LLM,
          tool_ids: [...opts.toolIds].sort(),
        },
        first_message: opts.firstMessage,
        language: 'en',
      },
      conversation: {
        max_duration_seconds: AGENT_MAX_DURATION_SECONDS,
        text_only: false,
      },
      turn: {
        turn_timeout: AGENT_TURN_TIMEOUT_SECONDS,
        turn_eagerness: AGENT_TURN_EAGERNESS,
        silence_end_call_timeout: AGENT_SILENCE_END_CALL_SECONDS,
      },
      asr: {
        keywords: MATE_ASR_KEYWORDS.slice(0, MAX_ASR_KEYWORDS),
      },
      tts: {
        voice_id: opts.voiceId,
        model_id: opts.ttsModelId ?? AGENT_TTS_MODEL,
        stability: AGENT_TTS_STABILITY,
        similarity_boost: AGENT_TTS_SIMILARITY_BOOST,
        speed: 1.0,
      },
    },
    platform_settings: {
      auth: {
        // Only tokens minted by assistantToken can open a session. Without this
        // anyone holding the agent id can run up the bill.
        enable_auth: true,
      },
      overrides: {
        conversation_config_override: {
          agent: {
            prompt: { prompt: true },
            first_message: true,
          },
          asr: { keywords: true },
        },
      },
    },
  };
}
