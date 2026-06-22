// Shared types for the marketing demo playback harness (src/demo/demoPlayback.ts)
// and the offline driver that authors payloads (marketing-video/driver). Pure
// types only — safe to import from a plain Node/tsx script.
import { BusinessSettings, Quote } from '../types';

export interface DemoWorkingPhase {
  phase: 'preflight' | 'analyzing' | 'building' | 'pricing' | 'done' | 'failed';
  status: string;
  detail?: string;
  /** How long this phase is shown before advancing, ms. */
  ms: number;
}

export type DemoEvent =
  // Customer/tradie message bubble. `vo` names a voiceover clip (spoken in the
  // human voice); `holdMs` keeps the bubble on screen that long so the spoken
  // line can finish before the chat moves on.
  | { kind: 'user'; text: string; delayMs?: number; vo?: string; holdMs?: number }
  // Mate reply — typed out character-by-character like a real streamed turn.
  // `vo` names a voiceover clip; `holdMs` keeps the bubble on screen that long
  // after typing so the spoken line can finish before the chat moves on.
  | { kind: 'assistant'; text: string; typeMs?: number; delayMs?: number; vo?: string; holdMs?: number }
  // The live "working" pipeline card, advanced through its phases.
  | { kind: 'working'; phases: DemoWorkingPhase[]; delayMs?: number }
  // Final reveal — an assistant bubble that renders the priced quote inline.
  | { kind: 'reveal'; quoteId: string; text?: string; delayMs?: number; vo?: string; holdMs?: number }
  // Tap "Preview PDF" on the quote card and slowly scroll the rendered document.
  // `pageW` is the CSS width the (fluid) PDF reflows to before being scaled to
  // fill the phone — smaller = taller, more to scroll. `vo` names a voiceover
  // spoken once the PDF is on screen; `holdMs` is the total time the PDF stays
  // up (filled from the clip duration at capture time).
  | { kind: 'previewPdf'; quoteId: string; pageW?: number; vo?: string; holdMs?: number; delayMs?: number };

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
  /** Optional demo business seeded into the store so the previewed PDF has a
   *  header (business name + contact). Capture-only; never reaches real users. */
  business?: Partial<BusinessSettings>;
  options?: DemoOptions;
}
