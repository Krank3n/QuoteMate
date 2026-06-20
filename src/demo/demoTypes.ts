// Shared types for the marketing demo playback harness (src/demo/demoPlayback.ts)
// and the offline driver that authors payloads (marketing-video/driver). Pure
// types only — safe to import from a plain Node/tsx script.
import { Quote } from '../types';

export interface DemoWorkingPhase {
  phase: 'preflight' | 'analyzing' | 'building' | 'pricing' | 'done' | 'failed';
  status: string;
  detail?: string;
  /** How long this phase is shown before advancing, ms. */
  ms: number;
}

export type DemoEvent =
  // Customer/tradie message bubble.
  | { kind: 'user'; text: string; delayMs?: number }
  // Mate reply — typed out character-by-character like a real streamed turn.
  // `vo` names a voiceover clip; `holdMs` keeps the bubble on screen that long
  // after typing so the spoken line can finish before the chat moves on.
  | { kind: 'assistant'; text: string; typeMs?: number; delayMs?: number; vo?: string; holdMs?: number }
  // The live "working" pipeline card, advanced through its phases.
  | { kind: 'working'; phases: DemoWorkingPhase[]; delayMs?: number }
  // Final reveal — an assistant bubble that renders the priced quote inline.
  | { kind: 'reveal'; quoteId: string; text?: string; delayMs?: number; vo?: string; holdMs?: number };

// One spoken event, captured at record time. `t` is wall-clock ms (Date.now);
// the capture script converts it to a video-relative offset for the compositor.
export interface DemoTimelineMark {
  vo: string;
  t: number;
}

export interface DemoOptions {
  /** Typewriter speed for assistant text, ms per character. */
  typingMsPerChar?: number;
  /** Default gap between events, ms. */
  betweenMs?: number;
  /** Initial pause before the first message, ms. */
  startDelayMs?: number;
}

export interface DemoPayload {
  /** Seeded into store.quotes so the `reveal` event can render it inline. */
  quote: Quote;
  events: DemoEvent[];
  options?: DemoOptions;
}
