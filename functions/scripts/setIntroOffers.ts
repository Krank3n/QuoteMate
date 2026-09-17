/**
 * Put a FREE 14-day introductory offer on every Pro subscription in both
 * stores, so a tradie who subscribes mid-trial is not billed on tap.
 *
 * Apple: one subscriptionIntroductoryOffer per subscription PER TERRITORY
 *        (ASC rejects a territory-less create with 409 RELATIONSHIP.REQUIRED),
 *        for every territory the subscription is priced in; offerMode
 *        FREE_TRIAL, duration TWO_WEEKS, no end date.
 * Play:  one acquisition offer per base plan, one free P2W phase, AU (the
 *        only region the base plans sell in), targeting "new to this
 *        subscription", then activated.
 *
 * Both stores grant an introductory offer once per store account, so a
 * lapsed subscriber cannot farm it. The app reads the offer off the product
 * at runtime (src/services/storeOffers.ts) and only claims "14 days free"
 * when the store reports it for that buyer — so this script can run before
 * or after the app change ships.
 *
 * Idempotent: skips a store that already has a free intro offer.
 * Dry run by default; --apply writes.
 *
 *   cd functions && npx tsx scripts/setIntroOffers.ts
 *   cd functions && npx tsx scripts/setIntroOffers.ts --apply
 */
import * as dotenv from 'dotenv';
import { JWT } from 'google-auth-library';
import { makeAscJwt } from '../src/storeFunnel';

dotenv.config({ path: '.env' });

const APPLY = process.argv.includes('--apply');
const APP_ID = process.env.APPLE_APP_APPLE_ID || '6754000046';
const PKG = 'com.quotemate.app';
const PLAY_OFFER_ID = 'free-trial-14d';
const REGIONS_VERSION = '2022/02';

