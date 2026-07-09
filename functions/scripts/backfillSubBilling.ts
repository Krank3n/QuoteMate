/**
 * backfillSubBilling.ts — restore billing identifiers on a subscription doc.
 *
 * The July 2026 incident restore rewrote users/{uid}/profile/subscription docs
 * without the productId/purchaseToken that receipt validation had stored, so
 * real payers no longer satisfy isBilledSub() and the admin panel's paid count
 * excludes them. This stamps the billing fields back on (source of truth for
 * WHICH accounts actually pay: Play Console / App Store Connect / Stripe).
 *
 * Dry-run by default — prints the doc plus derived billing before/after.
 *
 *   npx ts-node scripts/backfillSubBilling.ts --uid <uid> --product-id <sku> \
 *     [--platform android|ios|web] [--purchase-token <token>] [--apply]
 *
 * Run from the functions/ directory. Needs Application Default Credentials.
 */

import * as admin from 'firebase-admin';
import { deriveSubFields } from '../src/subscription.helpers';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const uid = argValue('--uid');
  const productId = argValue('--product-id');
  const platform = argValue('--platform');
  const purchaseToken = argValue('--purchase-token');
  const apply = process.argv.includes('--apply');

  if (!uid || !productId) {
    console.error(
      'Usage: npx ts-node scripts/backfillSubBilling.ts --uid <uid> --product-id <sku> [--platform android|ios|web] [--purchase-token <token>] [--apply]'
    );
    process.exit(1);
  }
  if (platform && !['android', 'ios', 'web'].includes(platform)) {
    console.error(`Invalid --platform "${platform}" (android|ios|web)`);
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const ref = admin.firestore().doc(`users/${uid}/profile/subscription`);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`No subscription doc at ${ref.path}`);
    process.exit(1);
  }
  const current = snap.data() as any;

  const patch: Record<string, any> = {
    productId,
    billingBackfilledAt: new Date().toISOString(),
  };
  if (platform) patch.platform = platform;
  if (purchaseToken) patch.purchaseToken = purchaseToken;

  const before = deriveSubFields(current);
  const after = deriveSubFields({ ...current, ...patch });
  console.log(`${ref.path}`);
  console.log('current doc:', JSON.stringify(current, null, 2));
  console.log('patch:', JSON.stringify(patch, null, 2));
  console.log(
    `derived before: tier=${before.tier} billed=${before.billed} monthlyAud=${before.monthlyAud}`
  );
  console.log(
    `derived after:  tier=${after.tier} billed=${after.billed} monthlyAud=${after.monthlyAud} interval=${after.interval}`
  );

  if (!apply) {
    console.log('\nDry run — re-run with --apply to write.');
    return;
  }
  await ref.set(patch, { merge: true });
  console.log('\nApplied.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
