/**
 * Set the AU price on a Google Play subscription base plan.
 *
 * Android has been selling quotemate_premium_* at A$29 / A$199 while the
 * paywall advertises $49 / $328 — the SKU split in billingService.ts points
 * Android at a cheaper pair than iOS. The SKUs must stay as they are (existing
 * subscribers cannot be migrated between subscription products), so the fix is
 * to price them correctly.
 *
 * Existing subscribers are NOT affected: Play applies a base-plan price change
 * to new subscribers only, unless a price migration is explicitly run. This
 * script never runs one.
 *
 * Dry run by default; --apply writes.
 *
 *   npx tsx scripts/setPlayPrice.ts
 *   npx tsx scripts/setPlayPrice.ts --apply
 */
import * as dotenv from 'dotenv';
import { JWT } from 'google-auth-library';

dotenv.config({ path: '.env' });

const APPLY = process.argv.includes('--apply');
const PKG = 'com.quotemate.app';
const BASE = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}/subscriptions`;
// Play requires the caller to state which region catalogue it was written
// against, so a stale client can't silently reprice regions it never saw.
const REGIONS_VERSION = '2022/02';

interface Target { productId: string; basePlanId: string; region: string; newUnits: string }

const TARGETS: Target[] = [
  { productId: 'quotemate_premium_monthly', basePlanId: 'quotemate-monthly', region: 'AU', newUnits: '49' },
  { productId: 'quotemate_premium_yearly', basePlanId: 'quotemate-premium-yearly', region: 'AU', newUnits: '328' },
];

async function bearer(): Promise<string> {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const { token } = await jwt.getAccessToken();
  return token!;
}

const priceStr = (p: any) =>
  p ? `${p.currencyCode} ${(Number(p.units || 0) + (p.nanos || 0) / 1e9).toFixed(2)}` : '(none)';

(async () => {
  console.log(APPLY ? '*** APPLY MODE — writing live prices ***\n' : '=== DRY RUN (pass --apply to write) ===\n');
  const token = await bearer();

  for (const t of TARGETS) {
    const getRes = await fetch(`${BASE}/${t.productId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!getRes.ok) { console.log(`--- ${t.productId}: GET failed ${getRes.status}`); continue; }
    const sub = await getRes.json() as any;

    const plan = (sub.basePlans || []).find((b: any) => b.basePlanId === t.basePlanId);
    if (!plan) { console.log(`--- ${t.productId}: base plan ${t.basePlanId} not found`); continue; }
    const cfg = (plan.regionalConfigs || []).find((c: any) => c.regionCode === t.region);
    if (!cfg) { console.log(`--- ${t.productId}: no ${t.region} regional config`); continue; }

    console.log(`--- ${t.productId} / ${t.basePlanId} (state ${plan.state})`);
    console.log(`    ${t.region}: ${priceStr(cfg.price)}  ->  ${cfg.price.currencyCode} ${Number(t.newUnits).toFixed(2)}`);

    if (priceStr(cfg.price) === `${cfg.price.currencyCode} ${Number(t.newUnits).toFixed(2)}`) {
      console.log('    already at target price — skipping');
      continue;
    }

    // Mutate only the one price; everything else is echoed back untouched.
    cfg.price = { currencyCode: cfg.price.currencyCode, units: t.newUnits };

    if (!APPLY) {
      console.log('    [dry-run] would PATCH basePlans with the above change only');
      continue;
    }

    const url = `${BASE}/${t.productId}?updateMask=basePlans&regionsVersion.version=${encodeURIComponent(REGIONS_VERSION)}`;
    const patchRes = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ basePlans: sub.basePlans }),
    });
    if (!patchRes.ok) {
      console.log(`    PATCH FAILED ${patchRes.status}: ${(await patchRes.text()).slice(0, 300).replace(/\s+/g, ' ')}`);
      continue;
    }
    const updated = await patchRes.json() as any;
    const nowCfg = (updated.basePlans || [])
      .find((b: any) => b.basePlanId === t.basePlanId)?.regionalConfigs
      ?.find((c: any) => c.regionCode === t.region);
    console.log(`    PATCH ok -> ${t.region} now ${priceStr(nowCfg?.price)}`);
  }

  console.log('\nExisting subscribers keep their current price; this affects new purchases only.');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
