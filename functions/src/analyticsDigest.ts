/**
 * Weekly AI analyst digest.
 *
 * Every Monday morning (Brisbane), pull last week's GA4 web data alongside the
 * prior week, join the all-time product funnel from Firestore, have Claude
 * write a short "what changed and what to do" brief, and email it to the
 * founder via Brevo. The brief is also stored in adminStats/weeklyDigest so
 * the admin dashboard can surface the latest one.
 *
 * Identity: runs as the DEFAULT App Engine service account
 * (hansendev@appspot.gserviceaccount.com), which has Firestore access. GA
 * access comes from granting that SA Viewer on the GA4 property in GA Admin →
 * Property access management — NOT the ga-reader SA used by adminTrafficStats,
 * which has no Firestore role.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { sendEmail } from './email';
import { computeFunnelPayload } from './adminCrm';

const GA_PROPERTY = `properties/${process.env.GA_PROPERTY_ID || '527922866'}`;
const DIGEST_TO = process.env.DIGEST_TO || 'thomas.andrew.hansen@gmail.com';
const DIGEST_MODEL = process.env.DIGEST_MODEL || 'claude-sonnet-4-6';

const CTA_EVENTS = [
  'web_app_click',
  'app_store_click',
  'google_play_click',
  'cta_click',
  'pricing_cta_click',
];

let _ga: BetaAnalyticsDataClient | null = null;
function ga(): BetaAnalyticsDataClient {
  if (!_ga) _ga = new BetaAnalyticsDataClient();
  return _ga;
}

const num = (v: string | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface WeekPair {
  thisWeek: number;
  lastWeek: number;
}

interface GaDigestData {
  summary: {
    sessions: WeekPair;
    users: WeekPair;
    newUsers: WeekPair;
    engagementRate: WeekPair;
  };
  channels: Array<{ channel: string } & WeekPair>;
  events: Array<{ event: string } & WeekPair>;
  topPages: Array<{ path: string } & WeekPair>;
}

/**
 * One GA fetch with two named date ranges. Rows come back with the range name
 * appended as the last dimension value, so each helper folds the two ranges
 * into {thisWeek, lastWeek} pairs keyed by the leading dimension.
 */
async function gatherGa(): Promise<GaDigestData> {
  const dateRanges = [
    { startDate: '7daysAgo', endDate: 'yesterday', name: 'thisWeek' },
    { startDate: '14daysAgo', endDate: '8daysAgo', name: 'lastWeek' },
  ];

  const totalsP = ga().runReport({
    property: GA_PROPERTY,
    dateRanges,
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'engagementRate' },
    ],
  });

  const channelsP = ga().runReport({
    property: GA_PROPERTY,
    dateRanges,
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 24,
  });

  const eventsP = ga().runReport({
    property: GA_PROPERTY,
    dateRanges,
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        inListFilter: { values: ['form_start', ...CTA_EVENTS] },
      },
    },
    limit: 30,
  });

  const pagesP = ga().runReport({
    property: GA_PROPERTY,
    dateRanges,
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }],
    dimensionFilter: {
      notExpression: {
        filter: {
          fieldName: 'pagePath',
          stringFilter: { matchType: 'BEGINS_WITH', value: '/admin' },
        },
      },
    },
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 40,
  });

  const [totalsR, channelsR, eventsR, pagesR] = await Promise.all([totalsP, channelsP, eventsP, pagesP]);

  // Totals: no dimensions requested, so the only dimension is the range name.
  const summary = {
    sessions: { thisWeek: 0, lastWeek: 0 },
    users: { thisWeek: 0, lastWeek: 0 },
    newUsers: { thisWeek: 0, lastWeek: 0 },
    engagementRate: { thisWeek: 0, lastWeek: 0 },
  };
  for (const r of totalsR[0].rows || []) {
    const range = r.dimensionValues?.[0]?.value === 'lastWeek' ? 'lastWeek' : 'thisWeek';
    summary.sessions[range] = num(r.metricValues?.[0]?.value);
    summary.users[range] = num(r.metricValues?.[1]?.value);
    summary.newUsers[range] = num(r.metricValues?.[2]?.value);
    summary.engagementRate[range] = num(r.metricValues?.[3]?.value);
  }

  // Keyed rows: fold [key, rangeName] rows into {thisWeek, lastWeek} pairs.
  const fold = (rows: any[] | null | undefined): Map<string, WeekPair> => {
    const out = new Map<string, WeekPair>();
    for (const r of rows || []) {
      const key = r.dimensionValues?.[0]?.value || '(unknown)';
      const range = r.dimensionValues?.[1]?.value === 'lastWeek' ? 'lastWeek' : 'thisWeek';
      const pair = out.get(key) || { thisWeek: 0, lastWeek: 0 };
      pair[range] += num(r.metricValues?.[0]?.value);
      out.set(key, pair);
    }
    return out;
  };

  const channels = [...fold(channelsR[0].rows).entries()]
    .map(([channel, p]) => ({ channel, ...p }))
    .sort((a, b) => b.thisWeek - a.thisWeek)
    .slice(0, 8);
  const events = [...fold(eventsR[0].rows).entries()].map(([event, p]) => ({ event, ...p }));
  const topPages = [...fold(pagesR[0].rows).entries()]
    .map(([path, p]) => ({ path, ...p }))
    .sort((a, b) => b.thisWeek - a.thisWeek)
    .slice(0, 10);

  return { summary, channels, events, topPages };
}

