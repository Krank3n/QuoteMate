/**
 * Mint a short-lived Firebase ID token for backend-mode pricing, self-served via
 * the project's admin credentials (no password). Requires:
 *   - gcloud Application Default Credentials present, AND
 *   - the ADC identity granted roles/iam.serviceAccountTokenCreator on
 *     firebase-adminsdk-fbsvc@hansendev.iam.gserviceaccount.com
 *
 * Writes out/.firebase_token (id token, ~1h) + out/.firebase_refresh. Re-run to
 * refresh. Both files live under out/ (gitignored).
 *
 *   node marketing-video/mint-token.cjs
 */
const path = require('path');
const fs = require('fs');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const OUT = path.join(__dirname, 'out');
const WEBKEY = 'AIzaSyBACasUs7AwAQt_5VcfnEjBRan7AvAM5lw';

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  serviceAccountId: 'firebase-adminsdk-fbsvc@hansendev.iam.gserviceaccount.com',
  projectId: 'hansendev',
});

(async () => {
  const ct = await admin.auth().createCustomToken('qm-marketing-demo');
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEBKEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: ct, returnSecureToken: true }),
  });
  const j = await res.json();
  if (!j.idToken) {
    console.log('exchange FAILED: ' + JSON.stringify(j).slice(0, 400));
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, '.firebase_token'), j.idToken);
  fs.writeFileSync(path.join(OUT, '.firebase_refresh'), j.refreshToken || '');
  console.log(`ID token: OK (expires in ${j.expiresIn}s) -> out/.firebase_token`);
})().catch((e) => {
  console.log('mint FAILED: ' + (e.message || e));
  process.exit(1);
});
