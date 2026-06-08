/* eslint-disable no-console */
/**
 * End-to-end test of the deployed `analyzeJobDescription` HTTPS function.
 * Mints a custom token for a test user via Firebase Admin, exchanges it for
 * an ID token, then POSTs a known-tricky job description and prints:
 *   - estimatedHours + jobSummary
 *   - sections inferred from materials
 *   - any flags from validateAndRepairAiOutput (especially hasAbsurdQuantity)
 *   - top-cost line items to spot $94k-style inflation
 *
 *   cd functions && npx ts-node scripts/testDeployedAnalyze.ts
 *
 * Requires:
 *   - Application Default Credentials (gcloud auth application-default login)
 *   - FIREBASE_WEB_API_KEY env var, or VITE_FIREBASE_API_KEY in functions/.env
 */

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TEST_UID = '2eaBCK5elWcShtj0gm0ny9pl7hl1'; // HansenDev — only used to authenticate, not to write
const FUNCTION_URL = 'https://us-central1-hansendev.cloudfunctions.net/analyzeJobDescription';
const PROJECT_ID = 'hansendev';
// IAM Credentials signBlob path so ADC can mint custom tokens without a
// local private key. Mirrors sendLatestQuoteAsTest.ts.
const FIREBASE_ADMIN_SA = 'firebase-adminsdk-fbsvc@hansendev.iam.gserviceaccount.com';

const JOB_DESCRIPTION = `Supply and installation of 22 metres of 1.2-metre tall weld mesh and timber fencing across the front of the property.

- Supply and install 22 metres of 1.2-metre tall weld mesh and timber fencing
- Supply and install 2 access gates`;

async function mintIdToken(uid: string): Promise<string> {
  // 1. Custom token via Admin SDK
  const customToken = await admin.auth().createCustomToken(uid);
  // 2. Exchange custom token → ID token via Identity Toolkit
  const apiKey =
    process.env.FIREBASE_WEB_API_KEY ||
    process.env.VITE_FIREBASE_API_KEY ||
    process.env.FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'No FIREBASE_WEB_API_KEY / VITE_FIREBASE_API_KEY env var set. Grab the web API key from https://console.firebase.google.com/project/hansendev/settings/general',
    );
  }
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  if (!resp.ok) {
    throw new Error(`Custom-token exchange failed: ${resp.status} ${await resp.text()}`);
  }
  const json = await resp.json() as any;
  return json.idToken as string;
}

async function main(): Promise<void> {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID, serviceAccountId: FIREBASE_ADMIN_SA });
  }

  console.log('1. Minting ID token…');
  const idToken = await mintIdToken(TEST_UID);
  console.log('   ✓ Token acquired\n');

  console.log('2. POST /analyzeJobDescription with QU-177971-style description…');
  console.log(`   ${JOB_DESCRIPTION.split('\n')[0]}\n`);

  const t0 = Date.now();
  const resp = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      jobDescription: JOB_DESCRIPTION,
      tradeContext: {
        categoryName: 'Landscaping',
        nicheName: 'Fencing',
      },
    }),
  });
  const elapsed = Date.now() - t0;
  console.log(`   HTTP ${resp.status} in ${elapsed} ms`);

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`   ✗ Function returned non-2xx: ${body.slice(0, 500)}`);
    process.exit(1);
  }

  const body = await resp.json() as any;

  console.log('\n3. Top-level response shape');
  console.log(`   jobSummary       = "${body.jobSummary}"`);
  console.log(`   estimatedHours   = ${body.estimatedHours}`);
  console.log(`   materials.length = ${(body.materials || []).length}`);
  console.log(`   flags            = ${JSON.stringify(body.flags || null)}`);

  const materials = (body.materials || []) as any[];

  console.log('\n4. Section breakdown (from sectionMultiplier + sectionLaborHours)');
  const bySection = new Map<string, { mul?: number; hrs?: number; count: number }>();
  for (const m of materials) {
    const key = m.section || '(unsectioned)';
    const e = bySection.get(key) || { mul: m.sectionMultiplier, hrs: m.sectionLaborHours, count: 0 };
    e.count++;
    if (!e.mul && m.sectionMultiplier) e.mul = m.sectionMultiplier;
    if (!e.hrs && m.sectionLaborHours) e.hrs = m.sectionLaborHours;
    bySection.set(key, e);
  }
  for (const [name, info] of bySection) {
    console.log(`   • ${name.padEnd(50)} mul=${info.mul ?? '?'}  perUnitHrs=${info.hrs ?? '?'}  materials=${info.count}`);
  }

  console.log('\n5. Top 10 highest-quantity rows (looking for inflation)');
  const sortedByQty = [...materials].sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0));
  for (const m of sortedByQty.slice(0, 10)) {
    const flag = m.pricingSource === 'absurd_quantity' ? ' ⚠️ ABSURD' :
                 m.pricingSource === 'invalid_unit' ? ' ⚠️ BAD UNIT' : '';
    console.log(`   • qty=${String(m.quantity).padStart(7)}  unit=${(m.unit || '?').padEnd(5)}  "${m.name}"${flag}`);
  }

  console.log('\n6. Verdicts');
  const flags = body.flags || {};
  const concrete = materials.find((m) =>
    /concrete|post mix|footing/i.test(m.name || '') && /pack|bag/i.test(m.unit || ''),
  );
  if (concrete) {
    const ok = concrete.quantity <= 80;
    console.log(`   Concrete pack qty for 22m fence (expected ≤ ~50–80): ${concrete.quantity}  ${ok ? '✅' : '❌'}`);
  }
  console.log(`   flags.hasAbsurdQuantity:    ${flags.hasAbsurdQuantity}  ${flags.hasAbsurdQuantity ? '⚠️ (regression — re-check prompt)' : '✅'}`);
  console.log(`   flags.hasInvalidUnit:       ${flags.hasInvalidUnit}`);
  console.log(`   flags.hasZeroLabourSection: ${flags.hasZeroLabourSection}`);
  console.log(`   flags.hasZeroPricedMaterial:${flags.hasZeroPricedMaterial}`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
