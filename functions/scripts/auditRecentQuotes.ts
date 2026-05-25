/**
 * Read-only audit: pulls the N most recent documents across all users and
 * checks each one for structural integrity issues.
 *
 *   cd functions && npx ts-node scripts/auditRecentQuotes.ts [limit=50]
 *
 * Needs Application Default Credentials (gcloud auth application-default login).
 *
 * Outputs:
 *   1. Summary report on stdout (issue counts grouped by type).
 *   2. PII-stripped JSON dump of every flagged document to
 *      ./audit-recent-quotes.json — useful as a fixture source for tests.
 *
 * Integrity checks:
 *   - Calculation consistency (subtotal, markup, gst, total recompute matches stored?)
 *   - Labour total matches Σ(section.laborTotal) + laborExtraHours × laborRate?
 *   - Each section's laborTotal matches laborHours × laborRate × multiplier?
 *   - Validator hits (invalid piece-good units, zero-labour sections, zero-priced materials).
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { checkDocumentIntegrity, IntegrityIssue } from '../src/shared/document/integrityCheck';

interface DocLike {
  id: string;
  uid: string;
  type?: string;
  stage?: string;
  laborRate?: number;
  laborHours?: number;
  laborUnit?: 'hours' | 'days';
  laborTotal?: number;
  laborExtraHours?: number;
  laborMarkup?: number;
  markup?: number;
  travelAdjustment?: number;
  materialsSubtotal?: number;
  subtotal?: number;
  markupAmount?: number;
  gst?: number;
  total?: number;
  pricesIncludeGst?: boolean;
  materials?: any[];
  sections?: any[];
  createdAt?: any;
  number?: string;
  job?: { estimatedHours?: number };
}

function checkDocument(d: DocLike): IntegrityIssue[] {
  return checkDocumentIntegrity(d);
}

function sanitize(doc: DocLike): any {
  // Strip PII before saving as a fixture — names, contacts, addresses, free-text job description.
  const { customerName: _cn, customerEmail: _ce, customerPhone: _cp, jobAddress: _ja, ...rest } = doc as any;
  const job = rest.job ? { name: rest.job.name?.slice(0, 40) || 'Job', template: rest.job.template, estimatedHours: rest.job.estimatedHours } : undefined;
  // Strip notes too — they often contain customer-specific detail.
  const { notes: _n, clientNotes: _ccn, ...stripped } = rest;
  return { ...stripped, job, _uid: 'REDACTED' };
}

function tsToMs(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?._seconds === 'number') return t._seconds * 1000;
  return 0;
}

async function main() {
  const limit = Math.max(1, Math.min(parseInt(process.argv[2] || '50', 10), 500));

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();

  console.log(`\n=== Recent quote integrity audit (top ${limit}) ===\n`);

  const usersSnap = await db.collection('users').get();
  console.log(`Walking ${usersSnap.size} users for documents…\n`);

  // Pull top-N most-recent docs across every user.
  const allDocs: DocLike[] = [];
  for (const u of usersSnap.docs) {
    const docsSnap = await db.collection('users').doc(u.id).collection('documents')
      .orderBy('createdAt', 'desc').limit(20).get();
    for (const ds of docsSnap.docs) {
      allDocs.push({ id: ds.id, uid: u.id, ...(ds.data() as any) } as DocLike);
    }
  }

  allDocs.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
  const recent = allDocs.slice(0, limit);
  console.log(`Pulled ${allDocs.length} total documents, auditing the ${recent.length} most recent.\n`);

  // Run integrity checks.
  type FlaggedRow = { id: string; uid: string; number?: string; type?: string; stage?: string; issues: IntegrityIssue[]; doc: any };
  const flagged: FlaggedRow[] = [];
  const issueCounts = new Map<string, number>();

  for (const d of recent) {
    const issues = checkDocument(d);
    if (issues.length > 0) {
      flagged.push({
        id: d.id, uid: d.uid, number: d.number, type: d.type, stage: d.stage, issues,
        doc: sanitize(d),
      });
      for (const i of issues) issueCounts.set(i.code, (issueCounts.get(i.code) || 0) + 1);
    }
  }

  // Report.
  console.log(`Flagged: ${flagged.length} / ${recent.length} documents (${Math.round(100 * flagged.length / Math.max(1, recent.length))}%)\n`);
  console.log('Issue counts:');
  for (const [code, n] of [...issueCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${code.padEnd(34)} ${n}`);
  }
  console.log();

  // Per-doc detail (top 30 issues to keep stdout manageable).
  console.log('--- Per-document detail ---');
  for (const row of flagged.slice(0, 30)) {
    console.log(`\n${row.number || row.id} (uid ${row.uid.slice(0, 8)}, type ${row.type}, stage ${row.stage})`);
    for (const issue of row.issues) {
      console.log(`  • ${issue.code}: ${issue.detail}`);
    }
  }
  if (flagged.length > 30) console.log(`\n…(${flagged.length - 30} more flagged docs not shown)`);

  // Write sanitized JSON dump.
  const outPath = path.resolve(__dirname, '..', '..', 'audit-recent-quotes.json');
  fs.writeFileSync(outPath, JSON.stringify({
    auditedAt: new Date().toISOString(),
    totalDocs: allDocs.length,
    auditedCount: recent.length,
    flaggedCount: flagged.length,
    issueCounts: Object.fromEntries(issueCounts),
    flagged,
  }, null, 2));
  console.log(`\nSanitized dump written to ${outPath}`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
