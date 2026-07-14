/**
 * Daily broken-tracking alarm.
 *
 * The GA4 key events sat misconfigured for months with nobody noticing, so
 * this is the smoke detector: every morning it reads yesterday's GA data and
 * emails the founder ONLY when something looks broken. Quiet days send
 * nothing — the weekly digest covers routine reporting.
 *
 * Alert conditions (tuned for a small property, biased against false alarms):
 *  - zero page_views yesterday → the tag is broken or the site is down
 *  - sessions collapsed to <30% of the trailing 7-day average (avg ≥ 10)
 *  - zero store/CTA key events across 3 consecutive days despite ≥30 sessions
 *    → conversion instrumentation broke while traffic kept flowing
 *
 * Runs as the default App Engine SA (GA property Viewer, same as the digest).
 */
import * as functions from 'firebase-functions';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { sendEmail } from './email';

const GA_PROPERTY = `properties/${process.env.GA_PROPERTY_ID || '527922866'}`;
const ALARM_TO = process.env.DIGEST_TO || 'thomas.andrew.hansen@gmail.com';

const CTA_EVENTS = [
  'web_app_click',
  'app_store_click',
  'google_play_click',
  'cta_click',
  'pricing_cta_click',
  'sign_up',
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

interface DayRow {
  date: string;
  sessions: number;
  pageViews: number;
  ctaEvents: number;
}

async function fetchLast8Days(): Promise<DayRow[]> {
  const dateRanges = [{ startDate: '8daysAgo', endDate: 'yesterday' }];
  const [trafficR, eventsR] = await Promise.all([
    ga().runReport({
      property: GA_PROPERTY,
      dateRanges,
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 10,
    }),
    ga().runReport({
      property: GA_PROPERTY,
      dateRanges,
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', inListFilter: { values: CTA_EVENTS } },
      },
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 10,
    }),
  ]);

  const ctaByDate = new Map<string, number>();
  for (const r of eventsR[0].rows || []) {
    ctaByDate.set(r.dimensionValues?.[0]?.value || '', num(r.metricValues?.[0]?.value));
  }

  return (trafficR[0].rows || []).map((r) => {
    const date = r.dimensionValues?.[0]?.value || '';
    return {
      date,
      sessions: num(r.metricValues?.[0]?.value),
      pageViews: num(r.metricValues?.[1]?.value),
      ctaEvents: ctaByDate.get(date) || 0,
    };
  });
}

/** Pure alarm logic, exported for tests. Rows must be oldest→newest. */
export function evaluateTracking(rows: DayRow[]): string[] {
  const problems: string[] = [];
  if (rows.length === 0) {
    return ['GA returned no daily rows at all for the last 8 days — the property is receiving nothing.'];
  }

  const yesterday = rows[rows.length - 1];
  const prior = rows.slice(0, -1);

  if (yesterday.pageViews === 0) {
    problems.push(
      `Zero page_views yesterday (${yesterday.date}). The GA tag is broken, a deploy dropped the Analytics component, or the site is down.`
    );
  }

  if (prior.length >= 4) {
    const avg = prior.reduce((a, r) => a + r.sessions, 0) / prior.length;
    if (avg >= 10 && yesterday.sessions < avg * 0.3) {
      problems.push(
        `Sessions collapsed: ${yesterday.sessions} yesterday vs a trailing average of ${avg.toFixed(1)}/day. Could be a tracking break or a real traffic loss (check Search Console / hosting).`
      );
    }
  }

  const last3 = rows.slice(-3);
  const last3Cta = last3.reduce((a, r) => a + r.ctaEvents, 0);
  const last3Sessions = last3.reduce((a, r) => a + r.sessions, 0);
  if (last3.length === 3 && last3Cta === 0 && last3Sessions >= 30) {
    problems.push(
      `Zero store/CTA key events for 3 straight days despite ${last3Sessions} sessions. Conversion instrumentation (Analytics.tsx click listeners) has likely broken while page tracking still works.`
    );
  }

  return problems;
}

export const dailyTrackingCheck = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .pubsub.schedule('every day 08:00')
  .timeZone('Australia/Brisbane')
  .onRun(async () => {
    const rows = await fetchLast8Days();
    const problems = evaluateTracking(rows);
    const yesterday = rows[rows.length - 1];
    console.info(
      `dailyTrackingCheck: yesterday=${JSON.stringify(yesterday || null)} problems=${problems.length}`
    );
    if (problems.length === 0) return null;

    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1e293b;line-height:1.6;">
<h2 style="margin-top:0;color:#b91c1c;">QuoteMate analytics alarm</h2>
<p>The daily tracking check found ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}:</p>
<ul>${problems.map((p) => `<li>${p}</li>`).join('')}</ul>
<p style="font-size:13px;color:#64748b;">Last 8 days (sessions / page views / CTA key events):</p>
<ul style="font-size:13px;color:#64748b;">${rows.map((r) => `<li>${r.date}: ${r.sessions} / ${r.pageViews} / ${r.ctaEvents}</li>`).join('')}</ul>
<p style="color:#94a3b8;font-size:12px;margin-top:24px;">Sent only when something looks broken · dailyTrackingCheck, 08:00 Brisbane</p>
</body></html>`;

    await sendEmail({
      to: ALARM_TO,
      subject: `⚠ QuoteMate analytics alarm — ${problems.length === 1 ? '1 problem' : `${problems.length} problems`} detected`,
      htmlContent: html,
      category: 'transactional',
      tags: ['tracking_alarm'],
    });
    return null;
  });
