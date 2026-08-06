/**
 * Recover store purchases that were charged but never entitled during the
 * 2026-07-19 → 2026-08-04 receipt-validation outage.
 *
 * The client only re-validates from PaywallScreen, so these buyers would never
 * self-heal by reopening the app. Both stores let us recover server-side from
 * the identifiers we logged at failure time:
 *
 *   iOS      transactionId → App Store Server API → signedTransactionInfo (JWS)
 *   Android  orderId       → Play orders.get      → purchaseToken
 *
 * Writes the same subscription doc the endpoints write, and — critically for
 * Android — ACKNOWLEDGES the purchase. Google auto-refunds unacknowledged
 * purchases after ~3 days, and nothing server-side has ever acknowledged;
 * that only happened client-side via finishTransaction.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   npx tsx scripts/recoverStuckPurchases.ts [--apply]
 */
// MUST be first: src/email.ts reads process.env.ADMIN_EMAILS at module scope,
// and ES imports are hoisted — a dotenv.config() call further down runs too
// late, leaving the admin alert with no recipient.
import 'dotenv/config';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { JWT } from 'google-auth-library';
import { verifyAppleJws } from '../src/appleJws.helpers';
import { receiptVerdict } from '../src/receiptValidation.helpers';
import { sendNewProSubscriptionEmail } from '../src/email';

admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'hansendev' });

const APPLY = process.argv.includes('--apply');
const PKG = 'com.quotemate.app';
const BUNDLE = 'com.hansendev.quotemate';

type Target =
  | { platform: 'ios'; uid: string; email: string; transactionId: string; productId: string }
  | { platform: 'android'; uid: string; email: string; orderId: string; productId: string };

// Sourced from the [receipts] "not granted" logs across the outage window.
const TARGETS: Target[] = [
  {
    platform: 'ios',
    uid: '5A16KePABKXOg1MQVMeHjHQgfrg1',
    email: 'jaked@coastalhvac.com.au',
    transactionId: '510002785520736',
    productId: 'quotemate_pro_yearly',
  },
  {
    // One human, two accounts: he re-signed-up 11 min after the failure. The
    // entitlement follows the account he actually works in (9 sent quotes vs 1)
    // and that made the purchase.
    platform: 'android',
    uid: 'xA9dyzrb2PUDsw26CThVeIFUEAH2',
    email: 'chigazelectsolutions26@gmail.com',
    orderId: 'GPA.3338-8160-7569-98540',
    productId: 'quotemate_premium_monthly',
  },
];

