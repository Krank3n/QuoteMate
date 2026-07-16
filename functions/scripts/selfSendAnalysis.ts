/**
 * Read-only analysis: do tradies send quotes to themselves instead of
 * customers, and does that explain the trial→paid leak?
 *
 *   cd functions && npx ts-node scripts/selfSendAnalysis.ts
 *
 * Needs Application Default Credentials. Makes no writes.
 *
 * Classification per user (test accounts excluded):
 *   - customer-sender : ≥1 sent quote whose customerEmail is NOT their own
 *                       (includes empty-email sends — SMS/share are real sends)
 *   - self-only sender: ≥1 sent quote, but every one addressed to their own
 *                       auth/business email
 *   - test-send only  : no sent quotes at all, but ≥1 draft carrying
 *                       acceptanceTokenCreatedAt (stamped by test sends;
 *                       real sends flip status to 'sent')
 *   - no sends        : everyone else with ≥1 quote doc
 *
 * Cross-tabbed against paying (subscription.isBilledSub). Also sizes the
 * planned dashboard nudges: overdue invoices, self-sent quotes, and 4+ day
 * aging sent quotes.
 */
import * as admin from 'firebase-admin';
import { isBilledSub, isRestoredStorePro } from '../src/subscription.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_ACCOUNT_RE = /example\.com$|mate\.debug|newtestuser|testuser@|^qm-marketing-demo$/i;

