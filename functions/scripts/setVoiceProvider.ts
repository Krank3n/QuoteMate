/**
 * One-shot: point Mate's voice transport at a provider by writing
 * config/assistantVoice.
 *
 *   npx ts-node scripts/setVoiceProvider.ts gemini
 *   npx ts-node scripts/setVoiceProvider.ts openai
 *   npx ts-node scripts/setVoiceProvider.ts elevenlabs
 *
 * decideVoiceProvider() fails safe to Gemini for anything that isn't
 * 'openai' or 'elevenlabs', so writing 'gemini' takes everyone home
 * regardless of rolloutPercent or forceUids — the eval can be resumed later
 * by flipping `provider` back, since this leaves agentId/rolloutPercent/
 * forceUids untouched.
 *
 * Needs Application Default Credentials:
 *   firebase login   # or: gcloud auth application-default login
 */

import * as admin from 'firebase-admin';

const PROVIDERS = ['gemini', 'openai', 'elevenlabs'] as const;
type Provider = (typeof PROVIDERS)[number];

async function main() {
  const provider = process.argv[2] as Provider | undefined;
  if (!provider || !PROVIDERS.includes(provider)) {
    console.error(`Usage: npx ts-node scripts/setVoiceProvider.ts <${PROVIDERS.join('|')}>`);
    process.exit(1);
  }
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();
  const ref = db.doc('config/assistantVoice');
  const before = (await ref.get()).data();
  console.log('before:', JSON.stringify(before));
  await ref.set(
    {
      provider,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  console.log(`Set config/assistantVoice.provider → ${provider}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
