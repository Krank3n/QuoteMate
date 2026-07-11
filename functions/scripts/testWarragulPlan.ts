/* eslint-disable no-console */
/**
 * End-to-end replay of Craig's Warragul finishes plan against the DEPLOYED
 * `analyzeJobDescription` function — validates the anchor-scale takeoff on
 * the one job we have physical ground truth for.
 *
 *   cd functions && npx ts-node scripts/testWarragulPlan.ts <path-to-plan.png> [runLabel]
 *
 * Ground truth (Craig's on-site measurements, 20 Jun 2026 email):
 *   total 680 m² | FC01 524 | FC02 76.6 | FC03 80 | FC05 8
 *   wet-area perimeter 95.4 lm (85 lm coved skirting after doorways)
 *   strip-out bin: ~7 m³ used of an 8 m³ bin
 *
 * Requires ADC + FIREBASE_WEB_API_KEY / VITE_FIREBASE_API_KEY (same as
 * testDeployedAnalyze.ts).
 */

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TEST_UID = '2eaBCK5elWcShtj0gm0ny9pl7hl1'; // HansenDev — only used to authenticate, not to write
const FUNCTION_URL = 'https://us-central1-hansendev.cloudfunctions.net/analyzeJobDescription';
const PROJECT_ID = 'hansendev';
const FIREBASE_ADMIN_SA = 'firebase-adminsdk-fbsvc@hansendev.iam.gserviceaccount.com';

const JOB_DESCRIPTION = `Commercial flooring job — SCS building, Percy Street, Warragul.

Strip out and dispose of existing flooring: 2mm sheet vinyl throughout plus 9 m2 of ceramic tiles.
Floor prep and installation per the attached finishes plan:
- FC01 Airlay Oakwood LVT planks (Blond Oak)
- FC02 Airlay Pebble Carpet planks (Reef)
- FC03 Airlay Super Safety sheet vinyl (Stone Taupe) including 150mm coved skirting
- FC05 Spectrum Excellence Entry Mat (Anthracite)

Total length of the building is 49.0m (physically measured on site).`;

const GROUND_TRUTH = {
  totalAreaM2: 680,
  zones: { FC01: 524, FC02: 76.6, FC03: 80, FC05: 8 },
  wetPerimeterLm: 95.4,
  covedSkirtingLm: 85,
  binM3Used: 7,
};

async function mintIdToken(uid: string): Promise<string> {
  const customToken = await admin.auth().createCustomToken(uid);
  const apiKey =
    process.env.FIREBASE_WEB_API_KEY ||
    process.env.VITE_FIREBASE_API_KEY ||
    process.env.FIREBASE_API_KEY;
  if (!apiKey) throw new Error('No FIREBASE_WEB_API_KEY / VITE_FIREBASE_API_KEY set');
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  if (!resp.ok) throw new Error(`Custom-token exchange failed: ${resp.status} ${await resp.text()}`);
  return ((await resp.json()) as any).idToken as string;
}

function pct(model: number | undefined, truth: number): string {
  if (typeof model !== 'number' || !isFinite(model)) return 'n/a';
  const d = ((model - truth) / truth) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}

async function main(): Promise<void> {
  const planPath = process.argv[2];
  const label = process.argv[3] || 'run';
  if (!planPath || !fs.existsSync(planPath)) {
    throw new Error(`Plan image not found: ${planPath}`);
  }
  const planB64 = fs.readFileSync(planPath).toString('base64');

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID, serviceAccountId: FIREBASE_ADMIN_SA });
  }
  const idToken = await mintIdToken(TEST_UID);

  const t0 = Date.now();
  const resp = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      jobDescription: JOB_DESCRIPTION,
      tradeContext: { categoryName: 'Flooring', nicheName: 'Commercial flooring' },
      photoBase64: [planB64],
    }),
  });
  const elapsed = Math.round((Date.now() - t0) / 1000);
  if (!resp.ok) {
    console.error(`HTTP ${resp.status} after ${elapsed}s: ${(await resp.text()).slice(0, 500)}`);
    process.exit(1);
  }
  const body = (await resp.json()) as any;
  const fp = body.floorplanAnalysis;

  console.log(`\n===== ${label} (HTTP 200 in ${elapsed}s) =====`);
  if (!fp || !fp.detected) {
    console.log('floorplanAnalysis: NOT DETECTED — raw:', JSON.stringify(fp));
  } else {
    console.log(`confidence=${fp.confidence} scaledToAnchor=${fp.scaledToAnchor} factor=${fp.scaleFactorApplied}`);
    console.log(`calibration=${JSON.stringify(fp.calibration)} footprintDims=${JSON.stringify(fp.footprintDims)}`);
    console.log(`totalAreaM2=${fp.totalAreaM2}  (truth ${GROUND_TRUTH.totalAreaM2}, ${pct(fp.totalAreaM2, GROUND_TRUTH.totalAreaM2)})`);
    console.log(`perimeterM=${fp.perimeterM}  removalAreaM2=${fp.removalAreaM2}  removalBinM3=${fp.removalBinM3} (truth ~${GROUND_TRUTH.binM3Used})`);
    for (const z of fp.zones || []) {
      const code = (z.code || z.name || '').toUpperCase();
      const truthKey = Object.keys(GROUND_TRUTH.zones).find((k) => code.includes(k));
      const truth = truthKey ? (GROUND_TRUTH.zones as any)[truthKey] : undefined;
      console.log(
        `  zone ${z.code || '?'} "${z.name || ''}" area=${z.areaM2}` +
          (truth ? `  (truth ${truth}, ${pct(z.areaM2, truth)})` : ''),
      );
    }
    console.log(`assumptions: ${fp.assumptions || '(none)'}`);
  }
  console.log(`estimatedHours=${body.estimatedHours} materials=${(body.materials || []).length} flags=${JSON.stringify(body.flags || null)}`);

  const outPath = path.join(__dirname, '..', `warragul-replay-${label}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ label, elapsed, floorplanAnalysis: fp, estimatedHours: body.estimatedHours, materialsCount: (body.materials || []).length, materials: body.materials, flags: body.flags }, null, 2));
  console.log(`full response → ${outPath}`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
