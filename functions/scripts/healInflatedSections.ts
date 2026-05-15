/**
 * One-shot migration: fix quote/invoice sections whose `laborHours` field
 * was persisted as the totalled value (laborHours × multiplier) instead of
 * the per-unit value, due to the projectShared bug in shared/document/adapter.ts
 * that was patched on 2026-05-15.
 *
 *   npx ts-node scripts/healInflatedSections.ts                     # dry-run all users
 *   npx ts-node scripts/healInflatedSections.ts --uid=<uid>          # dry-run one user
 *   npx ts-node scripts/healInflatedSections.ts --uid=<uid> --doc=<docId>
 *                                                                   # dry-run one doc
 *   add --commit to any of the above to write
 *
 * Detection heuristic — only heal sections where the totalled-shape
 * interpretation matches and the per-unit interpretation does NOT:
 *   - multiplier > 1
 *   - laborHours × laborRate ≈ laborTotal           (looks totalled)
 *   - laborHours × laborRate × multiplier ≠ laborTotal  (not already per-unit)
 *
 * Tolerance is 2% of laborTotal or $1, whichever is larger. Sections that
 * are already correct, or zero, or ambiguous are left untouched.
 *
 * On heal: laborHours is divided by multiplier, and laborHoursTotal is
 * written/updated to match. laborTotal is left alone (it was already the
 * authoritative dollar figure).
 */

import * as admin from 'firebase-admin';

interface SectionRecord {
  name?: string;
  multiplier?: number;
  laborHours?: number;
  laborHoursTotal?: number;
  laborRate?: number;
  laborTotal?: number;
  [k: string]: unknown;
}

interface DocRecord {
  type?: 'quote' | 'invoice';
  sections?: SectionRecord[];
  customerName?: string;
  job?: { name?: string };
}

interface HealedSection {
  section: SectionRecord;
  before: { laborHours: number; laborHoursTotal: number | undefined };
  after: { laborHours: number; laborHoursTotal: number };
}

type DocSnap = FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot;

export function healSection(s: SectionRecord): HealedSection | null {
  const mul = Number(s?.multiplier ?? 1);
  const perUnit = Number(s?.laborHours ?? 0);
  const rate = Number(s?.laborRate ?? 0);
  const total = Number(s?.laborTotal ?? 0);
  if (mul <= 1 || perUnit <= 0 || rate <= 0 || total <= 0) return null;

  const totalledProduct = perUnit * rate;
  const perUnitProduct = perUnit * rate * mul;
  const tol = Math.max(1, total * 0.02);
  const looksTotalled = Math.abs(totalledProduct - total) <= tol;
  const looksPerUnit = Math.abs(perUnitProduct - total) <= tol;
  if (!looksTotalled || looksPerUnit) return null;

  const fixedPerUnit = Math.round((perUnit / mul) * 100) / 100;
  const fixedTotal = Math.round(fixedPerUnit * mul * 100) / 100;
  return {
    section: { ...s, laborHours: fixedPerUnit, laborHoursTotal: fixedTotal },
    before: { laborHours: perUnit, laborHoursTotal: s.laborHoursTotal as number | undefined },
    after: { laborHours: fixedPerUnit, laborHoursTotal: fixedTotal },
  };
}

function logHealedDoc(d: DocSnap, data: DocRecord, fixes: (HealedSection | null)[], sections: SectionRecord[]) {
  const customer = (data.customerName || '').trim() || '(no name)';
  const job = (data.job?.name || '').trim() || '(no job)';
  console.log(`  ${d.id} · ${data.type || 'doc'} · ${customer} · ${job}`);
  fixes.forEach((f, i) => {
    if (!f) return;
    const name = (sections[i].name || `section ${i}`).slice(0, 40);
    const mul = sections[i].multiplier;
    console.log(
      `      ${name} (×${mul}) · laborHours ${f.before.laborHours} → ${f.after.laborHours}` +
        (f.before.laborHoursTotal !== undefined
          ? `, laborHoursTotal ${f.before.laborHoursTotal} → ${f.after.laborHoursTotal}`
          : `, +laborHoursTotal=${f.after.laborHoursTotal}`),
    );
  });
}

