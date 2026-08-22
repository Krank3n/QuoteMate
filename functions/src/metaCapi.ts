/**
 * Meta Conversions API relay (growth system §3 —
 * QuoteMateAppWebsite/marketing/fb-ads-growth-system-2026-07.md).
 *
 * The browser pixel alone loses ~25–40% of conversions to blockers/ITP, which
 * at our event volume cripples campaign optimization — so the website beacons
 * each pixel event here and we mirror it to Meta server-side. Dedup: browser
 * and server send the SAME event_id, Meta keeps one.
 *
 * Fail-closed: without META_PIXEL_ID + META_CAPI_ACCESS_TOKEN in the
 * environment this endpoint accepts and drops events (204), so it can ship
 * before the pixel exists and start relaying the moment env vars land.
 * Payloads are untrusted browser input — allow-listed and length-capped.
 */
import * as functions from 'firebase-functions/v1';
import { createHash } from 'crypto';

export const CAPI_EVENT_NAMES = ['SignupStart', 'Lead', 'PageView'] as const;
export type CapiEventName = (typeof CAPI_EVENT_NAMES)[number];

export interface CapiBeacon {
  eventName: CapiEventName;
  eventId: string;
  url?: string;
  fbc?: string;
  fbp?: string;
  /** Plain email if the site ever knows it at event time (hashed before send). */
  email?: string;
}

/** Validate + sanitise an untrusted beacon body. Returns null when malformed. */
export function parseBeacon(body: unknown): CapiBeacon | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const eventName = CAPI_EVENT_NAMES.find((n) => n === b.eventName);
  if (!eventName) return null;
  if (typeof b.eventId !== 'string' || !b.eventId.trim() || b.eventId.length > 64) return null;
  const out: CapiBeacon = { eventName, eventId: b.eventId.trim() };
  for (const key of ['url', 'fbc', 'fbp', 'email'] as const) {
    const value = b[key];
    if (typeof value === 'string' && value.trim()) out[key] = value.trim().slice(0, 512);
  }
  return out;
}

export function sha256Lower(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/** Build the Meta /events payload for one beacon. `now` injectable for tests. */
export function buildCapiPayload(beacon: CapiBeacon, now: Date, clientIp?: string, userAgent?: string) {
  const userData: Record<string, unknown> = {};
  if (beacon.email) userData.em = [sha256Lower(beacon.email)];
  if (beacon.fbc) userData.fbc = beacon.fbc;
  if (beacon.fbp) userData.fbp = beacon.fbp;
  if (clientIp) userData.client_ip_address = clientIp;
  if (userAgent) userData.client_user_agent = userAgent;
  return {
    data: [
      {
        event_name: beacon.eventName,
        event_time: Math.floor(now.getTime() / 1000),
        event_id: beacon.eventId,
        action_source: 'website',
        ...(beacon.url ? { event_source_url: beacon.url } : {}),
        user_data: userData,
      },
    ],
  };
}

const ALLOWED_ORIGINS = new Set([
  'https://quotemateapp.au',
  'https://www.quotemateapp.au',
  'https://quotemate-staging.web.app',
]);

export const metaCapiTrack = functions
  .runWith({ memory: '256MB', timeoutSeconds: 10 })
  .https.onRequest(async (req, res) => {
    const origin = req.headers.origin as string | undefined;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).send('');
      return;
    }

    const pixelId = process.env.META_PIXEL_ID;
    const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
    const beacon = parseBeacon(req.body);
    if (!beacon) {
      res.status(400).send('');
      return;
    }
    // Not configured yet → accept and drop (the browser side never blocks on us).
    if (!pixelId || !accessToken) {
      res.status(204).send('');
      return;
    }

    try {
      const payload = buildCapiPayload(
        beacon,
        new Date(),
        (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim(),
        req.headers['user-agent'] as string | undefined,
      );
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${accessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        console.error(`metaCapiTrack: Meta responded ${response.status}: ${await response.text()}`);
      }
    } catch (err) {
      console.error('metaCapiTrack: relay failed', err);
    }
    // Always 204 — analytics must never surface errors to the page.
    res.status(204).send('');
  });
