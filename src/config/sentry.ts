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
 */
export const SENTRY_IGNORE_ERRORS: (string | RegExp)[] = [
  /Failed to execute '(set|release)PointerCapture' on 'Element'/,
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

/** Root-component wrapper: captures fatal render/runtime errors. */
export const wrapRootComponent: <P extends Record<string, unknown>>(
  component: React.ComponentType<P>,
) => React.ComponentType<P> = (component) =>
  shouldEnableSentry(SENTRY_DSN, __DEV__) ? Sentry.wrap(component) : component;