async function healDoc(d: DocSnap, commit: boolean): Promise<{ healed: boolean; sectionsHealed: number }> {
  const data = d.data() as DocRecord | undefined;
  if (!data) return { healed: false, sectionsHealed: 0 };
  const sections = data.sections;
  if (!Array.isArray(sections) || sections.length === 0) return { healed: false, sectionsHealed: 0 };

  const fixes = sections.map((s) => healSection(s));
  const sectionsHealed = fixes.filter((f) => f !== null).length;
  if (sectionsHealed === 0) return { healed: false, sectionsHealed: 0 };

  logHealedDoc(d, data, fixes, sections);
  if (commit) {
    const nextSections = sections.map((s, i) => fixes[i]?.section ?? s);
    await d.ref.update({ sections: nextSections });
  }
  return { healed: true, sectionsHealed };
}

async function healUser(uid: string, commit: boolean) {
  const db = admin.firestore();
  const docsSnap = await db.collection('users').doc(uid).collection('documents').get();
  if (docsSnap.empty) return { docs: 0, healed: 0, sections: 0 };

  let healedDocs = 0;
  let healedSections = 0;
  for (const d of docsSnap.docs) {
    const { healed, sectionsHealed } = await healDoc(d, commit);
    if (healed) {
      healedDocs += 1;
      healedSections += sectionsHealed;
    }
  }
  return { docs: docsSnap.size, healed: healedDocs, sections: healedSections };
}

async function healSingleDoc(uid: string, docId: string, commit: boolean) {
  const db = admin.firestore();
  const ref = db.collection('users').doc(uid).collection('documents').doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`  Document ${docId} not found under user ${uid}.`);
    return { docs: 0, healed: 0, sections: 0 };
  }
  const { healed, sectionsHealed } = await healDoc(snap, commit);
  if (!healed) {
    console.log(`  ${snap.id} · no sections needed healing (already correct, or shape ambiguous).`);
  }
  return { docs: 1, healed: healed ? 1 : 0, sections: sectionsHealed };
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const uidArg = args.find((a) => a.startsWith('--uid='));
  const docArg = args.find((a) => a.startsWith('--doc='));
  const onlyUid = uidArg ? uidArg.slice('--uid='.length) : undefined;
  const onlyDoc = docArg ? docArg.slice('--doc='.length) : undefined;

  if (onlyDoc && !onlyUid) {
    console.error('--doc requires --uid=<uid> (documents live under a user).');
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }

  console.log(`\n=== Heal inflated section labour ===`);
  console.log(`Mode: ${commit ? 'COMMIT (will write)' : 'DRY-RUN (no writes)'}`);
  if (onlyUid) console.log(`Scope: uid=${onlyUid}${onlyDoc ? `, doc=${onlyDoc}` : ''}`);

  if (onlyDoc && onlyUid) {
    const result = await healSingleDoc(onlyUid, onlyDoc, commit);
    console.log(`\n--- Summary ---`);
    console.log(`  Sections healed:       ${result.sections}`);
    console.log(commit ? '\nDone.' : '\nDRY-RUN done. Re-run with --commit to write.');
    return;
  }

  const db = admin.firestore();
  const uids = onlyUid
    ? [onlyUid]
    : (await db.collection('users').get()).docs.map((u) => u.id);

  console.log(`Walking ${uids.length} user${uids.length === 1 ? '' : 's'}…\n`);

  let totalDocs = 0;
  let totalHealedDocs = 0;
  let totalHealedSections = 0;
  let touchedUsers = 0;

  for (const uid of uids) {
    const { docs, healed, sections } = await healUser(uid, commit);
    totalDocs += docs;
    if (healed > 0) {
      touchedUsers += 1;
      totalHealedDocs += healed;
      totalHealedSections += sections;
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Users walked:          ${uids.length}`);
  console.log(`  Users with healed docs: ${touchedUsers}`);
  console.log(`  Documents scanned:     ${totalDocs}`);
  console.log(`  Documents healed:      ${totalHealedDocs}`);
  console.log(`  Sections healed:       ${totalHealedSections}`);
  console.log(commit ? '\nDone.' : '\nDRY-RUN done. Re-run with --commit to write.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
