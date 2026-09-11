// Shared Gemini Live transport plumbing.
//
// Both the single-shot text path (assistantService.sendAssistantTurn) and the
// long-lived voice path (voiceSession.openVoiceSession) open the same
// BidiGenerateContent socket off a single-use ephemeral token. The token mint,
// the endpoint constants, and the error trio those paths surface all live here
// so the two transports can't drift on auth, quota, or offline handling.

import { NativeModules, Platform } from 'react-native';
import { auth } from '../../config/firebase';

const USE_EMULATOR = process.env.USE_FIREBASE_EMULATOR === 'true';
export const FIREBASE_FUNCTIONS_URL = USE_EMULATOR
  ? 'http://127.0.0.1:5001/hansendev/us-central1'
  : 'https://us-central1-hansendev.cloudfunctions.net';

export const LIVE_WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

// Cap on prior turns seeded into a session — keeps the setup frame small.
export const MAX_HISTORY_TURNS = 20;

/** Not signed in — the mint needs a Firebase ID token. */
export class LiveAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveAuthError';
  }
}

/** Daily Mate quota exhausted (HTTP 402 from assistantToken). */
export class LiveQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveQuotaError';
  }
}

/** Network/transport problem, rate-limit, or a bad token response. */
export class LiveOfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveOfflineError';
  }
}

/**
 * The token mint was rate-limited — the server returned 429, or we throttled
 * ourselves client-side before hammering it. A subclass of LiveOfflineError so
 * every existing `instanceof LiveOfflineError` handler still surfaces the
 * message, while the voice reconnect loop can single it out and stop re-minting
 * (retrying into a rate limit only deepens it).
 */
/**
 * A non-Gemini transport could not be established at all.
 *
 * Distinct from LiveOfflineError because it is ACTIONABLE: the provider the
 * server nominated is unusable for this session, but Gemini Live may well be
 * fine, so openVoiceSession retries there rather than showing the tradie
 * "Voice mode is offline". Anything that leaves the tradie able to talk to
 * Mate beats a correct error message.
 *
 * Born from a real outage: the OpenAI key ran out of credits while a 50%
 * rollout was live. Minting kept returning 200 — a client secret costs nothing
 * to issue — so the server had no idea, handed out openai tokens as usual, and
 * every one of those sessions died on the first frame with no way back.
 */
export class VoiceTransportUnavailableError extends LiveOfflineError {
  constructor(message: string, readonly provider: string) {
    super(message);
    this.name = 'VoiceTransportUnavailableError';
  }
}

export class LiveRateLimitError extends LiveOfflineError {
  constructor(message: string) {
    super(message);
    this.name = 'LiveRateLimitError';
  }
}

/**
 * What the mint returns depends on which voice provider the SERVER picked for
 * this user — the client does not choose. That indirection is the rollback
 * mechanism: moving everyone back to Gemini Live is a Firestore edit plus a
 * functions deploy, with no app-store release in the loop.
 */
export interface GeminiMintedToken {
  provider?: 'gemini';
  token: string;
  model: string;
  expiresAt?: string;
}

export interface ElevenLabsMintedToken {
  provider: 'elevenlabs';
  /** LiveKit conversation token — WebRTC only; the RN SDK rejects signed URLs. */
  token: string;
  model: string;
  agentId: string;
  /** Ties the session to the server's voiceSessions row for cost reconciliation. */
  conversationId: string;
  /** Client-side backstop for the agent's own duration ceiling. */
  maxDurationSeconds: number;
  heldSeconds: number;
  remainingVoiceSeconds: number;
}

export interface OpenAiMintedToken {
  provider: 'openai';
  /** Ephemeral client secret — the API key never reaches the device. */
  token: string;
  /** What the socket connects with, e.g. `gpt-realtime-2.1`. */
  model: string;
  /**
   * How the same model is keyed in cost records — `openai/<model>`, compound
   * so voice spend stays separable on the daily doc. The settle call sends
   * this, not `model`; the server prefers its own recorded label anyway.
   */
  modelLabel?: string;
  /** OpenAI's own TTS voice name for the session. */
  voice?: string;
  /**
   * Server-minted session id. OpenAI returns none of its own, so assistantToken
   * makes one and writes the voiceSessions row against it — which is what makes
   * the end-of-session settle idempotent and lets the server settle the hold
   * against the plan it actually minted under.
   */
  conversationId?: string;
  maxDurationSeconds: number;
  heldSeconds: number;
  remainingVoiceSeconds: number;
}

export type MintedToken = GeminiMintedToken | ElevenLabsMintedToken | OpenAiMintedToken;

export function isElevenLabsMint(m: MintedToken): m is ElevenLabsMintedToken {
  return m.provider === 'elevenlabs';
}

export function isOpenAiMint(m: MintedToken): m is OpenAiMintedToken {
  return m.provider === 'openai';
}

/**
 * Transports this build can actually open. Sent on every voice mint so the
 * server can never hand this client a token it wouldn't know what to do with —
 * a capability handshake rather than version parsing. Builds before 1.56 send
 * nothing at all and are therefore always served Gemini.
 *
 * Checked against the BINARY, not the bundle. runtimeVersion: appVersion is
 * supposed to stop this JS reaching a build without LiveKit, but that's a
 * version-discipline promise and this is a one-line verification. Claiming a
 * transport the binary can't open costs the tradie their session and a quota
 * turn before anyone finds out, so it's worth not relying on the promise.
 *
 * WebRTCModule is what both @livekit/react-native-webrtc platforms register.
 */
