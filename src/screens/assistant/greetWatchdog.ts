// Decides whether a sticky session's greeting should be re-sent.
//
// The failure it exists for: a session opened right after the mic-permission
// grant connects, sits at Listening, and never greets — the permission
// dialog's AppState churn (or a Live hiccup, or a leak-filtered reply) eats
// the greet turn, and the tradie's first voice experience is dead air until
// the idle watchdog gives up. Seen 22 Aug and 25 Aug 2026, both times on the
// session immediately after the grant.
//
// The screen sends [greet], then arms a one-shot timer. When it fires, this
// decision runs: if the same session is still up, nothing from the assistant
// has rendered, and we haven't already retried, send the greet once more.
// A suppressed chain-of-thought reply deliberately does NOT count as heard —
// the retry is what turns a filtered leak into a spoken greeting instead of
// silence.
//
// Pure so the decision can be unit tested without a session.

/** How long a blank-slate session may sit silent before the greet is re-sent.
 *  Long enough for a slow first token over the Live socket, short enough
 *  that the tradie is still looking at the screen. */
export const GREET_RETRY_MS = 8000;

export interface GreetRetryState {
  /** The session the greet was sent on is still the live session. */
  sessionAlive: boolean;
  /** An assistant transcription has rendered since the greet was sent.
   *  Suppressed (leak-filtered) output must not set this. */
  greetHeard: boolean;
  /** A retry has already been sent for this session. One retry only —
   *  a session that eats two greets has a problem retrying won't fix. */
  alreadyRetried: boolean;
}

export function shouldRetryGreet(s: GreetRetryState): boolean {
  return s.sessionAlive && !s.greetHeard && !s.alreadyRetried;
}
