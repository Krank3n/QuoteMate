/**
 * Survey REAL customer job scopes for the quoting-accuracy bake-off corpus.
 *
 * Read-only. Walks every user, resolves their auth email, and excludes the
 * accounts that would poison an accuracy measurement:
 *   - the founder's own accounts (hansendev / thomas.andrew.hansen)
 *   - the screenshot/demo seed account (see seedScreenshotDemo.ts)
 *   - `recovered-` documents (email-derived single-line quotes — they are not
 *     something a tradie ever typed, and they skew any audit)
 *   - obvious self-tests ("test", "asdf", scopes under ~40 chars)
 *
 * Output is PII-redacted: no customer names, emails, phones or addresses —
 * only the job scope text, which is what the pricing pipeline actually reads.
 *
 * Usage:
 *   cd functions
 *   set -a; source ../.env; source .env; set +a
 *   npx ts-node scripts/surveyCustomerJobs.ts --out=/tmp/corpus.json
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';

interface Args { project: string; out: string; minLen: number }

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const get = (n: string) => raw.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  return {
    project: get('project') || process.env.GCLOUD_PROJECT || 'hansendev',
    out: get('out') || '/tmp/customer-jobs-corpus.json',
    minLen: parseInt(get('min-len') || '40', 10),
  };
}

/** Emails that are the founder, a demo seed, or a known internal tester. */
const EXCLUDED_EMAIL_PATTERNS = [
  /hansendev/i,
  /thomas\.andrew\.hansen/i,
  /^demo\./i,
  /demo\.screenshots/i,
  /@example\.(com|org)$/i,
  /\+test@/i,
  /^test@/i,
];

export function isExcludedEmail(email: string | undefined): boolean {
  if (!email) return false;
  return EXCLUDED_EMAIL_PATTERNS.some((re) => re.test(email));
}

/** Scopes that are a tradie testing the app, not quoting a real job. */
const JUNK_SCOPE = /^(test|testing|asdf|qwerty|hello|hi|abc|aaa|xxx|\d+)\b/i;

export function isRealScope(desc: string | undefined, minLen: number): boolean {
  if (!desc) return false;
  const t = desc.trim();
  if (t.length < minLen) return false;
  if (JUNK_SCOPE.test(t)) return false;
  // Needs at least a few distinct words to be a scope rather than a label.
  if (new Set(t.toLowerCase().split(/\W+/).filter(Boolean)).size < 6) return false;
  return true;
}

function tsToMs(t: any): number {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?._seconds === 'number') return t._seconds * 1000;
  return 0;
}

/** Coarse trade bucket from the scope text — used to spread the corpus. */
export function tradeBucket(text: string): string {
  const t = text.toLowerCase();
  const rules: Array<[string, RegExp]> = [
    ['fencing', /\bfenc|paling|colorbond fence|gate\b|post and rail/],
    ['decking', /\bdeck|pergola|verandah|patio\b/],
    ['concreting', /\bconcret|slab|driveway|footing|screed\b/],
    ['tiling', /\btile|tiling|grout|waterproof/],
    ['bathroom', /\bbathroom|shower|vanity|ensuite|toilet\b/],
    ['kitchen', /\bkitchen|benchtop|splashback|cabinetry\b/],
    ['painting', /\bpaint|undercoat|primer|repaint\b/],
    ['plastering', /\bplaster|gyprock|cornice|render|patch\b/],
    ['roofing', /\broof|gutter|downpipe|fascia|ridge cap|colorbond roof/],
    ['landscaping', /\blandscap|turf|mulch|garden bed|retaining wall|paver|irrigation/],
    ['carpentry', /\bframe|framing|stud|joist|rafter|door|window|skirting|architrave/],
    ['electrical', /\belectric|power point|gpo|switchboard|downlight|wiring\b/],
    ['plumbing', /\bplumb|drain|pipe|hot water|tap|basin|sewer\b/],
  ];
  for (const [name, re] of rules) if (re.test(t)) return name;
  return 'other';
}

/** Normalise the tradie's declared category onto the same bucket vocabulary. */
export function bucketFromCategory(cat: string | undefined): string | null {
  if (!cat) return null;
  const c = cat.toLowerCase().replace(/[^a-z]/g, '');
  const map: Record<string, string> = {
    plumbing: 'plumbing', plumber: 'plumbing',
    electrical: 'electrical', electrician: 'electrical',
    carpentry: 'carpentry', carpenter: 'carpentry', building: 'carpentry', builder: 'carpentry',
    landscaping: 'landscaping', landscaper: 'landscaping', gardening: 'landscaping',
    painting: 'painting', painter: 'painting',
    tiling: 'tiling', tiler: 'tiling',
    concreting: 'concreting', concreter: 'concreting',
    fencing: 'fencing', fencer: 'fencing',
    roofing: 'roofing', roofer: 'roofing',
    plastering: 'plastering', plasterer: 'plastering',
    decking: 'decking',
  };
  return map[c] || null;
}

