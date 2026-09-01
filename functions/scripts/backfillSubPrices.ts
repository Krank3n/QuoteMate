/**
 * backfillSubPrices.ts — stamp the price each subscriber is REALLY charged
 * onto their subscription doc.
 *
 * MRR used to be computed from today's list price ($49/mo, $328/yr), which is
 * wrong for anyone grandfathered on an older SKU — the Android plans were
 * A$29/A$199 until 2026-08-04 and Play keeps billing existing subscribers at
 * the price they signed up on. This reads the real amount from the source that
 * charges it and writes priceMicros/priceCurrency/priceInterval, which
 * subscription.helpers subPriceInfo() prefers over the list price.
 *
 * Sources, in order of what a doc can support:
 *   - iOS:     the signed StoreKit 2 JWS already stored on the doc (offline).
 *   - Android: Play Developer API purchases.subscriptions.get.
 *   - Web:     the Stripe price on the subscription.
 *
 * Dry-run by default — prints every change it would make.
 *
 *   cd functions && npx ts-node scripts/backfillSubPrices.ts [--apply]
 *
 * Needs Application Default Credentials (gcloud auth application-default
 * login on hansendev) plus functions/.env for the Play/Stripe credentials.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import {
  appleJwsPayload,
  isBilledSub,
  storePricePatch,
  subInterval,
  subPriceInfo,
} from '../src/subscription.helpers';

const APPLY = process.argv.includes('--apply');
const PACKAGE_NAME = process.env.GOOGLE_PACKAGE_NAME || 'com.quotemate.app';

// The functions runtime gets these from the deployed env; a local script has to
// read the same .env by hand.
function loadEnvFile(): void {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }
}

let playToken: string | null = null;
async function playAccessToken(): Promise<string | null> {
  if (playToken) return playToken;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const sa = JSON.parse(raw);
  const { JWT } = require('google-auth-library');
  const client = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const { token } = await client.getAccessToken();
  playToken = token || null;
  return playToken;
}

async function androidPrice(sub: any): Promise<{ micros: number; currency: string } | null> {
  if (!sub?.purchaseToken || !sub?.productId) return null;
  const token = await playAccessToken();
  if (!token) return null;
  const url =
    'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
    `${encodeURIComponent(PACKAGE_NAME)}/purchases/subscriptions/` +
    `${encodeURIComponent(sub.productId)}/tokens/${encodeURIComponent(sub.purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.warn(`  ! Play API ${res.status} — ${(await res.text()).slice(0, 160)}`);
    return null;
  }
  const data = (await res.json()) as any;
  const micros = Number(data?.priceAmountMicros);
  const currency = data?.priceCurrencyCode;
  return Number.isFinite(micros) && micros > 0 && currency ? { micros, currency } : null;
}

async function stripePrice(sub: any): Promise<{ micros: number; currency: string; interval: 'yearly' | 'monthly' } | null> {
  if (!sub?.subscriptionId) return null;
  const key = process.env.STRIPE_MODE === 'live'
    ? process.env.STRIPE_LIVE_SECRET_KEY
    : process.env.STRIPE_TEST_SECRET_KEY;
  if (!key) return null;
  const Stripe = require('stripe');
  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });
  try {
    const s = await stripe.subscriptions.retrieve(sub.subscriptionId);
    const price = s.items?.data?.[0]?.price;
    if (!price || price.unit_amount == null) return null;
    return {
      micros: price.unit_amount * 10000, // cents → micros
      currency: price.currency,
      interval: price.recurring?.interval === 'year' ? 'yearly' : 'monthly',
    };
  } catch (err) {
    console.warn(`  ! Stripe lookup failed — ${String(err).slice(0, 160)}`);
    return null;
  }
}

async function main() {
  loadEnvFile();
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();
  const snap = await db.collectionGroup('profile').get();

  let checked = 0;
  let stamped = 0;
  let unchanged = 0;
  const unresolved: string[] = [];

  for (const doc of snap.docs) {
    if (doc.id !== 'subscription') continue;
    const sub = doc.data();
    if (!isBilledSub(sub)) continue;
    const uid = doc.ref.parent.parent?.id || '(unknown)';
    checked++;

    const platform = String(sub.platform || '').toLowerCase();
    let patch: Record<string, any> = {};

    if (platform === 'ios') {
      const jws = appleJwsPayload(sub);
      patch = storePricePatch({
        micros: Number(jws?.price) * 1000, // Apple quotes milliunits
        currency: jws?.currency,
        interval: subInterval(sub),
        source: 'apple',
      });
    } else if (platform === 'android') {
      const play = await androidPrice(sub);
      patch = storePricePatch({
        micros: play?.micros,
        currency: play?.currency,
        interval: subInterval(sub),
        source: 'google',
      });
    } else if (platform === 'web') {
      const price = await stripePrice(sub);
      patch = storePricePatch({
        micros: price?.micros,
        currency: price?.currency,
        interval: price?.interval || subInterval(sub),
        source: 'stripe',
      });
    }

    if (!Object.keys(patch).length) {
      const guess = subPriceInfo(sub);
      unresolved.push(`${uid} (${platform || 'no platform'} ${sub.productId || sub.subscriptionId || '?'}) — still priced at the ${guess.source} $${guess.amount}`);
      continue;
    }

    const before = subPriceInfo(sub);
    const after = subPriceInfo({ ...sub, ...patch });
    if (before.source === 'store' && before.amount === after.amount && before.currency === after.currency) {
      unchanged++;
      continue;
    }

    stamped++;
    console.log(
      `${uid} ${platform} ${sub.productId || sub.subscriptionId}: ` +
      `${before.source} ${before.currency} ${before.amount} → store ${after.currency} ${after.amount} (${after.interval})`
    );
    if (APPLY) await doc.ref.set(patch, { merge: true });
  }

  console.log(`\n${checked} billed subs · ${stamped} ${APPLY ? 'stamped' : 'would be stamped'} · ${unchanged} already accurate`);
  if (unresolved.length) {
    console.log(`\n${unresolved.length} could not be priced from the store:`);
    for (const line of unresolved) console.log(`  - ${line}`);
  }
  if (!APPLY) console.log('\nDry run — re-run with --apply to write.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
