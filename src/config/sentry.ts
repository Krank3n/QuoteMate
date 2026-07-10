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

// From the Sentry project's "Client Keys (DSN)" settings page.
export const SENTRY_DSN = '';

/** Report only from real builds that actually have a project to report to. */
export function shouldEnableSentry(dsn: string, isDev: boolean): boolean {
  return dsn.length > 0 && !isDev;
}

export function initSentry(): void {
  if (!shouldEnableSentry(SENTRY_DSN, __DEV__)) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    // Crash visibility only: no performance tracing, no session replay,
    // no PII. Keep the payload to stack traces + device context.
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}

/** Root-component wrapper: captures fatal render/runtime errors. */
export const wrapRootComponent: <P extends Record<string, unknown>>(
  component: React.ComponentType<P>,
) => React.ComponentType<P> = (component) =>
  shouldEnableSentry(SENTRY_DSN, __DEV__) ? Sentry.wrap(component) : component;
