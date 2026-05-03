/**
 * One-off: send a user's latest quote as a TEST email to a recipient
 * (e.g. admin) without flipping quote status to 'sent'.
 *
 * Mints a custom token for the target user, exchanges it via Identity Toolkit
 * for an ID token, and POSTs to the deployed sendQuoteEmail HTTP endpoint
 * with isTestSend=true. Same code path the app uses for previews.
 *
 * NOTE: even with isTestSend=true, the unified handler rotates
 * `acceptanceTokenHash` on the quote doc — so if the quote has ALREADY been
 * sent to a real customer, this will invalidate that customer's acceptance
 * link. The dry-run prints the current status so you can decide.
 *
 * Dry-run by default. Pass --confirm to actually send.
 *
 * Usage (from functions/):
 *   npm run build
 *   node lib/scripts/sendLatestQuoteAsTest.js <user-email> <recipient-email>            # dry-run
 *   node lib/scripts/sendLatestQuoteAsTest.js <user-email> <recipient-email> --confirm  # send
 *
 * Requires Application Default Credentials.
 */

import * as admin from 'firebase-admin';

const PROJECT_ID = 'hansendev';
const WEB_API_KEY = 'AIzaSyBACasUs7AwAQt_5VcfnEjBRan7AvAM5lw';
const SEND_QUOTE_URL = 'https://us-central1-hansendev.cloudfunctions.net/sendQuoteEmail';
// Pinning the SA email so admin SDK uses IAM Credentials signBlob to mint
// custom tokens. Local Application Default Credentials don't carry a private
// key, so without this admin.auth().createCustomToken() throws looking for
// the GCE metadata service.
const FIREBASE_ADMIN_SA = 'firebase-adminsdk-fbsvc@hansendev.iam.gserviceaccount.com';

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  const userEmail = positional[0];
  const recipientEmail = positional[1];
  const confirm = args.includes('--confirm');

  if (!userEmail || !recipientEmail) {
    console.error('Usage: sendLatestQuoteAsTest.js <user-email> <recipient-email> [--confirm]');
    process.exit(1);
  }

  admin.initializeApp({ projectId: PROJECT_ID, serviceAccountId: FIREBASE_ADMIN_SA });
  const auth = admin.auth();
  const db = admin.firestore();

  console.log(`\nProject:   ${PROJECT_ID}`);
  console.log(`User:      ${userEmail}`);
  console.log(`Recipient: ${recipientEmail}`);
  console.log(`Mode:      ${confirm ? 'SEND' : 'DRY RUN'}\n`);

  let userRecord: admin.auth.UserRecord;
  try {
    userRecord = await auth.getUserByEmail(userEmail);
  } catch (e: any) {
    console.error(`No Auth user with email ${userEmail} (${e.code || e.message})`);
    process.exit(1);
  }
  const { uid } = userRecord;
  console.log(`Found user: ${uid}`);

  // Newest quote first. Try common ordering fields with fallbacks so we don't
  // miss quotes that pre-date a particular timestamp field.
  let quoteDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  const orderFields = ['updatedAt', 'createdAt', 'sentAt'];
  for (const field of orderFields) {
    try {
      const snap = await db.collection(`users/${uid}/quotes`)
        .orderBy(field, 'desc')
        .limit(1)
        .get();
      if (!snap.empty) {
        quoteDoc = snap.docs[0];
        console.log(`(ordered by ${field})`);
        break;
      }
    } catch {
      // Field may not exist on any docs — try next.
    }
  }
  if (!quoteDoc) {
    console.error(`No quotes found under users/${uid}/quotes`);
    process.exit(1);
  }

  const quote = quoteDoc.data();
  console.log(`\nLatest quote: ${quoteDoc.id}`);
  console.log(`  number:    ${quote.quoteNumber || '(none)'}`);
  console.log(`  customer:  ${quote.customerName || '(none)'}`);
  console.log(`  job:       ${quote.job?.name || '(none)'}`);
  console.log(`  total:     ${quote.total ?? '(none)'}`);
  console.log(`  status:    ${quote.status || '(none)'}`);
  console.log(`  updatedAt: ${quote.updatedAt || '(none)'}`);

  if (quote.status === 'sent') {
    console.log(`\nWARNING: quote status is 'sent'. Test send will rotate the`);
    console.log(`acceptanceTokenHash on this quote, breaking any acceptance link`);
    console.log(`already in the real customer's inbox.`);
  }

  if (!confirm) {
    console.log(`\nDry run complete. Re-run with --confirm to send.`);
    return;
  }

  // Mint custom token, exchange for ID token via Identity Toolkit REST.
  const customToken = await auth.createCustomToken(uid);
  const exchangeResp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const exchangeJson = await exchangeResp.json() as any;
  if (!exchangeJson.idToken) {
    console.error('Custom token exchange failed:', exchangeJson);
    process.exit(1);
  }
  const idToken: string = exchangeJson.idToken;
  console.log(`\nMinted ID token for ${uid}`);

  const sendResp = await fetch(SEND_QUOTE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      quoteId: quoteDoc.id,
      emailBody: `Test send for logo render check. Quote: ${quote.job?.name || quoteDoc.id}.`,
      recipientEmail,
      isTestSend: true,
      includePhotos: false,
    }),
  });
  const sendBody = await sendResp.text();
  console.log(`\nsendQuoteEmail HTTP ${sendResp.status}`);
  console.log(sendBody);

  if (!sendResp.ok) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