// ---------------------------------------------------------------- Apple ----
function ascHeaders(): Record<string, string> {
  const jwt = makeAscJwt({
    keyId: process.env.ASC_KEY_ID!,
    issuerId: process.env.ASC_ISSUER_ID!,
    privateKey: (process.env.ASC_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  });
  return { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
}

async function asc(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method, headers: ascHeaders(), body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`ASC ${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

async function apple() {
  console.log('=== Apple ===');
  const groups = await asc('GET', `/v1/apps/${APP_ID}/subscriptionGroups?include=subscriptions`);
  const subs = (groups.included || []).filter((x: any) => x.type === 'subscriptions');
  for (const s of subs) {
    const pid = s.attributes?.productId;
    // Territories this subscription is priced in — the offer must exist in each.
    const territories = new Set<string>();
    let next: string | null = `/v1/subscriptions/${s.id}/prices?limit=200&include=territory`;
    while (next) {
      const page: any = await asc('GET', next);
      for (const pr of page.data || []) {
        const t = pr.relationships?.territory?.data?.id;
        if (t) territories.add(t);
      }
      const link: string | undefined = page.links?.next;
      next = link ? link.replace('https://api.appstoreconnect.apple.com', '') : null;
    }
    // Territories that already carry a FREE_TRIAL intro offer are left alone.
    const covered = new Set<string>();
    next = `/v1/subscriptions/${s.id}/introductoryOffers?limit=200&include=territory`;
    while (next) {
      const page: any = await asc('GET', next);
      for (const o of page.data || []) {
        if (o.attributes?.offerMode === 'FREE_TRIAL') {
          const t = o.relationships?.territory?.data?.id;
          if (t) covered.add(t);
        }
      }
      const link: string | undefined = page.links?.next;
      next = link ? link.replace('https://api.appstoreconnect.apple.com', '') : null;
    }
    const todo = [...territories].filter((t) => !covered.has(t)).sort();
    console.log(`${pid}: ${territories.size} priced territories, ${covered.size} already have a FREE_TRIAL offer, ${todo.length} to create`);
    if (!APPLY) { if (todo.length) console.log(`  would POST FREE_TRIAL/TWO_WEEKS for: ${todo.slice(0, 12).join(',')}${todo.length > 12 ? ',…' : ''}`); continue; }
    let created = 0;
    const failed: string[] = [];
    for (const territory of todo) {
      const body = {
        data: {
          type: 'subscriptionIntroductoryOffers',
          attributes: { offerMode: 'FREE_TRIAL', duration: 'TWO_WEEKS', numberOfPeriods: 1, startDate: null, endDate: null },
          relationships: {
            subscription: { data: { type: 'subscriptions', id: s.id } },
            territory: { data: { type: 'territories', id: territory } },
          },
        },
      };
      try {
        await asc('POST', '/v1/subscriptionIntroductoryOffers', body);
        created++;
      } catch (err: any) {
        failed.push(`${territory}: ${String(err?.message || err).slice(0, 160)}`);
      }
    }
    console.log(`${pid}: created ${created}/${todo.length}${failed.length ? `; FAILED ${failed.length}:\n  ${failed.slice(0, 5).join('\n  ')}` : ''}`);
  }
}

// ----------------------------------------------------------------- Play ----
async function playToken(): Promise<string> {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  const { token } = await jwt.getAccessToken();
  return token!;
}

async function play(method: string, path: string, token: string, body?: unknown): Promise<any> {
  const res = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Play ${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

const hasFreePhase = (offer: any) => (offer?.phases || []).some((ph: any) =>
  (ph.regionalConfigs || []).some((rc: any) => rc.free !== undefined) || ph.otherRegionsConfig?.free !== undefined);

async function googlePlay() {
  console.log('=== Google Play ===');
  const token = await playToken();
  for (const pid of ['quotemate_premium_monthly', 'quotemate_premium_yearly']) {
    const sub = await play('GET', `/subscriptions/${pid}`, token);
    for (const bp of sub.basePlans || []) {
      const regions: string[] = (bp.regionalConfigs || []).filter((r: any) => r.newSubscriberAvailability).map((r: any) => r.regionCode);
      const list = await play('GET', `/subscriptions/${pid}/basePlans/${bp.basePlanId}/offers`, token);
      const offers: any[] = list.subscriptionOffers || [];
      const free = offers.filter(hasFreePhase);
      if (free.length > 0) {
        console.log(`${pid}/${bp.basePlanId}: already has free offer(s) ${free.map((o) => `${o.offerId}:${o.state}`).join(',')}`);
        for (const o of free) {
          if (o.state === 'ACTIVE') continue;
          if (!APPLY) { console.log(`  would activate ${o.offerId}`); continue; }
          await play('POST', `/subscriptions/${pid}/basePlans/${bp.basePlanId}/offers/${o.offerId}:activate`, token, {});
          console.log(`  activated ${o.offerId}`);
        }
        continue;
      }
      const body = {
        packageName: PKG,
        productId: pid,
        basePlanId: bp.basePlanId,
        offerId: PLAY_OFFER_ID,
        phases: [{
          duration: 'P2W',
          recurrenceCount: 1,
          regionalConfigs: regions.map((regionCode) => ({ regionCode, free: {} })),
        }],
        regionalConfigs: regions.map((regionCode) => ({ regionCode, newSubscriberAvailability: true })),
        targeting: { acquisitionRule: { scope: { thisSubscription: {} } } },
      };
      if (!APPLY) { console.log(`${pid}/${bp.basePlanId}: would create + activate offer ${PLAY_OFFER_ID} for ${regions.join(',')}`); continue; }
      const created = await play('POST', `/subscriptions/${pid}/basePlans/${bp.basePlanId}/offers?offerId=${PLAY_OFFER_ID}&regionsVersion.version=${encodeURIComponent(REGIONS_VERSION)}`, token, body);
      console.log(`${pid}/${bp.basePlanId}: created ${created.offerId} state=${created.state}`);
      const activated = await play('POST', `/subscriptions/${pid}/basePlans/${bp.basePlanId}/offers/${PLAY_OFFER_ID}:activate`, token, {});
      console.log(`${pid}/${bp.basePlanId}: activated → state=${activated.state}`);
    }
  }
}

(async () => {
  console.log(APPLY ? '*** APPLY MODE — writing live store offers ***\n' : '=== DRY RUN (pass --apply to write) ===\n');
  await apple();
  await googlePlay();
})().catch((err) => { console.error(err); process.exit(1); });
