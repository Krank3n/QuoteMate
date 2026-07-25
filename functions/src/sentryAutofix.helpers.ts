/**
 * Pure helpers for the Sentry → autofix-agent webhook (sentryAutofix.ts).
 *
 * Flow: a Sentry issue alert (internal integration webhook) posts here; we
 * verify the signature, normalise the payload, and the caller opens a GitHub
 * issue + dispatches the agent.yml pipeline which fixes the bug and opens a PR.
 */
import * as crypto from 'crypto';

/** Normalised view of a Sentry alert payload, whatever shape it arrived in. */
export interface SentryBug {
  /** Sentry issue id — the dedupe key (one autofix dispatch per issue, ever). */
  issueId: string;
  title: string;
  culprit: string;
  permalink: string;
  environment: string;
  release: string;
  platform: string;
  /** "file:function:line" strings for the most relevant in-app frames. */
  topFrames: string[];
}

/**
 * Verify Sentry's `sentry-hook-signature` header: hex HMAC-SHA256 of the raw
 * request body keyed with the internal integration's client secret.
 */
export function verifySentrySignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Extract "file:function:line" for the last (= most relevant) in-app frames. */
function framesFromEvent(event: Record<string, any>, max = 5): string[] {
  const values = event?.exception?.values;
  const frames: Array<Record<string, any>> =
    (Array.isArray(values) && values[0]?.stacktrace?.frames) || [];
  const inApp = frames.filter((f) => f && f.in_app !== false);
  return (inApp.length ? inApp : frames)
    .slice(-max)
    .map((f) => `${f.filename || f.abs_path || '?'} : ${f.function || '?'} : line ${f.lineno ?? '?'}`);
}

/**
 * Normalise the webhook payload. Supports the two shapes Sentry sends to an
 * internal integration:
 *  - resource `event_alert` (issue alert "send a notification via …" action):
 *    `{ action: 'triggered', data: { event: {...} } }`
 *  - resource `issue` (Issue & Event webhooks, action `created`):
 *    `{ action: 'created', data: { issue: {...} } }`
 * Returns null for anything else (resolved/ignored actions, comments, pings).
 */
export function parseSentryAlert(payload: any, orgSlug: string): SentryBug | null {
  if (!payload || typeof payload !== 'object') return null;

  const event = payload.data?.event;
  if (payload.action === 'triggered' && event) {
    const issueId = String(event.issue_id ?? event.issue?.id ?? '');
    if (!issueId) return null;
    return {
      issueId,
      title: String(event.title || event.message || 'Unknown error'),
      culprit: String(event.culprit || ''),
      permalink: String(event.web_url || `https://${orgSlug}.sentry.io/issues/${issueId}/`),
      environment: String(event.environment || ''),
      release: String(event.release || ''),
      platform: String(event.platform || ''),
      topFrames: framesFromEvent(event),
    };
  }

  const issue = payload.data?.issue;
  if (payload.action === 'created' && issue) {
    const issueId = String(issue.id ?? '');
    if (!issueId) return null;
    return {
      issueId,
      title: String(issue.title || 'Unknown error'),
      culprit: String(issue.culprit || ''),
      permalink: String(issue.permalink || `https://${orgSlug}.sentry.io/issues/${issueId}/`),
      environment: '',
      release: '',
      platform: String(issue.platform || ''),
      topFrames: [],
    };
  }

  return null;
}

/** GitHub issue title for the agent queue. */
export function buildIssueTitle(bug: SentryBug): string {
  const title = bug.title.length > 100 ? `${bug.title.slice(0, 97)}...` : bug.title;
  return `[Sentry] ${title}`;
}

/**
 * GitHub issue body in the agent pipeline's expected format: the task spec
 * above the `---` divider, with a `qm-ticket` marker the agent copies into
 * the PR body verbatim (that is how the PR is traced back to this alert).
 */
export function buildIssueBody(bug: SentryBug): string {
  const facts = [
    `**Error:** ${bug.title}`,
    bug.culprit && `**Where:** \`${bug.culprit}\``,
    bug.platform && `**Platform:** ${bug.platform}`,
    bug.environment && `**Environment:** ${bug.environment}`,
    bug.release && `**Release:** ${bug.release}`,
    `**Sentry:** ${bug.permalink}`,
  ].filter(Boolean);

  const frames = bug.topFrames.length
    ? `\nMost relevant stack frames (innermost last):\n\`\`\`\n${bug.topFrames.join('\n')}\n\`\`\`\n`
    : '';

  return `Fix the production error reported by Sentry below. Diagnose the root cause from the stack trace and the surrounding code — do not just guard the symptom.

${facts.join('\n')}
${frames}
Requirements:
- Write a failing regression test that reproduces the error FIRST, then fix it. The fix is not done without that test passing.
- Keep the diff minimal and focused on this one error.
- If the root cause is in native code, a third-party dependency, or cannot be determined with confidence from the stack trace, comment on this issue explaining what you found and STOP — do not guess.

<!-- qm-ticket:sentry-${bug.issueId} -->

---
Auto-created by the \`sentryAutofix\` webhook from a Sentry issue alert.`;
}

/** UTC day bucket for the daily dispatch cap, e.g. "2026-07-24". */
export function dailyKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}
