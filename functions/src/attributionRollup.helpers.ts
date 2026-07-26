/**
 * Pure per-ad attribution rollup for the paid-acquisition scoreboard
 * (QuoteMateAppWebsite/marketing/fb-ads-growth-system-2026-07.md §2/§6).
 *
 * Joins users/{uid}/profile/attribution (first-touch utm params written by the
 * web app — see src/services/attributionService.ts in the app repo) with the
 * same funnel facts the event funnel already derives. Consumed by the
 * aggregateEventFunnel cron; the admin CRM renders the rows as the Monday
 * kill/scale table: per ad → signups → trials → sent → monetised.
 *
 * Grouping key is utm_content (= ad name by naming discipline). Users with
 * attribution but no utm_content fall back to "utm_source/utm_campaign" so
 * non-Meta channels (ASA, partner codes) land in the same table. Users with
 * no attribution doc are the organic baseline — counted, never row-ified.
 */

export interface AttributionRollupInput {
  uid: string;
  /** users/{uid}/profile/attribution doc, or null when the user is organic. */
  attribution: {
    utm_source?: string;
    utm_campaign?: string;
    utm_content?: string;
  } | null;
  /** Trial started (first quote draft) — trialStartedAt semantics. */
  hasQuoteDraft: boolean;
  /** Sent a real document — the activation event. */
  hasSentDoc: boolean;
  /** North-star numerator (billed Pro or real Square payment). */
  monetized: boolean;
}

export interface AttributionRow {
  /** utm_content, or "source/campaign" fallback for non-ad-tagged channels. */
  key: string;
  signups: number;
  trials: number;
  sent: number;
  monetized: number;
}

export interface AttributionRollup {
  /** One row per ad/channel key, sorted by signups desc then key asc. */
  rows: AttributionRow[];
  attributedSignups: number;
  organicSignups: number;
}

export function attributionKey(
  attribution: AttributionRollupInput['attribution'],
): string | null {
  if (!attribution) return null;
  const content = attribution.utm_content?.trim();
  if (content) return content;
  const source = attribution.utm_source?.trim();
  if (!source) return null;
  const campaign = attribution.utm_campaign?.trim();
  return campaign ? `${source}/${campaign}` : source;
}

export function rollupAttribution(inputs: AttributionRollupInput[]): AttributionRollup {
  const byKey = new Map<string, AttributionRow>();
  let attributedSignups = 0;
  let organicSignups = 0;

  for (const input of inputs) {
    const key = attributionKey(input.attribution);
    if (!key) {
      organicSignups++;
      continue;
    }
    attributedSignups++;
    let row = byKey.get(key);
    if (!row) {
      row = { key, signups: 0, trials: 0, sent: 0, monetized: 0 };
      byKey.set(key, row);
    }
    row.signups++;
    if (input.hasQuoteDraft) row.trials++;
    if (input.hasSentDoc) row.sent++;
    if (input.monetized) row.monetized++;
  }

  const rows = [...byKey.values()].sort(
    (a, b) => b.signups - a.signups || a.key.localeCompare(b.key),
  );
  return { rows, attributedSignups, organicSignups };
}
