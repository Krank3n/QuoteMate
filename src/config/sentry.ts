/**
 * Crash reporting (Sentry).
 *
 * Exists because of the July 2026 ghost-job incident: a fatal JS render
 * error closed the app on every open for a real user and the only trace
 * was a message-stripped JavascriptException in Play vitals — hours of
 * blind diagnosis that one crash report would have made a one-liner.
 *
 * SENTRY_DSN is a public client identifier (not a secret) — committing it
 * is standard. Empty DSN → initSentry() is a no-op, so the app runs
 * normally in forks/CI without a Sentry project.
 */
import * as Sentry from '@sentry/react-native';

// From the Sentry project's "Client Keys (DSN)" settings page
// (org hansendev-0p, project react-native).
export const SENTRY_DSN =
  'https://7146851bfa0ff7f9f48d88aa693acb11@o4511709818781696.ingest.us.sentry.io/4511709865639936';

/** Report only from real builds that actually have a project to report to. */
export function shouldEnableSentry(dsn: string, isDev: boolean): boolean {
  return dsn.length > 0 && !isDev;
}

/**
 * Known-benign errors we deliberately don't report.
 *
 * Pointer capture (REACT-NATIVE-5): thrown by react-native-web's internal
 * ResponderEventPlugin on web when a pointer is already gone by the time it
 * calls set/releasePointerCapture (fast flick, touch cancel, unmount
 * mid-gesture). No first-party frame, the browser auto-releases capture,
 * and the drag/slider interaction still completes — pure noise.
 *
 * Fetch abort (sentry-7720411163, ticket #173): a browser/SDK-native fetch
 * abort on the web /app build — the request is cancelled by navigating away,
 * closing the tab, or a third-party SDK's own cancellation. Our only
 * first-party AbortController (fetchWithTimeout in services/assistant/
 * liveSession.ts) already catches its own abort and converts it to a
 * LiveOfflineError, so a raw "AbortError: The user aborted a request" has no
 * first-party frame and is auto-captured by Sentry's global unhandledrejection
 * handler — pure noise. The regex matches the exact production message only.
 *
 * chrome.storage (sentry-7697477367, ticket #127): TypeError "undefined is not
 * an object (evaluating 'chrome.storage[n].get')". chrome.storage is a
 * Chrome-extension-only API — ordinary page/app JS (our react-native-web
 * bundle in a browser) cannot reach it. So this can only be a user's browser
 * extension injecting a content script that Sentry's global handler
 * misattributes to our page — never a first-party bug. Stack is fully
 * minified with no first-party frame, confirming it.
 *
 * Firebase Auth IndexedDB teardown (sentry-7676030309, ticket #97): thrown
 * deep inside the minified Auth SDK's indexedDBLocalPersistence (oi._openDb →
 * initializeCurrentUser) when the tab or webview is closing/hidden (tab close,
 * bfcache, backgrounding) mid-read. Web-only: native persistence is
 * AsyncStorage, which never touches IndexedDB. It's a benign SDK-internal
 * bootstrap race with no data loss and no reachable first-party call site —
 * our onAuthStateChanged handler never sees it. Only the exact observed
 * phrasing is matched so genuine IndexedDB faults (quota exceeded, corruption,
 * permission denial, forced deletion) still report.
 *
 * Reason-less abort (sentry-7720476730, ticket #176): "AbortError: signal is
 * aborted without reason" is thrown by the ElevenLabs/LiveKit voice-session
 * SDK's own WebRTC teardown (@elevenlabs/client over livekit-client) calling
 * controller.abort() with no reason during disconnect/reconnect on the web
 * voice path. No first-party frame — our only AbortController (fetchWithTimeout
 * in services/assistant/liveSession.ts) catches its own abort — so this is a
 * dangling rejection from the SDK's internals. Scoped to the exact reason-less
 * phrasing so a genuine first-party AbortError still reports.
 */
export const SENTRY_IGNORE_ERRORS: (string | RegExp)[] = [
  /Failed to execute '(set|release)PointerCapture' on 'Element'/,
  /AbortError: The user aborted a request/,
  /undefined is not an object \(evaluating 'chrome\.storage[^']*\.(get|set|remove)'\)/,
  /Database is closing(\/hidden)?/,
  /signal is aborted without reason/i,
];

export function initSentry(): void {
  if (!shouldEnableSentry(SENTRY_DSN, __DEV__)) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    // Crash visibility only: no performance tracing, no session replay,
    // no PII. Keep the payload to stack traces + device context.
    sendDefaultPii: false,
    tracesSampleRate: 0,
    ignoreErrors: SENTRY_IGNORE_ERRORS,
  });
}

/**
 * Report a non-fatal operational problem.
 *
 * Exists for the splash-gate timeout: the normal analytics channel
 * (analyticsService.trackEvent) writes to Firestore, so if a hung Firestore
 * read is what stalled the gate, the event describing the stall cannot land
 * either — and on native there is no GA fallback. Sentry is a separate
 * transport, which makes it the only channel guaranteed to survive the exact
 * failure it is reporting.
 *
 * Never throws: diagnostics must not become the outage.
 */
export function reportIssue(message: string, context?: Record<string, unknown>): void {
  if (!shouldEnableSentry(SENTRY_DSN, __DEV__)) return;
  try {
    Sentry.captureMessage(message, {
      level: 'warning',
      extra: context,
    });
  } catch {
    // swallow
  }
}

/** Root-component wrapper: captures fatal render/runtime errors. */
export const wrapRootComponent: <P extends Record<string, unknown>>(
  component: React.ComponentType<P>,
) => React.ComponentType<P> = (component) =>
  shouldEnableSentry(SENTRY_DSN, __DEV__) ? Sentry.wrap(component) : component;
