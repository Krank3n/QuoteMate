/**
 * Google Analytics traffic stats for the /admin dashboard.
 *
 * `adminTrafficStats` is an admin-gated callable that reads the QuoteMate GA4
 * property (G-E3JERN2D5V -> properties/527922866) via the GA Data API and
 * returns acquisition, funnel, hero A/B and top-page data for the dashboard.
 *
 * Auth model: the function runs AS the `ga-reader` service account, which has
 * Viewer access on the GA4 property. The Data API client picks that identity up
 * through Application Default Credentials — no key file in code.
 */
import * as functions from 'firebase-functions';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

const GA_PROPERTY = `properties/${process.env.GA_PROPERTY_ID || '527922866'}`;
const GA_SERVICE_ACCOUNT = 'ga-reader@hansendev.iam.gserviceaccount.com';

// Reused across warm invocations.
let _client: BetaAnalyticsDataClient | null = null;
function client(): BetaAnalyticsDataClient {
  if (!_client) _client = new BetaAnalyticsDataClient();
  return _client;
}

function requireAdmin(context: functions.https.CallableContext): void {
  const isAdmin = context.auth?.token?.admin === true;
  if (!context.auth?.uid || !isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }
}

// Events that represent a conversion intent, used by the funnel + A/B reports.
const CTA_EVENTS = [
  'web_app_click',
  'app_store_click',
  'google_play_click',
  'cta_click',
  'pricing_cta_click',
];

