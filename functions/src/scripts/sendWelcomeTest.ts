/**
 * One-off: send the welcome email to a single recipient as a preview, so you
 * can eyeball the layout before it goes to a real signup.
 *
 * Loads BREVO_API_KEY from functions/.env and uses Application Default
 * Credentials for the Firestore emailLog write that sendEmail performs.
 *
 * Usage (from functions/):
 *   npm run build
 *   node lib/scripts/sendWelcomeTest.js <recipient-email> "<business-name>"
 *
 * Example:
 *   node lib/scripts/sendWelcomeTest.js thomas.andrew.hansen@gmail.com "Hansen Dev"
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ID = 'hansendev';
const FIREBASE_ADMIN_SA = 'firebase-adminsdk-fbsvc@hansendev.iam.gserviceaccount.com';

function loadDotEnv(): void {
  const envPath = path.resolve(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const recipientEmail = args[0];
  const businessName = args[1] || '';

  if (!recipientEmail) {
    console.error('Usage: sendWelcomeTest.js <recipient-email> "<business-name>"');
    process.exit(1);
  }

  loadDotEnv();
  if (!process.env.BREVO_API_KEY) {
    console.error('BREVO_API_KEY not found in functions/.env');
    process.exit(1);
  }

  admin.initializeApp({ projectId: PROJECT_ID, serviceAccountId: FIREBASE_ADMIN_SA });

  const { sendWelcomeEmail } = await import('../email');

  console.log(`\nProject:   ${PROJECT_ID}`);
  console.log(`Recipient: ${recipientEmail}`);
  console.log(`Business:  ${businessName || '(none)'}\n`);

  const ok = await sendWelcomeEmail(recipientEmail, businessName, 'test');
  console.log(ok ? 'Sent.' : 'Failed.');
  process.exit(ok ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