type ClaudeResult = { ok: true; text: string } | { ok: false; error: string };

// Same raw-fetch pattern as tickets.ts / leadOutreach.ts — no SDK dependency.
async function callClaude(system: string, user: string): Promise<ClaudeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY missing' };
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: DIGEST_MODEL,
        max_tokens: 2048,
        temperature: 0.3,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!response.ok) {
      const txt = await response.text().catch(() => '');
      return { ok: false, error: `claude-${response.status}: ${txt.slice(0, 300)}` };
    }
    const body: any = await response.json();
    const text = ((body?.content || []) as any[])
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!text) return { ok: false, error: 'claude returned empty response' };
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, error: `claude-network: ${e?.message || 'unknown'}` };
  }
}

const DIGEST_SYSTEM = `You are the growth analyst for QuoteMate, an AI quoting/invoicing app for Australian tradies ($49/mo). Context you must weigh: traffic is small (hundreds of sessions/week), organic search + the /quotes-for-X trade pages are the growth engine, and the business bottleneck is trial→paid conversion. Small absolute changes are usually noise — call them noise. You write a short weekly email brief for the founder.

Rules:
- Output ONLY an HTML fragment (no <html>/<head>/<body>, no markdown fences).
- Structure: <h3>TL;DR</h3> with exactly 3 <li> bullets; <h3>What changed</h3> with 3-6 short <li> items, each with real numbers (this week vs last week); <h3>Do this week</h3> with ONE concrete recommended action and one sentence of why.
- Be specific and honest. If nothing meaningful changed, say so rather than inventing a story.
- Keep the whole thing under 250 words. Plain language, no hype.`;

function fallbackHtml(gaData: GaDigestData): string {
  const s = gaData.summary;
  const rows = gaData.channels
    .map((c) => `<li>${c.channel}: ${c.thisWeek} sessions (prev ${c.lastWeek})</li>`)
    .join('');
  return `<h3>Weekly numbers (AI summary unavailable)</h3>
<ul>
<li>Sessions: ${s.sessions.thisWeek} (prev ${s.sessions.lastWeek})</li>
<li>Users: ${s.users.thisWeek} (prev ${s.users.lastWeek})</li>
</ul>
<h3>Channels</h3><ul>${rows}</ul>`;
}

// Read endpoint for the admin dashboard: returns the latest stored digest.
export const adminWeeklyDigest = functions
  .runWith({ timeoutSeconds: 15, memory: '256MB' })
  .https.onCall(async (_data, context) => {
    const isAdmin = context.auth?.token?.admin === true;
    if (!context.auth?.uid || !isAdmin) {
      throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
    }
    const doc = await admin.firestore().collection('adminStats').doc('weeklyDigest').get();
    if (!doc.exists) return { available: false as const };
    const d = doc.data() as any;
    return {
      available: true as const,
      html: String(d?.html || ''),
      aiGenerated: d?.aiGenerated !== false,
      generatedAt: typeof d?.generatedAt === 'number' ? d.generatedAt : null,
    };
  });

export const weeklyAnalyticsDigest = functions
  .runWith({ memory: '512MB', timeoutSeconds: 300 })
  .pubsub.schedule('every monday 07:00')
  .timeZone('Australia/Brisbane')
  .onRun(async () => {
    // 1. Gather. GA and the funnel scan are independent; a GA permission
    // problem should surface loudly, so no catch here — the run fails visibly
    // in functions logs.
    const [gaData, funnel] = await Promise.all([gatherGa(), computeFunnelPayload()]);

    const payload = {
      web: gaData,
      product: {
        allTime: funnel.funnel,
        trialToPaid: funnel.conversion.trialToPaid,
        activationRate: funnel.conversion.activationRate,
        expiringTrials: funnel.expiringTrials,
      },
    };

    // 2. Analyse.
    const result = await callClaude(
      DIGEST_SYSTEM,
      `Here is this week's data (web = GA4 last 7 days vs the 7 before; product = all-time Firestore funnel):\n\n${JSON.stringify(payload, null, 1)}`
    );
    const brief = result.ok ? result.text : fallbackHtml(gaData);
    if (!result.ok) console.error('weeklyAnalyticsDigest: claude failed, sending fallback', result.error);

    const weekOf = new Date().toISOString().slice(0, 10);
    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1e293b;line-height:1.6;">
<h2 style="margin-top:0;">QuoteMate weekly analytics digest</h2>
<p style="color:#64748b;font-size:13px;">Week ending ${weekOf} · web = last 7 days vs prior 7 · product funnel = all-time</p>
${brief}
<p style="color:#94a3b8;font-size:12px;margin-top:28px;">Generated by the weekly analyst function · <a href="https://quotemateapp.au/admin/analytics" style="color:#94a3b8;">open the dashboard</a></p>
</body></html>`;

    // 3. Persist for the dashboard, then email.
    try {
      await admin.firestore().collection('adminStats').doc('weeklyDigest').set({
        html: brief,
        aiGenerated: result.ok,
        data: payload,
        generatedAt: Date.now(),
      });
    } catch (err: any) {
      console.error('weeklyAnalyticsDigest: cache write failed', err?.message);
    }

    const sent = await sendEmail({
      to: DIGEST_TO,
      subject: `QuoteMate weekly digest — ${weekOf}`,
      htmlContent: html,
      category: 'transactional',
      tags: ['analytics_digest'],
    });
    console.info(`weeklyAnalyticsDigest: sent=${sent} aiGenerated=${result.ok}`);
    return null;
  });
