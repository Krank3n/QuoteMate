/**
 * Pull recent Mate conversations out of Firestore for QA / accuracy review.
 *
 * Reads the collectionGroup('assistantConversations') mirror the app writes
 * (see firestoreService.saveConversation) and prints the most recent chats,
 * with an --errors mode that dumps full transcripts for any conversation that
 * carried an errorMessage or a failed proposal.
 *
 * Requires gcloud Application Default Credentials.
 *
 *   node scripts/mate-convo-audit.cjs [--limit=30] [--errors] [--json=out.json]
 */
const path = require('path');
const fs = require('fs');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const LIMIT = Number(argOf('limit', 30));
const ERRORS_ONLY = args.includes('--errors');
const JSON_OUT = argOf('json', null);

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'hansendev',
});

const tsMs = (v) => {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Date.parse(v) || 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return 0;
};

(async () => {
  const snap = await admin.firestore().collectionGroup('assistantConversations').get();
  const rows = snap.docs
    .map((d) => {
      const c = d.data() || {};
      const messages = Array.isArray(c.messages) ? c.messages : [];
      const visible = messages.filter((m) => !m?.hidden);
      const errors = [];
      let failed = 0;
      let applied = 0;
      let dismissed = 0;
      let proposals = 0;
      for (const m of messages) {
        if (m?.errorMessage) errors.push(String(m.errorMessage));
        proposals += Array.isArray(m?.proposals) ? m.proposals.length : 0;
        const st = m?.proposalStatus && typeof m.proposalStatus === 'object' ? m.proposalStatus : {};
        for (const s of Object.values(st)) {
          if (s === 'failed') failed++;
          else if (s === 'applied') applied++;
          else if (s === 'dismissed') dismissed++;
        }
      }
      return {
        id: d.id,
        uid: d.ref.parent.parent ? d.ref.parent.parent.id : '',
        platform: c.platform || null,
        updatedAt: tsMs(c.updatedAt) || tsMs(c.createdAt),
        messageCount: messages.length,
        userMessages: visible.filter((m) => m.role === 'user').length,
        proposals,
        applied,
        dismissed,
        failed,
        errors,
        messages,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const picked = (ERRORS_ONLY ? rows.filter((r) => r.errors.length || r.failed) : rows).slice(0, LIMIT);

  console.log(`total conversations: ${rows.length}`);
  console.log(`with errors or failed applies: ${rows.filter((r) => r.errors.length || r.failed).length}`);
  console.log('');

  for (const r of picked) {
    const when = r.updatedAt ? new Date(r.updatedAt).toISOString() : 'unknown';
    console.log('='.repeat(78));
    console.log(`${when}  ${r.platform || '?'}  uid=${r.uid.slice(0, 10)}  convo=${r.id}`);
    console.log(`msgs=${r.messageCount} user=${r.userMessages} proposals=${r.proposals} applied=${r.applied} dismissed=${r.dismissed} failed=${r.failed} errors=${r.errors.length}`);
    if (r.errors.length) for (const e of r.errors) console.log(`  ERROR: ${e}`);
    if (ERRORS_ONLY) {
      for (const m of r.messages) {
        const tag = m.hidden ? `${m.role}/hidden` : m.role;
        const text = typeof m.text === 'string' ? m.text : '';
        console.log(`  [${tag}] ${text.replace(/\s+/g, ' ').slice(0, 600)}`);
        if (m.errorMessage) console.log(`     !! ${m.errorMessage}`);
        for (const p of Array.isArray(m.proposals) ? m.proposals : []) {
          console.log(`     <proposal ${p.type}> ${JSON.stringify(p).slice(0, 400)}`);
        }
        if (m.proposalStatus) console.log(`     <status> ${JSON.stringify(m.proposalStatus)}`);
      }
    }
    console.log('');
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(picked, null, 2));
    console.log(`wrote ${JSON_OUT}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
