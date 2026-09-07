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
 * non-Meta channels (ASA, partner codes) land in the same table.
 *
 * Alongside the per-ad rows there is a channel rollup, which answers the
 * question the per-ad table cannot: how many accounts came from organic
 * search, and how far down the funnel they got. It reads the `acquisition`
 * map the web app writes for genuinely new accounts (see
 * src/services/attributionService.ts in the app repo).
 *
 * The important discipline here: an account with NO usable first-touch
 * evidence is `unknown`, not `organic`. Before the acquisition map existed
 * every unattributed account was lumped into an "organic baseline", which
 * silently credited organic search with every cross-device signup, every
 * cleared-storage journey and every native install. `unknown` is a real,
 * reportable answer, and for now it is the biggest bucket. Do not read it as
 * organic and do not backfill it — nothing durable records where those
 * accounts came from.
 */

/** Channels the acquisition map can report. Mirrors AcquisitionChannel in
 * the app repo's src/utils/attribution.ts — keep the two in step. */
export type AcquisitionChannel =
  | 'paid'
  | 'organic_search'
  | 'referral'
  | 'direct'
  | 'unknown';

export const ACQUISITION_CHANNELS: AcquisitionChannel[] = [
  'organic_search',
  'referral',
  'direct',
  'paid',
  'unknown',
];

export interface AttributionRollupInput {
  uid: string;
  /**
   * users/{uid}/profile/attribution doc, or null when the account has no
   * first-touch record at all. Null means unknown, NOT organic.
   */
  attribution: {
    utm_source?: string;
    utm_campaign?: string;
    utm_content?: string;
    /** Written for genuinely new accounts only; absent on older records. */
    acquisition?: {
      channel?: string;
      source?: string;
      medium?: string;
      landingPage?: string;
    } | null;
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

/** Same funnel columns as AttributionRow, keyed by acquisition channel. */
export interface ChannelRow {
  channel: AcquisitionChannel;
  signups: number;
  trials: number;
  sent: number;
  monetized: number;
}

/** Landing pages that brought in confirmed-organic accounts. */
export interface LandingPageRow {
  landingPage: string;
  signups: number;
  trials: number;
  sent: number;
  monetized: number;
}

export interface AttributionRollup {
  /** One row per ad/channel key, sorted by signups desc then key asc. */
  rows: AttributionRow[];
  attributedSignups: number;
  /**
   * Accounts with no first-touch record of any kind. Previously — and
   * misleadingly — called `organicSignups`.
   */
  unattributedSignups: number;
  /**
   * @deprecated Mirror of `unattributedSignups`, kept for one release so the
   * admin dashboard keeps rendering whichever side deploys first. These
   * accounts are unattributed, not confirmed organic.
   */
  organicSignups: number;
  /** Full funnel by acquisition channel; `unknown` covers the rest. */
  channels: ChannelRow[];
  /** Organic-search landing pages, best first. The SEO scoreboard. */
  organicLandingPages: LandingPageRow[];
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

/**
 * Which channel an account belongs to.
 *
 * A campaign key always wins: a paid click that also carried a search
 * referrer is paid, not organic. Otherwise the acquisition map decides, and
 * only a channel value we recognise counts — a missing map, a missing
 * channel or an unrecognised string is `unknown`.
 */
export function acquisitionChannel(
  attribution: AttributionRollupInput['attribution'],
): AcquisitionChannel {
  if (attributionKey(attribution)) return 'paid';
  const channel = attribution?.acquisition?.channel;
  return (ACQUISITION_CHANNELS as string[]).includes(channel ?? '')
    ? (channel as AcquisitionChannel)
    : 'unknown';
}

function bump(
  row: { signups: number; trials: number; sent: number; monetized: number },
  input: AttributionRollupInput,
): void {
  row.signups++;
  if (input.hasQuoteDraft) row.trials++;
  if (input.hasSentDoc) row.sent++;
  if (input.monetized) row.monetized++;
}

export function rollupAttribution(inputs: AttributionRollupInput[]): AttributionRollup {
  const byKey = new Map<string, AttributionRow>();
  const byChannel = new Map<AcquisitionChannel, ChannelRow>(
    ACQUISITION_CHANNELS.map((channel) => [
      channel,
      { channel, signups: 0, trials: 0, sent: 0, monetized: 0 },
    ]),
  );
  const byLanding = new Map<string, LandingPageRow>();
  let attributedSignups = 0;
  let unattributedSignups = 0;

  for (const input of inputs) {
    const channel = acquisitionChannel(input.attribution);
    bump(byChannel.get(channel)!, input);

    // Only confirmed organic search gets a landing-page row; that is the page
    // a search result actually delivered them to.
    const landingPage = input.attribution?.acquisition?.landingPage;
    if (channel === 'organic_search' && typeof landingPage === 'string' && landingPage) {
      let page = byLanding.get(landingPage);
      if (!page) {
        page = { landingPage, signups: 0, trials: 0, sent: 0, monetized: 0 };
        byLanding.set(landingPage, page);
      }
      bump(page, input);
    }

    const key = attributionKey(input.attribution);
    if (!key) {
      unattributedSignups += input.attribution?.acquisition ? 0 : 1;
      continue;
    }
    attributedSignups++;
    let row = byKey.get(key);
    if (!row) {
      row = { key, signups: 0, trials: 0, sent: 0, monetized: 0 };
      byKey.set(key, row);
    }
    bump(row, input);
  }

  const rows = [...byKey.values()].sort(
    (a, b) => b.signups - a.signups || a.key.localeCompare(b.key),
  );
  const organicLandingPages = [...byLanding.values()].sort(
    (a, b) => b.signups - a.signups || a.landingPage.localeCompare(b.landingPage),
  );
  return {
    rows,
    attributedSignups,
    unattributedSignups,
    organicSignups: unattributedSignups,
    channels: ACQUISITION_CHANNELS.map((channel) => byChannel.get(channel)!),
    organicLandingPages,
  };
}
