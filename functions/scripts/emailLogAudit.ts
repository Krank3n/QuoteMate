/**
 * emailLogAudit.ts — read-only aggregation of the emailLog collection:
 * volume, delivery, engagement (opens/clicks), bounces, spam and unsubscribes
 * per email type, all-time and last 30 days. Nothing is written.
 *
 * Run (ADC; gcloud-authed on hansendev):
 *   cd functions && npx tsx scripts/emailLogAudit.ts
 *
 * The raw output contains recipient addresses and customer names in subject
 * lines. This repo is PUBLIC — never commit it verbatim. To snapshot a run as
 * a baseline, redact it first (pseudonyms are stable across files, so pass the
 * existing baselines too and the same person keeps the same handle):
 *   npx tsx scripts/emailLogAudit.ts > /tmp/audit.txt
 *   python3 scripts/redactEmailAudit.py /tmp/audit.txt
 *   cp /tmp/audit.txt.redacted scripts/emailAudit.baseline-YYYY-MM-DD.txt
 */
import * as admin from 'firebase-admin';
admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'hansendev' });

const DAY = 24 * 60 * 60 * 1000;

function tsMs(v: any): number | null {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'number') return v;
  return null;
}

interface Agg {
  total: number;
  last30d: number;
  delivered: number;
  blocked: number;
  bounced: number;
  spam: number;
  unsub: number;
  opened: number;
  clicked: number;
  firstAt: number | null;
  lastAt: number | null;
  subjects: Map<string, number>;
}

const blank = (): Agg => ({
  total: 0, last30d: 0, delivered: 0, blocked: 0, bounced: 0, spam: 0,
  unsub: 0, opened: 0, clicked: 0, firstAt: null, lastAt: null, subjects: new Map(),
});

(async () => {
  const db = admin.firestore();
  const now = Date.now();
  const snap = await db.collection('emailLog').get();

  const byType = new Map<string, Agg>();
  const byRecipient = new Map<string, number>();
  const byWeek = new Map<string, number>();
  let noTags = 0;

  for (const doc of snap.docs) {
    const d = doc.data() as any;
    const tags: string[] = (d.tags || []).filter(
      (t: string) => !t.startsWith('emailLogId:') && !t.startsWith('blocked:') && !t.startsWith('lead:') && !t.startsWith('doc:')
    );
    const key = tags.length ? tags.join('/') : `(untagged:${d.category || '?'})`;
    if (!tags.length) noTags++;

    const a = byType.get(key) || blank();
    byType.set(key, a);

    const at = tsMs(d.queuedAt);
    a.total++;
    if (at !== null) {
      if (now - at <= 30 * DAY) a.last30d++;
      if (a.firstAt === null || at < a.firstAt) a.firstAt = at;
      if (a.lastAt === null || at > a.lastAt) a.lastAt = at;
      const wk = new Date(at - ((new Date(at).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
      byWeek.set(wk, (byWeek.get(wk) || 0) + 1);
    }
    const status = String(d.status || '');
    if (status === 'delivered' || status === 'sent') a.delivered++;
    if (status === 'blocked') a.blocked++;
    if (/bounce/.test(status) || d.events?.hard_bounce || d.events?.soft_bounce) a.bounced++;
    if (status === 'spam' || d.events?.spam) a.spam++;
    if (d.events?.unsubscribe) a.unsub++;
    if ((d.openCount || 0) > 0) a.opened++;
    if ((d.clickCount || 0) > 0) a.clicked++;
    a.subjects.set(d.subject || '(none)', (a.subjects.get(d.subject || '(none)') || 0) + 1);

    if (d.to) byRecipient.set(d.to, (byRecipient.get(d.to) || 0) + 1);
  }

  const iso = (ms: number | null) => (ms === null ? '—' : new Date(ms).toISOString().slice(0, 10));
  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)}%` : '—');

  console.log(`\n=== emailLog audit — ${snap.size} rows, ${byType.size} types (${noTags} untagged) ===\n`);
  const rows = [...byType.entries()].sort((x, y) => y[1].total - x[1].total);
  for (const [key, a] of rows) {
    const denom = a.total - a.blocked;
    console.log(
      `${key}\n  total=${a.total} (30d=${a.last30d})  delivered=${a.delivered}  blocked=${a.blocked}  ` +
      `bounced=${a.bounced}  spam=${a.spam}  unsub=${a.unsub}\n  open=${a.opened} (${pct(a.opened, denom)})  ` +
      `click=${a.clicked} (${pct(a.clicked, denom)})  span=${iso(a.firstAt)}..${iso(a.lastAt)}`
    );
    const topSubjects = [...a.subjects.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
    for (const [s, n] of topSubjects) console.log(`    ${n}× ${s.slice(0, 90)}`);
    console.log('');
  }

  console.log('=== weekly volume (last 12 weeks) ===');
  const weeks = [...byWeek.entries()].sort().slice(-12);
  for (const [wk, n] of weeks) console.log(`  ${wk}: ${n}`);

  console.log('\n=== heaviest recipients (top 15) ===');
  const heavy = [...byRecipient.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15);
  for (const [to, n] of heavy) console.log(`  ${n}× ${to}`);
})();