export function voiceClientCapabilities(): string[] {
  // Browsers ship WebRTC; @elevenlabs/client uses it directly, no native module.
  // OpenAI Realtime rides the same PCM WebSocket path the Gemini transport
  // uses, so it needs no native module beyond the mic — unlike ElevenLabs,
  // which needs LiveKit's WebRTC linked into this binary.
  if (Platform.OS === 'web') return ['elevenlabs', 'openai'];
  return NativeModules?.WebRTCModule ? ['elevenlabs', 'openai'] : ['openai'];
}

// Per-request ceilings. Without these a half-open connection (walking out of
// coverage mid-request) stalls the whole turn forever — fetch never rejects
// on its own. Chat gets headroom for a long tool-laden reply (the server
// function itself caps at 60s); the token mint is a sub-second endpoint.
export const CHAT_TIMEOUT_MS = 45_000;
export const MINT_TIMEOUT_MS = 15_000;

/** fetch that rejects with LiveOfflineError when timeoutMs elapses. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (controller.signal.aborted) {
      throw new LiveOfflineError('Connection timed out — reception might be patchy.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Client-side mint throttle. The server caps ephemeral-token mints at 10/min
// per user (assistantToken's HEAVY rate limit). Under patchy coverage the voice
// reconnect loop fires up to a mint per attempt, and repeated drops — plus any
// AppState/focus-driven auto-restart — used to blow past that ceiling and spray
// the tradie with "too many requests" (each attempt also reserving a quota turn
// server-side). We pace ourselves just below the server ceiling: once this many
// mints land inside the rolling window, the next one fails fast client-side
// instead of hammering the endpoint. 8 leaves headroom under the server's 10
// while staying above what legit use reaches — rapid PTT turns run ~4-6/min
// (each turn is speak + full spoken reply), and a drop cycle is 1 open + 3
// reconnect mints, so two full drop cycles fit before the throttle bites.
const MINT_WINDOW_MS = 60_000;
const MINT_MAX_PER_WINDOW = 8;
let mintTimestamps: number[] = [];

/** Test-only: clear the rolling mint window between cases. */
export function __resetMintThrottle(): void {
  mintTimestamps = [];
}

// Drop timestamps that have aged out of the window, then report whether another
// mint is allowed right now.
function mintAllowed(now: number): boolean {
  mintTimestamps = mintTimestamps.filter((t) => now - t < MINT_WINDOW_MS);
  return mintTimestamps.length < MINT_MAX_PER_WINDOW;
}

// Mint a single-use ephemeral Gemini Live token via the assistantToken
// Function. `mode` distinguishes the voice quota bucket from text; omit it for
// the text path. The Function verifies the ID token, rate-limits, reserves a
// quota turn, and returns the token bound to the Live model.
export async function mintLiveToken(
  mode?: 'voice',
  opts: { excludeProviders?: string[] } = {},
): Promise<MintedToken> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new LiveAuthError('Sign in to use Mate.');

  // Self-limit before touching the network so a reconnect/restart storm can't
  // trip the server's 10/min mint ceiling. Record the attempt only once it
  // clears the throttle — a rejected call never left the device.
  const now = Date.now();
  if (!mintAllowed(now)) {
    throw new LiveRateLimitError('Whoa — too many requests. Wait a moment.');
  }
  mintTimestamps.push(now);

  // No retry here on purpose: the voice reconnect loop already retries whole
  // connect attempts, and each successful mint reserves a quota turn — a
  // nested retry would multiply mints under the caller's back.
  const url = `${FIREBASE_FUNCTIONS_URL}/assistantToken`;
  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        platform: Platform.OS,
        mode,
        // Declaring FEWER capabilities is how the client asks for a different
        // transport, and it needs no server change: decideVoiceProvider
        // already sends a client that cannot open the configured provider
        // home to Gemini (reason `client-cannot-<provider>`). Reusing that
        // path means the fallback is served by logic already in production
        // rather than a second, differently-shaped override.
        ...(mode === 'voice'
          ? { supports: voiceClientCapabilities().filter((c) => !opts.excludeProviders?.includes(c)) }
          : {}),
      }),
    }, MINT_TIMEOUT_MS);
  } catch (err: any) {
    if (err instanceof LiveOfflineError) throw err;
    throw new LiveOfflineError(err?.message || 'Network error.');
  }

  if (response.status === 402) {
    const data = await response.json().catch(() => ({}));
    throw new LiveQuotaError(data.error || "You've hit today's Mate limit.");
  }
  if (response.status === 429) {
    throw new LiveRateLimitError('Whoa — too many requests. Wait a moment.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new LiveOfflineError(data.error || `Mate is offline (${response.status}).`);
  }

  const data = (await response.json()) as MintedToken;
  if (!data?.token || !data?.model) {
    throw new LiveOfflineError('Mate is offline (bad token response).');
  }
  // An ElevenLabs mint without an agent id is unopenable — better to say Mate
  // is offline than to fail deep inside the SDK with a shapeless error.
  if (isElevenLabsMint(data) && !data.agentId) {
    throw new LiveOfflineError('Mate is offline (bad token response).');
  }
  return data;
}
