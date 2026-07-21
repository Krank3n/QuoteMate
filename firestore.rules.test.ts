/**
 * Firestore security-rules tests (PAY-02 / PAY-03) — run against the
 * emulator via `npm run test:rules`, NOT part of the default vitest run.
 *
 * Proves that a client can no longer write subscription entitlements
 * (the owner wildcard previously allowed any authenticated user to set
 * isPro/platformFeeBps/productId on their own profile/subscription doc),
 * while the legitimate client quota/trial writes keep working.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;

const SUB_PATH = 'users/alice/profile/subscription';

const quotaSeed = {
  isPro: false,
  quotesThisMonth: 1,
  currentPeriodStart: '2026-07-01T00:00:00.000Z',
  currentPeriodEnd: '2026-07-31T23:59:59.000Z',
  trialStartedAt: '2026-07-10T00:00:00.000Z',
  syncedAt: '2026-07-17T00:00:00.000Z',
};

const serverProDoc = {
  isPro: true,
  platform: 'ios',
  productId: 'quotemate_pro_monthly',
  transactionId: 'txn-1',
  appleValidated: true,
  quotesThisMonth: 2,
  currentPeriodEnd: '2026-08-01T00:00:00.000Z',
};

function aliceDb() {
  return env.authenticatedContext('alice').firestore();
}

async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-quotemate-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe('users/{uid}/profile/subscription (PAY-02)', () => {
  it('denies creating the doc with isPro:true', async () => {
    await assertFails(setDoc(doc(aliceDb(), SUB_PATH), { ...quotaSeed, isPro: true }));
  });

  it('denies creating the doc with entitlement keys (productId/platform/platformFeeBps)', async () => {
    await assertFails(setDoc(doc(aliceDb(), SUB_PATH), { ...quotaSeed, productId: 'quotemate_pro_monthly' }));
    await assertFails(setDoc(doc(aliceDb(), SUB_PATH), { ...quotaSeed, platform: 'ios' }));
    await assertFails(setDoc(doc(aliceDb(), SUB_PATH), { ...quotaSeed, platformFeeBps: 100 }));
  });

  it('denies creating the doc with a client plan string (PAY-02 free-gate bypass)', async () => {
    await assertFails(setDoc(doc(aliceDb(), SUB_PATH), { ...quotaSeed, plan: 'trial' }));
    await assertFails(setDoc(doc(aliceDb(), SUB_PATH), { ...quotaSeed, plan: 'pro' }));
    await assertFails(setDoc(doc(aliceDb(), SUB_PATH), { ...quotaSeed, plan: 'free' }));
  });

  it('allows the client quota/trial seed (isPro:false + bookkeeping fields)', async () => {
    await assertSucceeds(setDoc(doc(aliceDb(), SUB_PATH), quotaSeed));
  });

  it('denies a free user flipping isPro to true — the original PAY-02 exploit', async () => {
    await seed(SUB_PATH, quotaSeed);
    await assertFails(updateDoc(doc(aliceDb(), SUB_PATH), { isPro: true }));
  });

  it('denies a free user granting entitlement fields on update', async () => {
    await seed(SUB_PATH, quotaSeed);
    await assertFails(updateDoc(doc(aliceDb(), SUB_PATH), { platformFeeBps: 100 }));
    await assertFails(updateDoc(doc(aliceDb(), SUB_PATH), { productId: 'quotemate_pro_yearly' }));
    await assertFails(updateDoc(doc(aliceDb(), SUB_PATH), { plan: 'pro' }));
  });

  it('denies an expired-trial free user setting plan:trial to dodge the free-tier gate (PAY-02 MAJOR-1)', async () => {
    // Trial started 30 days ago → server derives 'free'. Writing plan:'trial'
    // must not be able to flip the server back to the Pro-rate trial tier.
    await seed(SUB_PATH, { ...quotaSeed, trialStartedAt: '2026-06-17T00:00:00.000Z' });
    await assertFails(updateDoc(doc(aliceDb(), SUB_PATH), { plan: 'trial' }));
    await assertFails(updateDoc(doc(aliceDb(), SUB_PATH), { plan: 'free' }));
  });

  it('denies removing plan from a server-written Pro doc', async () => {
    await seed(SUB_PATH, { ...serverProDoc, plan: 'pro' });
    // Full set() that drops the server plan field.
    await assertFails(setDoc(doc(aliceDb(), SUB_PATH), quotaSeed));
  });

  it('denies the old-client full setDoc that would clobber server billing fields', async () => {
    await seed(SUB_PATH, serverProDoc);
    // Pre-fix saveSubscriptionStatus: non-merge set() of the local mirror —
    // deletes platform/productId/appleValidated and flips isPro.
    await assertFails(setDoc(doc(aliceDb(), SUB_PATH), quotaSeed));
  });

  it('denies clobbering a server-granted isPro:true back to false', async () => {
    await seed(SUB_PATH, serverProDoc);
    await assertFails(updateDoc(doc(aliceDb(), SUB_PATH), { isPro: false }));
  });

  it('allows the client quota transaction shape: full set() that leaves entitlement values unchanged', async () => {
    await seed(SUB_PATH, serverProDoc);
    await assertSucceeds(setDoc(doc(aliceDb(), SUB_PATH), {
      ...serverProDoc,
      quotesThisMonth: 3,
      syncedAt: '2026-07-17T01:00:00.000Z',
    }));
  });

  it('allows the new whitelisted merge payload on a Pro doc', async () => {
    await seed(SUB_PATH, serverProDoc);
    await assertSucceeds(setDoc(doc(aliceDb(), SUB_PATH), {
      quotesThisMonth: 4,
      currentPeriodStart: '2026-07-01T00:00:00.000Z',
      currentPeriodEnd: '2026-07-31T23:59:59.000Z',
      freeQuotesLimit: 5,
      trialStartedAt: null,
      trialExpired: false,
      dismissedUpgradeBanner: true,
      syncedAt: '2026-07-17T01:00:00.000Z',
    }, { merge: true }));
  });

  it('denies deleting the subscription doc', async () => {
    await seed(SUB_PATH, quotaSeed);
    await assertFails(deleteDoc(doc(aliceDb(), SUB_PATH)));
  });

  it('denies any access by another user', async () => {
    await seed(SUB_PATH, serverProDoc);
    const mallory = env.authenticatedContext('mallory').firestore();
    await assertFails(getDoc(doc(mallory, SUB_PATH)));
    await assertFails(updateDoc(doc(mallory, SUB_PATH), { quotesThisMonth: 0 }));
  });
});

describe('the rest of the user tree keeps working', () => {
  it('owner can still read/write the user root doc', async () => {
    await assertSucceeds(setDoc(doc(aliceDb(), 'users/alice'), { name: 'Alice' }));
    await assertSucceeds(getDoc(doc(aliceDb(), 'users/alice')));
  });

  it('owner can still write other profile docs and subcollections', async () => {
    await assertSucceeds(setDoc(doc(aliceDb(), 'users/alice/profile/business'), { businessName: 'Alice Fencing' }));
    await assertSucceeds(setDoc(doc(aliceDb(), 'users/alice/settings/promptState'), { lastPromptAt: 1 }));
    await assertSucceeds(setDoc(doc(aliceDb(), 'users/alice/quotes/q1'), { total: 100 }));
  });

  it('owner can still read the subscription doc', async () => {
    await seed(SUB_PATH, serverProDoc);
    await assertSucceeds(getDoc(doc(aliceDb(), SUB_PATH)));
  });

  it('owner can still write deeply nested docs', async () => {
    await assertSucceeds(setDoc(doc(aliceDb(), 'users/alice/jobs/j1/notes/n1'), { text: 'g’day' }));
  });

  it('non-owner still has no access to the user tree', async () => {
    const mallory = env.authenticatedContext('mallory').firestore();
    await assertFails(getDoc(doc(mallory, 'users/alice/quotes/q1')));
    await assertFails(setDoc(doc(mallory, 'users/alice/quotes/q1'), { total: 0 }));
  });
});

describe('squareOAuthStates (PAY-03)', () => {
  it('denies all client access, even authenticated', async () => {
    await seed('squareOAuthStates/somehash', { uid: 'alice', createdAtMs: 1 });
    await assertFails(getDoc(doc(aliceDb(), 'squareOAuthStates/somehash')));
    await assertFails(setDoc(doc(aliceDb(), 'squareOAuthStates/forged'), { uid: 'alice', createdAtMs: 1 }));
  });
});
