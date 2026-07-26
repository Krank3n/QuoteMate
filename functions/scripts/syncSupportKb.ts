/**
 * syncSupportKb.ts — push the customer knowledge base into Firestore.
 *
 * Reads knowledge-base/*.md + manifest.json from the WEBSITE repo (the source
 * of truth) and writes one doc per article into the `supportKb` collection,
 * which the supportChat function stuffs into Claude's cached system prompt.
 * Deletes Firestore docs whose article no longer exists, so the collection
 * always mirrors the repo exactly. Re-run after every KB edit.
 *
 * Run (uses Application Default Credentials; you must be gcloud-authed on hansendev):
 *   cd functions && GOOGLE_CLOUD_PROJECT=hansendev \
 *     npx ts-node scripts/syncSupportKb.ts [path-to-knowledge-base]
 *
 * Default KB path: ../../QuoteMateAppWebsite/knowledge-base (sibling checkout).
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

admin.initializeApp();
const db = admin.firestore();

interface ManifestDoc {
  id: string;
  title: string;
  category: string;
  path: string;
  summary?: string;
}

async function main(): Promise<void> {
  const kbDir = path.resolve(
    process.argv[2] || path.join(__dirname, '..', '..', '..', 'QuoteMateAppWebsite', 'knowledge-base'),
  );
  const manifestPath = path.join(kbDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at ${manifestPath} — pass the knowledge-base path as an argument.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { documents: ManifestDoc[] };

  const seen = new Set<string>();
  let written = 0;
  const batch = db.batch();

  for (const docMeta of manifest.documents) {
    const filePath = path.join(kbDir, docMeta.path);
    if (!fs.existsSync(filePath)) {
      console.warn(`SKIP (missing file): ${docMeta.path}`);
      continue;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    // Strip YAML frontmatter — the bot only needs the article body.
    const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
    const ref = db.collection('supportKb').doc(docMeta.id);
    batch.set(ref, {
      title: docMeta.title,
      category: docMeta.category,
      summary: docMeta.summary ?? null,
      sourcePath: docMeta.path,
      content: body,
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    seen.add(docMeta.id);
    written++;
  }

  batch.set(db.collection('supportKb').doc('_meta'), {
    count: written,
    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Remove articles that no longer exist in the manifest.
  const existing = await db.collection('supportKb').get();
  let deleted = 0;
  existing.forEach((doc) => {
    if (doc.id !== '_meta' && !seen.has(doc.id)) {
      batch.delete(doc.ref);
      deleted++;
    }
  });

  await batch.commit();
  console.log(`supportKb synced: ${written} articles written, ${deleted} stale deleted (from ${kbDir})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