function ascJwt(): string {
  const keyId = process.env.ASC_KEY_ID!;
  const issuerId = process.env.ASC_ISSUER_ID!;
  const pk = (process.env.ASC_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const input =
    b64({ alg: 'ES256', kid: keyId, typ: 'JWT' }) + '.' +
    b64({ iss: issuerId, iat: now, exp: now + 900, aud: 'appstoreconnect-v1', bid: BUNDLE });
  const sig = crypto.sign('sha256', Buffer.from(input), { key: pk, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${input}.${sig}`;
}

async function playToken(): Promise<string> {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const { token } = await jwt.getAccessToken();
  return token!;
}

async function writeEntitlement(t: Target, fields: Record<string, unknown>, expiry: Date) {
  const ref = admin.firestore().doc(`users/${t.uid}/profile/subscription`);
  const payload = {
    isPro: true,
    platform: t.platform,
    productId: t.productId,
    quotesThisMonth: 0,
    validatedAt: admin.firestore.FieldValue.serverTimestamp(),
    currentPeriodStart: new Date(),
    currentPeriodEnd: expiry,
    // Mark the provenance so this is distinguishable from a device validation.
    recoveredFromOutage: 'receipt-validation-2026-07',
    ...fields,
  };
  if (!APPLY) {
    console.log('    [dry-run] would write:', JSON.stringify(
      { ...payload, validatedAt: '<serverTimestamp>', purchaseToken: fields.purchaseToken ? '<token>' : undefined },
    ));
    console.log('    [dry-run] would send the "New Pro subscriber" admin alert');
    return;
  }
  await ref.set(payload, { merge: true });
  console.log('    WROTE entitlement');
  await notifyNewPro(t, String(payload.productId));
}

/**
 * The validate endpoints send this on a successful grant. Recovering straight
 * into Firestore skipped it, so a recovered subscriber landed silently — the
 * admin alert is the only passive signal that anyone upgraded at all.
 */
async function notifyNewPro(t: Target, productId: string) {
  try {
    const [authRec, biz] = await Promise.all([
      admin.auth().getUser(t.uid).catch(() => null),
      // settings/business, not profile/business — the latter does not exist,
      // which is why historical alerts arrived with a blank business name.
      admin.firestore().doc(`users/${t.uid}/settings/business`).get(),
    ]);
    const email = authRec?.email || t.email;
    const businessName = biz.data()?.businessName || '';
    const ok = await sendNewProSubscriptionEmail(email, t.uid, t.platform, productId, businessName);
    console.log(`    admin alert ${ok ? 'sent' : 'NOT sent (sendEmail returned false)'} — ${businessName || '(no business name)'}`);
  } catch (err) {
    // Never let a notification failure look like a failed recovery.
    console.log('    admin alert FAILED:', String(err).slice(0, 140));
  }
}

(async () => {
  console.log(APPLY ? '*** APPLY MODE — writing ***\n' : '=== DRY RUN (pass --apply to write) ===\n');

  for (const t of TARGETS) {
    console.log(`--- ${t.email} (${t.platform})`);

    if (t.platform === 'ios') {
      const res = await fetch(`https://api.storekit.itunes.apple.com/inApps/v1/transactions/${t.transactionId}`, {
        headers: { Authorization: `Bearer ${ascJwt()}` },
      });
      if (!res.ok) { console.log('    App Store Server API failed:', res.status, (await res.text()).slice(0, 160)); continue; }
      const { signedTransactionInfo } = await res.json() as any;

      const v = await verifyAppleJws(signedTransactionInfo);
      const verdict = receiptVerdict({ outcome: v.outcome, storeExpiry: v.expiryDate, productId: v.productId || t.productId, now: new Date() });
      console.log(`    verified=${v.outcome} env=${v.environment} product=${v.productId} expiry=${v.expiryDate?.toISOString()}`);
      if (!verdict.grant) { console.log('    NOT GRANTABLE:', JSON.stringify(verdict)); continue; }

      await writeEntitlement(t, {
        productId: v.productId || t.productId,
        transactionId: v.transactionId || t.transactionId,
        purchaseToken: signedTransactionInfo,
        environment: v.environment,
        appleValidated: true,
      }, verdict.expiryDate);
      continue;
    }

    // Android
    const bearer = await playToken();
    const ordRes = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}/orders/${t.orderId}`,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    if (!ordRes.ok) { console.log('    orders.get failed:', ordRes.status, (await ordRes.text()).slice(0, 160)); continue; }
    const order = await ordRes.json() as any;
    const purchaseToken: string = order.purchaseToken;
    console.log(`    order state=${order.state} createTime=${order.createTime}`);

    const subRes = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}/purchases/subscriptionsv2/tokens/${purchaseToken}`,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    if (!subRes.ok) { console.log('    subscriptionsv2 failed:', subRes.status); continue; }
    const sub = await subRes.json() as any;
    const line = (sub.lineItems || [])[0] || {};
    const expiry = line.expiryTime ? new Date(line.expiryTime) : null;
    console.log(`    state=${sub.subscriptionState} ack=${sub.acknowledgementState} product=${line.productId} expiry=${line.expiryTime} test=${!!sub.testPurchase}`);

    const outcome = sub.subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE' && expiry && expiry > new Date() ? 'valid' : 'invalid';
    const verdict = receiptVerdict({ outcome: outcome as any, storeExpiry: expiry, productId: line.productId || t.productId, now: new Date() });
    if (!verdict.grant) { console.log('    NOT GRANTABLE:', JSON.stringify(verdict)); continue; }

    await writeEntitlement(t, {
      productId: line.productId || t.productId,
      transactionId: sub.latestOrderId || t.orderId,
      purchaseToken,
      googleValidated: true,
    }, verdict.expiryDate);

    // Acknowledge — otherwise Google refunds it and the sale is lost.
    if (sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
      if (!APPLY) {
        console.log('    [dry-run] would ACKNOWLEDGE the purchase (stops the auto-refund clock)');
      } else {
        const ackRes = await fetch(
          `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}/purchases/subscriptions/${line.productId}/tokens/${purchaseToken}:acknowledge`,
          { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: '{}' },
        );
        console.log('    ACKNOWLEDGE ->', ackRes.status, ackRes.ok ? '(refund clock stopped)' : (await ackRes.text()).slice(0, 160));
      }
    } else {
      console.log('    already acknowledged');
    }
  }

  console.log('\ndone.');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