function ts(v: any): number | null {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

function norm(e: any): string {
  return typeof e === 'string' ? e.trim().toLowerCase() : '';
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—';
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();
  const now = Date.now();

  const authUsers: admin.auth.UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    authUsers.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);

  const [quotesSnap, invoicesSnap, settingsSnap, profileSnap] = await Promise.all([
    db.collectionGroup('quotes').get(),
    db.collectionGroup('invoices').get(),
    db.collectionGroup('settings').get(),
    db.collectionGroup('profile').get(),
  ]);

  const businessEmails = new Map<string, string>();
  for (const d of settingsSnap.docs) {
    if (d.id !== 'business') continue;
    const uid = d.ref.parent.parent?.id;
    const email = norm(d.data().email);
    if (uid && email) businessEmails.set(uid, email);
  }

  const paying = new Set<string>();
  for (const d of profileSnap.docs) {
    if (d.id !== 'subscription') continue;
    const uid = d.ref.parent.parent?.id;
    const sub = d.data();
    // Same maths as the admin funnel: billed + incident-restored store subs.
    if (uid && (isBilledSub(sub) || isRestoredStorePro(sub, now))) paying.add(uid);
  }

  const quotesByUid = new Map<string, any[]>();
  for (const d of quotesSnap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    if (!quotesByUid.has(uid)) quotesByUid.set(uid, []);
    quotesByUid.get(uid)!.push(d.data());
  }
  const invoicesByUid = new Map<string, any[]>();
  for (const d of invoicesSnap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    if (!invoicesByUid.has(uid)) invoicesByUid.set(uid, []);
    invoicesByUid.get(uid)!.push(d.data());
  }

  const realUsers = authUsers.filter(
    (u) => !TEST_ACCOUNT_RE.test(u.email || '') && !TEST_ACCOUNT_RE.test(u.displayName || ''),
  );

  type Cls = 'customer' | 'selfOnly' | 'testOnly' | 'noSends';
  const byClass: Record<Cls, string[]> = { customer: [], selfOnly: [], testOnly: [], noSends: [] };
  const payingByClass: Record<Cls, number> = { customer: 0, selfOnly: 0, testOnly: 0, noSends: 0 };

  // Nudge sizing across all real users.
  let overdueInvoices = 0;
  let selfSentQuotes = 0;
  let agingSentQuotes = 0;
  let usersWithAnyNudge = 0;

  for (const u of realUsers) {
    const quotes = quotesByUid.get(u.uid) || [];
    if (quotes.length === 0) continue;
    const own = new Set([norm(u.email), businessEmails.get(u.uid) || ''].filter(Boolean));

    const sent = quotes.filter((q) => q.status === 'sent' || q.status === 'accepted' || q.status === 'completed');
    const sentSelf = sent.filter((q) => own.size > 0 && own.has(norm(q.customerEmail)));
    const sentCustomer = sent.filter((q) => !(own.size > 0 && own.has(norm(q.customerEmail))));
    const testSentDrafts = quotes.filter((q) => q.status === 'draft' && !!q.acceptanceTokenCreatedAt);

    let cls: Cls;
    if (sentCustomer.length > 0) cls = 'customer';
    else if (sentSelf.length > 0) cls = 'selfOnly';
    else if (testSentDrafts.length > 0) cls = 'testOnly';
    else cls = 'noSends';

    byClass[cls].push(
      `  ${(u.displayName || u.email || u.uid).slice(0, 38).padEnd(40)}` +
        `quotes ${String(quotes.length).padStart(3)}  toCustomer ${String(sentCustomer.length).padStart(3)}` +
        `  toSelf ${String(sentSelf.length).padStart(3)}  testSentDrafts ${String(testSentDrafts.length).padStart(3)}` +
        `${paying.has(u.uid) ? '  PAYING' : ''}`,
    );
    if (paying.has(u.uid)) payingByClass[cls]++;

    // --- nudge sizing (mirrors src/utils/followUpNudge.ts rules) ---
    const invoices = invoicesByUid.get(u.uid) || [];
    const nOverdue = invoices.filter((inv) => {
      const due = ts(inv.dueDate);
      const open = inv.status === 'sent' || inv.status === 'partial' || inv.status === 'overdue';
      return open && due !== null && due < now;
    }).length;
    const stillSent = quotes.filter((q) => q.status === 'sent');
    const nSelf = stillSent.filter(
      (q) => own.has(norm(q.customerEmail)) && (ts(q.sentAt) ?? now) <= now - DAY_MS,
    ).length;
    const nAging = stillSent.filter((q) => {
      if (own.has(norm(q.customerEmail))) return false;
      const sentAt = ts(q.sentAt);
      return sentAt !== null && now - sentAt >= 4 * DAY_MS;
    }).length;
    overdueInvoices += nOverdue;
    selfSentQuotes += nSelf;
    agingSentQuotes += nAging;
    if (nOverdue + nSelf + nAging > 0) usersWithAnyNudge++;
  }

  const totalWithQuotes = (Object.values(byClass) as string[][]).reduce((s, a) => s + a.length, 0);
  console.log(`=== SEND BEHAVIOUR — ${realUsers.length} real users, ${totalWithQuotes} with ≥1 quote ===\n`);
  const label: Record<Cls, string> = {
    customer: 'Sent to a real customer',
    selfOnly: 'Sent ONLY to their own email',
    testOnly: 'Test-sent to self, never sent at all',
    noSends: 'Made quotes but never sent anything',
  };
  for (const cls of ['customer', 'selfOnly', 'testOnly', 'noSends'] as Cls[]) {
    const users = byClass[cls];
    console.log(
      `${label[cls]}: ${users.length} (${pct(users.length, totalWithQuotes)})` +
        `  → paying: ${payingByClass[cls]} (${pct(payingByClass[cls], users.length)})`,
    );
  }

  console.log('\n=== PER-USER DETAIL ===');
  for (const cls of ['selfOnly', 'testOnly', 'customer', 'noSends'] as Cls[]) {
    console.log(`\n--- ${label[cls]} (${byClass[cls].length}) ---`);
    byClass[cls].forEach((r) => console.log(r));
  }

  // Where do the never-senders stall? Take each user's furthest-progressed
  // quote: mid-wizard (draftStep before preview) vs reached preview vs a
  // status beyond draft that skipped sending (manually staged). Tells us
  // whether the leak is "couldn't finish the quote" or "finished it and
  // never pulled the trigger".
  const STEP_ORDER = ['Details', 'CustomerDetails', 'MaterialsList', 'AddMaterial', 'LaborMarkup', 'JobPreview'];
  const stall: Record<string, number> = {};
  for (const u of realUsers) {
    const quotes = quotesByUid.get(u.uid) || [];
    if (quotes.length === 0) continue;
    const sentAny = quotes.some(
      (q) => q.status === 'sent' || q.status === 'accepted' || q.status === 'completed',
    );
    if (sentAny) continue;
    let bucket = 'draft, step unknown';
    let best = -2;
    for (const q of quotes) {
      if (q.status !== 'draft') {
        if (best < STEP_ORDER.length) {
          bucket = `status ${q.status} (never sent)`;
          best = STEP_ORDER.length;
        }
        continue;
      }
      const idx = STEP_ORDER.indexOf(q.draftStep || '');
      if (idx > best) {
        best = idx;
        bucket = idx >= 0 ? `draft at ${q.draftStep}` : 'draft, step unknown';
      }
    }
    stall[bucket] = (stall[bucket] || 0) + 1;
  }
  console.log('\n=== NEVER-SENDERS — furthest progress reached ===');
  Object.entries(stall)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k.padEnd(32)} ${v}`));

  console.log('\n=== NUDGE SIZING (if shipped today) ===');
  console.log(`overdue invoices:              ${overdueInvoices}`);
  console.log(`self-sent quotes (24h+):       ${selfSentQuotes}`);
  console.log(`aging sent quotes (4d+):       ${agingSentQuotes}`);
  console.log(`users who'd see ≥1 nudge:      ${usersWithAnyNudge}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