async function main() {
  const args = parseArgs();
  if (!admin.apps.length) admin.initializeApp({ projectId: args.project });
  const db = admin.firestore();
  const auth = admin.auth();

  const userDocs = (await db.collection('users').get()).docs;
  console.log(`Users in Firestore: ${userDocs.length}`);

  // Resolve emails in bulk (getUsers takes 100 identifiers per call).
  const emailByUid = new Map<string, string>();
  for (let i = 0; i < userDocs.length; i += 100) {
    const ids = userDocs.slice(i, i + 100).map((u) => ({ uid: u.id }));
    const res = await auth.getUsers(ids);
    for (const u of res.users) emailByUid.set(u.uid, u.email || '');
  }

  const rows: any[] = [];
  const skipped = { excludedUser: 0, recovered: 0, notQuote: 0, junkScope: 0, noScope: 0 };
  const excludedUids = new Set<string>();

  for (const u of userDocs) {
    const email = emailByUid.get(u.id);
    if (isExcludedEmail(email)) {
      excludedUids.add(u.id);
      skipped.excludedUser += 1;
      continue;
    }
    // The tradie's declared category beats keyword-guessing the scope text —
    // "retaining the existing chassis" is a switchboard job, not landscaping.
    // Settings live in a subcollection (users/{uid}/settings/business), not on
    // the user doc — reading the user doc silently returned nothing.
    let settings: any = {};
    try {
      const sdoc = await db.collection('users').doc(u.id).collection('settings').doc('business').get();
      if (sdoc.exists) settings = sdoc.data() as any;
    } catch {
      /* leave empty — falls back to keyword inference */
    }
    const declared =
      bucketFromCategory(settings.tradeCategory) ||
      bucketFromCategory((settings.tradeCategories || [])[0]) ||
      bucketFromCategory(settings.tradeType);

    const snap = await db.collection('users').doc(u.id).collection('documents').orderBy('createdAt', 'desc').limit(50).get();
    for (const ds of snap.docs) {
      const d: any = { id: ds.id, ...(ds.data() as any) };
      if (ds.id.startsWith('recovered-')) { skipped.recovered += 1; continue; }
      if (d.type && d.type !== 'quote') { skipped.notQuote += 1; continue; }
      const desc: string | undefined = d.job?.description;
      if (!desc) { skipped.noScope += 1; continue; }
      if (!isRealScope(desc, args.minLen)) { skipped.junkScope += 1; continue; }
      rows.push({
        uid: u.id,
        docId: ds.id,
        number: d.number,
        createdAt: tsToMs(d.createdAt),
        stage: d.stage,
        // Scope only. No customer identity of any kind.
        jobName: d.job?.name,
        jobDescription: desc,
        trade: declared || tradeBucket(`${d.job?.name || ''} ${desc}`),
        tradeSource: declared ? 'declared' : 'inferred',
        storedMaterialCount: (d.materials || []).length,
        storedSectionCount: (d.sections || []).length,
        storedMaterialsSubtotal: d.materialsSubtotal,
        storedTotal: d.total,
        storedLabourHours: d.laborHours,
        pricesIncludeGst: d.pricesIncludeGst,
      });
    }
  }

  rows.sort((a, b) => b.createdAt - a.createdAt);

  const byTrade = new Map<string, number>();
  const byUser = new Map<string, number>();
  for (const r of rows) {
    byTrade.set(r.trade, (byTrade.get(r.trade) || 0) + 1);
    byUser.set(r.uid, (byUser.get(r.uid) || 0) + 1);
  }

  console.log(`\nExcluded internal/demo users: ${skipped.excludedUser}`);
  console.log(`Skipped — recovered: ${skipped.recovered}, non-quote: ${skipped.notQuote}, junk scope: ${skipped.junkScope}, no scope: ${skipped.noScope}`);
  console.log(`\nReal customer quote scopes: ${rows.length} across ${byUser.size} tradies`);
  console.log('\nBy trade:');
  for (const [t, n] of [...byTrade.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(14)} ${n}`);
  }
  console.log('\nQuotes per tradie (top 15):');
  for (const [, n] of [...byUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(n).padStart(4)} quotes`);
  }

  fs.writeFileSync(args.out, JSON.stringify({ generatedAt: Date.now(), counts: { rows: rows.length, tradies: byUser.size, skipped }, byTrade: Object.fromEntries(byTrade), rows }, null, 2));
  console.log(`\nWrote ${rows.length} scopes -> ${args.out}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
