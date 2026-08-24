/**
 * Sentry → autofix pipeline webhook.
 *
 * A Sentry issue alert (internal integration "QuoteMate Autofix") POSTs here
 * when a NEW issue appears in production. We then:
 *  1. verify the webhook signature and normalise the payload,
 *  2. dedupe (one dispatch per Sentry issue, ever) + enforce a daily cap so an
 *     alert storm can't open dozens of agent runs,
 *  3. open a GitHub issue in the agent-task format (labels: sentry-autofix,
 *     agent-working) and dispatch .github/workflows/agent.yml on it.
 * The agent pipeline fixes the bug with a regression test and opens a PR; a
 * human still reviews and merges. deploy-on-merge.yml handles the redeploy.
 *
 * Env (functions/.env):
 *  - SENTRY_AUTOFIX_ENABLED  kill switch, must be exactly "true"
 *  - SENTRY_WEBHOOK_SECRET   internal integration client secret
 *  - GITHUB_AGENT_TOKEN      fine-grained PAT: Issues RW + Actions RW on the repo
 *  - SENTRY_AUTOFIX_DAILY_CAP optional, default 3
 */
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import {
  verifySentrySignature,
  parseSentryAlert,
  buildIssueTitle,
  buildIssueBody,
  dailyKey,
} from './sentryAutofix.helpers';

const SENTRY_ORG_SLUG = process.env.SENTRY_ORG_SLUG || 'hansendev-0p';
const GITHUB_REPO = process.env.GITHUB_AUTOFIX_REPO || 'Krank3n/QuoteMate';
const AGENT_WORKFLOW = 'agent.yml';
const DISPATCHES = 'sentryAutofixDispatches';
const META = 'sentryAutofixMeta';

async function github(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const sentryAutofix = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('POST only');
    return;
  }

  // Kill switch: flip SENTRY_AUTOFIX_ENABLED off and redeploy to pause the
  // whole flow without touching Sentry or GitHub.
  if (process.env.SENTRY_AUTOFIX_ENABLED !== 'true') {
    res.status(200).json({ skipped: 'autofix disabled' });
    return;
  }

  const secret = process.env.SENTRY_WEBHOOK_SECRET || '';
  const token = process.env.GITHUB_AGENT_TOKEN || '';
  if (!secret || !token) {
    functions.logger.error('sentryAutofix: missing SENTRY_WEBHOOK_SECRET or GITHUB_AGENT_TOKEN');
    res.status(503).json({ error: 'not configured' });
    return;
  }

  const signature = req.get('sentry-hook-signature');
  if (!verifySentrySignature(req.rawBody, signature, secret)) {
    functions.logger.warn('sentryAutofix: bad signature');
    res.status(401).json({ error: 'bad signature' });
    return;
  }

  // Sentry pings installations with `{ action: "created", data: { installation... } }`
  // and sends non-alert resources too — anything unparseable is a clean no-op.
  const bug = parseSentryAlert(req.body, SENTRY_ORG_SLUG);
  if (!bug) {
    res.status(200).json({ skipped: 'not an issue alert' });
    return;
  }

  const db = admin.firestore();

  // Dedupe: .create() is atomic — a second alert for the same Sentry issue
  // (regression alerts, re-notifications) fails here and never re-dispatches.
  const dispatchRef = db.collection(DISPATCHES).doc(bug.issueId);
  try {
    await dispatchRef.create({
      sentryIssueId: bug.issueId,
      title: bug.title,
      permalink: bug.permalink,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'dispatching',
    });
  } catch {
    res.status(200).json({ skipped: 'already dispatched for this Sentry issue' });
    return;
  }

  // Daily cap: an alert storm (bad release, flaky infra) must not queue an
  // unbounded pile of agent runs. Over-cap issues are logged, not fixed.
  const cap = Number(process.env.SENTRY_AUTOFIX_DAILY_CAP || '3');
  const capRef = db.collection(META).doc(dailyKey(new Date()));
  const underCap = await db.runTransaction(async (tx) => {
    const snap = await tx.get(capRef);
    const count = (snap.data()?.count as number | undefined) ?? 0;
    if (count >= cap) return false;
    tx.set(capRef, { count: count + 1 }, { merge: true });
    return true;
  });
  if (!underCap) {
    functions.logger.warn(`sentryAutofix: daily cap (${cap}) reached, skipping`, {
      sentryIssue: bug.permalink,
    });
    await dispatchRef.update({ status: 'skipped-daily-cap' });
    res.status(200).json({ skipped: 'daily cap reached' });
    return;
  }

  try {
    // The agent-working label keeps the hourly queue routine from also
    // grabbing the issue — same convention the Tasks board uses.
    const issueRes = await github(token, 'POST', `/repos/${GITHUB_REPO}/issues`, {
      title: buildIssueTitle(bug),
      body: buildIssueBody(bug),
      labels: ['sentry-autofix', 'agent-working'],
    });
    if (!issueRes.ok) {
      throw new Error(`GitHub issue create failed: ${issueRes.status} ${await issueRes.text()}`);
    }
    const issue = (await issueRes.json()) as { number: number; html_url: string };

    const dispatchRes = await github(
      token,
      'POST',
      `/repos/${GITHUB_REPO}/actions/workflows/${AGENT_WORKFLOW}/dispatches`,
      { ref: 'main', inputs: { issue: String(issue.number) } },
    );
    if (dispatchRes.status !== 204) {
      throw new Error(
        `agent.yml dispatch failed: ${dispatchRes.status} ${await dispatchRes.text()}`,
      );
    }

    await dispatchRef.update({
      status: 'dispatched',
      githubIssue: issue.number,
      githubIssueUrl: issue.html_url,
    });
    functions.logger.info(`sentryAutofix: dispatched agent for ${bug.permalink}`, {
      githubIssue: issue.html_url,
    });
    res.status(200).json({ dispatched: issue.html_url });
  } catch (err) {
    // Release the dedupe slot so Sentry's retry (or a manual re-send) can
    // try again — otherwise a transient GitHub failure permanently eats the bug.
    await dispatchRef.delete().catch(() => undefined);
    functions.logger.error('sentryAutofix: dispatch failed', err);
    res.status(500).json({ error: 'dispatch failed' });
  }
});