const num = (v: string | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** "20240617" (GA `date` dim) -> "2024-06-17". */
function isoFromGaDate(d: string): string {
  if (d && d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return d;
}

export const adminTrafficStats = functions
  .runWith({ serviceAccount: GA_SERVICE_ACCOUNT, timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data: { days?: number }, context) => {
    requireAdmin(context);

    const days = Math.min(90, Math.max(1, Math.round(data?.days || 28)));
    const dateRanges = [{ startDate: `${days}daysAgo`, endDate: 'today' }];
    const ga = client();

    // ----- 1. Headline totals -----
    const totalsP = ga.runReport({
      property: GA_PROPERTY,
      dateRanges,
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
        { name: 'engagementRate' },
      ],
    });

    // ----- 2. Acquisition by channel -----
    const channelsP = ga.runReport({
      property: GA_PROPERTY,
      dateRanges,
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 12,
    });

    // ----- 3. Daily series (for the sparklines) -----
    const dailyP = ga.runReport({
      property: GA_PROPERTY,
      dateRanges,
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 100,
    });

    // ----- 4. Funnel: counts per conversion event -----
    const funnelP = ga.runReport({
      property: GA_PROPERTY,
      dateRanges,
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: {
            values: ['session_start', 'user_engagement', 'form_start', ...CTA_EVENTS],
          },
        },
      },
      limit: 25,
    });

    // ----- 5. Top pages (exclude the internal /admin panel) -----
    const pagesP = ga.runReport({
      property: GA_PROPERTY,
      dateRanges,
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'sessions' }, { name: 'totalUsers' }],
      dimensionFilter: {
        notExpression: {
          filter: {
            fieldName: 'pagePath',
            stringFilter: { matchType: 'BEGINS_WITH', value: '/admin' },
          },
        },
      },
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 12,
    });

    // ----- 6. Hero A/B by variant (needs the `variant` custom dimension) -----
    // Wrapped: if the custom dimension isn't registered the Data API 400s, and
    // we surface a friendly "not yet available" instead of failing the call.
    const abP = ga
      .runReport({
        property: GA_PROPERTY,
        dateRanges,
        dimensions: [{ name: 'customEvent:variant' }, { name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            // sign_up: fired by the /app web build with the hero variant param
            // (webAnalytics.ts) — the direct experiment outcome.
            inListFilter: { values: ['experiment_impression', 'sign_up', ...CTA_EVENTS] },
          },
        },
        limit: 50,
      })
      .then((res) => ({ ok: true as const, res: res[0] }))
      .catch((err: any) => ({ ok: false as const, error: String(err?.message || err) }));

    const [totalsR, channelsR, dailyR, funnelR, pagesR, abR] = await Promise.all([
      totalsP,
      channelsP,
      dailyP,
      funnelP,
      pagesP,
      abP,
    ]);

    // ---- shape totals ----
    const tRow = totalsR[0].rows?.[0]?.metricValues || [];
    const summary = {
      sessions: num(tRow[0]?.value),
      users: num(tRow[1]?.value),
      newUsers: num(tRow[2]?.value),
      pageViews: num(tRow[3]?.value),
      avgSessionDuration: num(tRow[4]?.value),
      engagementRate: num(tRow[5]?.value),
    };

    // ---- channels ----
    const channels = (channelsR[0].rows || []).map((r) => ({
      channel: r.dimensionValues?.[0]?.value || '(unknown)',
      sessions: num(r.metricValues?.[0]?.value),
      users: num(r.metricValues?.[1]?.value),
      newUsers: num(r.metricValues?.[2]?.value),
    }));

    // ---- daily series ----
    const daily = (dailyR[0].rows || []).map((r) => ({
      date: isoFromGaDate(r.dimensionValues?.[0]?.value || ''),
      sessions: num(r.metricValues?.[0]?.value),
      users: num(r.metricValues?.[1]?.value),
    }));

    // ---- funnel: event name -> count ----
    const evCount: Record<string, number> = {};
    for (const r of funnelR[0].rows || []) {
      const name = r.dimensionValues?.[0]?.value || '';
      evCount[name] = num(r.metricValues?.[0]?.value);
    }
    const ctaTotal = CTA_EVENTS.reduce((a, e) => a + (evCount[e] || 0), 0);
    const funnel = {
      sessions: summary.sessions,
      engaged: evCount['user_engagement'] || 0,
      ctaClicks: ctaTotal,
      byCta: {
        web: evCount['web_app_click'] || 0,
        appStore: evCount['app_store_click'] || 0,
        googlePlay: evCount['google_play_click'] || 0,
        cta: evCount['cta_click'] || 0,
        pricing: evCount['pricing_cta_click'] || 0,
      },
      formStarts: evCount['form_start'] || 0,
    };

    // ---- top pages ----
    const topPages = (pagesR[0].rows || []).map((r) => ({
      path: r.dimensionValues?.[0]?.value || '/',
      views: num(r.metricValues?.[0]?.value),
      sessions: num(r.metricValues?.[1]?.value),
      users: num(r.metricValues?.[2]?.value),
    }));

    // ---- hero A/B ----
    let abTest:
      | { available: false; reason: string }
      | {
          available: true;
          variants: Array<{
            variant: string;
            impressions: number;
            ctaClicks: number;
            ctr: number;
            storeExits: number;
            storeExitRate: number;
            signups: number;
          }>;
        };
    if (!abR.ok) {
      abTest = {
        available: false,
        reason:
          'Register an event-scoped custom dimension named "variant" in GA4 (Admin → Custom definitions). Data is not retroactive; it populates from creation onward.',
      };
    } else {
      // Store exits (app store / play / web app) are the clicks that leave for
      // the product — variant A's hero buttons land here, never in cta_click,
      // so judging variants on cta_click alone is apples-vs-oranges.
      const STORE_EXIT_EVENTS = new Set(['web_app_click', 'app_store_click', 'google_play_click']);
      const byVariant: Record<
        string,
        { impressions: number; ctaClicks: number; storeExits: number; signups: number }
      > = {};
      for (const r of abR.res.rows || []) {
        const variant = r.dimensionValues?.[0]?.value || '(not set)';
        const event = r.dimensionValues?.[1]?.value || '';
        const count = num(r.metricValues?.[0]?.value);
        if (!byVariant[variant]) byVariant[variant] = { impressions: 0, ctaClicks: 0, storeExits: 0, signups: 0 };
        if (event === 'experiment_impression') byVariant[variant].impressions += count;
        else if (event === 'sign_up') byVariant[variant].signups += count;
        else {
          byVariant[variant].ctaClicks += count;
          if (STORE_EXIT_EVENTS.has(event)) byVariant[variant].storeExits += count;
        }
      }
      const variants = Object.entries(byVariant)
        .map(([variant, v]) => ({
          variant,
          impressions: v.impressions,
          ctaClicks: v.ctaClicks,
          ctr: v.impressions > 0 ? v.ctaClicks / v.impressions : 0,
          storeExits: v.storeExits,
          storeExitRate: v.impressions > 0 ? v.storeExits / v.impressions : 0,
          signups: v.signups,
        }))
        .sort((a, b) => a.variant.localeCompare(b.variant));
      abTest = variants.length ? { available: true, variants } : {
        available: false,
        reason: 'The "variant" custom dimension exists but has no data yet for this period.',
      };
    }

    return {
      propertyId: GA_PROPERTY.split('/')[1],
      days,
      generatedAt: new Date().toISOString(),
      summary,
      channels,
      daily,
      funnel,
      topPages,
      abTest,
    };
  });
