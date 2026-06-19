/**
 * Personal AI ticket system ("Tasks" board) for the /admin panel.
 *
 * A Trello/Motion-style board where you (or AI) write up tasks and agents run
 * them automatically. Two task types:
 *   - 'ops'  : self-contained knowledge work (draft, research, analyse). Auto-run
 *              by `ticketWorker` (every 5 min) or instantly via `adminRunTicket`,
 *              executed through the Claude API entirely in this backend.
 *   - 'code' : changes to the QuoteMate repo. NOT run by the worker — queued for a
 *              Claude Code cloud agent that pulls/claims/completes them through the
 *              key-gated `ticketAgentBridge` HTTP endpoint.
 *
 * Storage: top-level `tickets/` collection, admin-only (locked in firestore.rules,
 * reached only via these callables / the admin SDK / the bridge). Mirrors how
 * `leads` / `adminAuditLog` are modelled. Every mutation is recorded in
 * `adminAuditLog/` for traceability, matching adminCrm.ts.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = () => admin.firestore();

// Model used for AI drafting + the ops worker. Matches the model the codebase
// already uses for structured extraction (callClaudeForExtraction). Swap to
// 'claude-opus-4-6' here if ops tasks need deeper reasoning.
const TICKET_MODEL = 'claude-sonnet-4-6';

// Repo the code-ticket pipeline + ship buttons act on, and the GitHub Actions
// workflow the Rebuild/Redeploy/OTA buttons dispatch. The backend needs a
// GITHUB_TOKEN (fine-grained PAT — Contents + Pull requests + Actions on this
// repo) in functions/.env; the workflow itself needs an EXPO_TOKEN repo secret.
const REPO_OWNER = 'Krank3n';
const REPO_NAME = 'QuoteMate';
const EAS_WORKFLOW_FILE = 'eas.yml';

// ============================================================
// TYPES + VALIDATION
// ============================================================

type TicketType = 'ops' | 'code';
type TicketStatus = 'backlog' | 'todo' | 'in_progress' | 'pr' | 'done';
type TicketPriority = 'low' | 'medium' | 'high';

const VALID_TYPE: TicketType[] = ['ops', 'code'];
const VALID_STATUS: TicketStatus[] = ['backlog', 'todo', 'in_progress', 'pr', 'done'];
const VALID_PRIORITY: TicketPriority[] = ['low', 'medium', 'high'];

function coerceType(v: any, fallback: TicketType = 'ops'): TicketType {
  return VALID_TYPE.includes(v) ? v : fallback;
}
function coercePriority(v: any, fallback: TicketPriority = 'medium'): TicketPriority {
  return VALID_PRIORITY.includes(v) ? v : fallback;
}

// ============================================================
// TEAM ROLES — each ticket can be assigned to a specialist whose persona drives
// how the ops worker executes it. Mirrors the .claude/agents/*.md roster in the
// web repo (those drive Claude Code; these drive the in-backend ops worker).
// ============================================================

interface Role {
  id: string;
  label: string;
  blurb: string;
  system: string;
}

const ROLE_LIST: Role[] = [
  {
    id: 'chief-of-staff',
    label: 'Chief of Staff',
    blurb: 'Plans, prioritises, and breaks goals into tickets.',
    system:
      'You are the Chief of Staff for QuoteMate (an Australian SaaS for tradies to quote, invoice, and get paid). Turn the goal into the smallest set of high-leverage actions, ruthlessly focused on revenue, activation, and retention. Be decisive, name owners and priorities when breaking work down, and cut busywork.',
  },
  {
    id: 'product-manager',
    label: 'Product Manager',
    blurb: 'Specs, roadmap, scoping, acceptance criteria.',
    system:
      "You are the Product Manager for QuoteMate. Optimise for activation and retention over feature count, anchored in the tradie's real on-site workflow. Define the smallest change that tests the hypothesis, with a clear user story, scope (and what's out), edge cases, acceptance criteria, and a success metric.",
  },
  {
    id: 'growth-marketer',
    label: 'Growth Marketer',
    blurb: 'Acquisition, positioning, funnels, experiments.',
    system:
      'You are the Growth Marketer for QuoteMate ($49/mo or $328/yr; buyers are Australian sole-trader tradies who hate admin). Optimise for qualified signups and paid conversion at sane CAC. Lead with the job-to-be-done, write like a tradie talks (Australian tone), give one CTA per asset, and always propose a measurable test. Never propose free tools that cannibalise the paid app.',
  },
  {
    id: 'content-seo-writer',
    label: 'Content / SEO Writer',
    blurb: 'SEO articles, landing copy, lifecycle emails.',
    system:
      'You are the Content & SEO Writer for QuoteMate, writing for Australian tradies and organic search. Match real search intent, structure for skim-reading, use Australian spelling/units/trades, stay concrete with real steps and numbers, and drive one clear CTA into the product. Never recommend a free competitor tool. Include a title and meta description with the body.',
  },
  {
    id: 'sales-outreach',
    label: 'Sales / Outreach',
    blurb: 'Cold outreach, qualification, follow-ups.',
    system:
      'You are the Sales & Outreach rep for QuoteMate, targeting Australian tradie businesses. Optimise for positive replies and booked trials per send while protecting deliverability. Personalise on something real, keep it short/plain/mobile-readable with one clear ask, lead with their pain, and respect opt-out/DNC. Provide subject + body and any follow-ups.',
  },
  {
    id: 'customer-success',
    label: 'Customer Success',
    blurb: 'Onboarding, retention, churn, support replies.',
    system:
      'You are the Customer Success lead for QuoteMate (7-day trial then $49/mo). Drive users to activation (first quote sent), retention, and referrals. Segment by behaviour, remove friction, and write warm, plain, human messages in an Australian tone. For support replies, fix it fast and acknowledge the on-site job context.',
  },
  {
    id: 'software-engineer',
    label: 'Software Engineer',
    blurb: 'Implements code tickets (via the cloud code agent).',
    system:
      'You are a Software Engineer on QuoteMate (Expo RN app + Firebase Functions + Next.js admin, TypeScript). Match existing conventions and make the smallest change that satisfies the spec; never touch secrets, billing logic, or deploy. Code tickets are normally executed by the cloud code agent on a branch — when answering here, produce a precise implementation plan, the proposed diff/approach, or a code review, as Markdown.',
  },
  {
    id: 'qa-tester',
    label: 'QA Tester',
    blurb: 'Test plans, repro steps, edge cases, verification.',
    system:
      'You are the QA Tester for QuoteMate. Assume nothing works until shown. Turn a change into concrete test cases (preconditions, steps, expected result), cover the nasty edges (zero/empty, GST rounding, double-submit, permissions, expired trials), and prioritise the money paths and cross-user data isolation. For bugs, give exact repro, actual vs expected, and severity.',
  },
  {
    id: 'finance-analyst',
    label: 'Finance / Data Analyst',
    blurb: 'Revenue, MRR, churn, reconciliation, pricing.',
    system:
      "You are the Finance & Data Analyst for QuoteMate (Stripe $49/mo or $328/yr; Square in-app ~3.1%). Give an honest, decision-useful read. Define every metric precisely, separate trial / active Pro / canceling / churned, never inflate MRR with non-billed accounts, show the math and your assumptions, and end with a clear 'so what' recommendation. Convert relative dates to absolute.",
  },
];

const ROLES: Record<string, Role> = Object.fromEntries(ROLE_LIST.map((r) => [r.id, r]));

function coerceRole(v: any): string | null {
  return v && ROLES[v] ? v : null;
}

// ============================================================
// AUTH + AUDIT (same pattern as adminCrm.ts; both helpers are module-local there)
// ============================================================

function requireAdmin(context: functions.https.CallableContext): string {
  const uid = context.auth?.uid;
  const isAdmin = context.auth?.token?.admin === true;
  if (!uid || !isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }
  return uid;
}

async function logTicketAction(
  adminUid: string,
  action: string,
  ticketId: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await db().collection('adminAuditLog').add({
      adminUid,
      action,
      targetType: 'ticket',
      targetId: ticketId,
      payload: payload || {},
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('adminAuditLog write failed', err);
  }
}

// ============================================================
// CLAUDE PROXY — raw fetch (no SDK), mirrors callClaudeJSON in leadOutreach.ts.
// Node 20 has global fetch; leadOutreach.ts calls it the same way.
// ============================================================

type ClaudeResult = { ok: true; text: string } | { ok: false; error: string };

async function callClaude(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}): Promise<ClaudeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY missing' };
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model || TICKET_MODEL,
        max_tokens: opts.maxTokens || 4096,
        temperature: opts.temperature ?? 0.4,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      }),
    });
    if (!response.ok) {
      const txt = await response.text().catch(() => '');
      return { ok: false, error: `claude-${response.status}: ${txt.slice(0, 300)}` };
    }
    const body: any = await response.json();
    const text = ((body?.content || []) as any[])
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!text) return { ok: false, error: 'claude returned empty response' };
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, error: `claude-network: ${e?.message || 'unknown'}` };
  }
}

// Pull the first JSON array/object out of a Claude response (handles ``` fences).
function parseJsonLoose(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const raw = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through to bracket slicing */
  }
  const a = raw.indexOf('[');
  const b = raw.lastIndexOf(']');
  if (a >= 0 && b > a) return JSON.parse(raw.slice(a, b + 1));
  const o = raw.indexOf('{');
  const c = raw.lastIndexOf('}');
  if (o >= 0 && c > o) return JSON.parse(raw.slice(o, c + 1));
  throw new Error('no JSON found in response');
}

// ============================================================
// OPS EXECUTOR — shared by adminRunTicket (inline) and ticketWorker (claimed)
// ============================================================

const OPS_GENERIC = `You are an autonomous operations agent working inside the QuoteMate admin console (a CRM for an Australian tradie-invoicing SaaS). You are handed a single task ticket and must complete it end to end on your own.`;

const OPS_DELIVERY = `Rules:
- Do the actual work — produce the deliverable, not a plan for it (unless the task explicitly asks for a plan).
- Return your final result as clean, well-structured Markdown.
- If the task needs data or access you don't have, state exactly what's missing, then provide the best partial result you can with clearly-labelled assumptions.
- Be concise and useful. No preamble like "Sure, here is…".`;

// Compose the system prompt for an ops ticket: the assigned role's persona (or a
// generic operator when unassigned) plus the shared delivery contract.
function buildOpsSystem(role: any): string {
  const r = role && ROLES[role];
  return `${r ? r.system : OPS_GENERIC}\n\n${OPS_DELIVERY}`;
}

// Runs the Claude call and writes the result. Assumes the ticket is already
// marked in_progress/running by the caller.
async function completeOpsTicket(
  ref: FirebaseFirestore.DocumentReference,
  ticket: any,
): Promise<ClaudeResult> {
  const res = await callClaude({
    system: buildOpsSystem(ticket.role),
    user: `Task title: ${ticket.title}\n\nTask details / spec:\n${ticket.spec || '(no further detail)'}`,
    maxTokens: 4096,
  });
  const now = Date.now();
  if (res.ok) {
    await ref.update({
      status: 'done',
      agentStatus: 'succeeded',
      output: res.text,
      error: null,
      finishedAt: now,
      updatedAt: now,
    });
  } else {
    // On failure: surface for attention and disable autoRun so the worker
    // doesn't retry-loop a broken ticket every 5 minutes.
    await ref.update({
      status: 'todo',
      agentStatus: 'failed',
      error: res.error,
      autoRun: false,
      finishedAt: now,
      updatedAt: now,
    });
  }
  return res;
}

// Manual "Run now": flips to running then completes.
async function executeOpsTicketInline(
  ref: FirebaseFirestore.DocumentReference,
  ticket: any,
): Promise<ClaudeResult> {
  const now = Date.now();
  await ref.update({
    status: 'in_progress',
    agentStatus: 'running',
    startedAt: now,
    error: null,
    updatedAt: now,
  });
  return completeOpsTicket(ref, ticket);
}

// ============================================================
// CALLABLES
// ============================================================

export const adminListTickets = functions.https.onCall(async (data, context) => {
  requireAdmin(context);
  const limit = Math.min(Number(data?.limit) || 500, 1000);
  // Equality-only filters (no orderBy) so no composite index is required; sort
  // newest-first in memory. The board loads everything and groups by column.
  let q: FirebaseFirestore.Query = db().collection('tickets');
  if (data?.status && VALID_STATUS.includes(data.status)) q = q.where('status', '==', data.status);
  if (data?.type && VALID_TYPE.includes(data.type)) q = q.where('type', '==', data.type);
  const snap = await q.limit(limit).get();
  const tickets = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { tickets };
});

// The team roster — drives the role picker in the UI and ops execution personas.
export const adminListTicketRoles = functions.https.onCall(async (_data, context) => {
  requireAdmin(context);
  return { roles: ROLE_LIST.map(({ id, label, blurb }) => ({ id, label, blurb })) };
});

export const adminCreateTicket = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const title = (data?.title || '').toString().trim();
  const spec = (data?.spec || '').toString().trim();
  if (!title) throw new functions.https.HttpsError('invalid-argument', 'title required');

  const type = coerceType(data?.type);
  const priority = coercePriority(data?.priority);
  const status: TicketStatus = VALID_STATUS.includes(data?.status) ? data.status : 'backlog';
  const now = Date.now();

  const ref = await db().collection('tickets').add({
    title,
    spec,
    type,
    priority,
    role: coerceRole(data?.role),
    status,
    autoRun: data?.autoRun === true,
    agentStatus: 'idle',
    output: '',
    error: null,
    logs: [],
    prUrl: null,
    linkedJobId: (data?.linkedJobId || '').toString() || null,
    source: data?.source === 'ai-draft' ? 'ai-draft' : 'manual',
    createdBy: adminUid,
    createdAt: now,
    updatedAt: now,
  });
  await logTicketAction(adminUid, 'create_ticket', ref.id, { title, type, status });
  return { id: ref.id };
});

const UPDATABLE_FIELDS = ['title', 'spec', 'type', 'priority', 'role', 'status', 'autoRun', 'linkedJobId'];

export const adminUpdateTicket = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const id = (data?.id || '').toString();
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');
  const patch = (data?.patch || {}) as Record<string, any>;

  const update: Record<string, any> = { updatedAt: Date.now() };
  for (const key of UPDATABLE_FIELDS) {
    if (!(key in patch)) continue;
    if (key === 'type') update.type = coerceType(patch.type);
    else if (key === 'priority') update.priority = coercePriority(patch.priority);
    else if (key === 'role') update.role = coerceRole(patch.role);
    else if (key === 'status') {
      if (!VALID_STATUS.includes(patch.status)) continue;
      update.status = patch.status;
    } else if (key === 'autoRun') update.autoRun = patch.autoRun === true;
    else if (key === 'linkedJobId') update.linkedJobId = (patch.linkedJobId || '').toString() || null;
    else update[key] = (patch[key] || '').toString();
  }

  await db().collection('tickets').doc(id).update(update);
  await logTicketAction(adminUid, 'update_ticket', id, { fields: Object.keys(update) });
  return { ok: true };
});

export const adminDeleteTicket = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const id = (data?.id || '').toString();
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');
  await db().collection('tickets').doc(id).delete();
  await logTicketAction(adminUid, 'delete_ticket', id);
  return { ok: true };
});

// AI: turn a freeform goal into a set of draft tickets. Returns drafts (NOT
// saved) so the UI can preview + let the user pick which to add to the board.
export const adminDraftTickets = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .https.onCall(async (data, context) => {
    requireAdmin(context);
    const goal = (data?.goal || '').toString().trim();
    if (!goal) throw new functions.https.HttpsError('invalid-argument', 'goal required');
    const count = Math.min(Math.max(Number(data?.count) || 4, 1), 12);
    const typeHint = coerceType(data?.type);
    const roleMenu = ROLE_LIST.map((r) => `${r.id} (${r.blurb})`).join('; ');

    const system = `You break a high-level goal into concrete, independently-executable task tickets for an autonomous agent. Return ONLY a JSON array (no prose, no fences) of up to ${count} objects with exactly these keys:
  "title"    : short imperative summary (max ~70 chars)
  "spec"     : a self-contained instruction the agent can act on with no other context — include acceptance criteria
  "type"     : "ops" for knowledge/research/drafting/analysis work, "code" for changes to the QuoteMate codebase
  "priority" : "low" | "medium" | "high"
  "role"     : the single best-fit specialist id to own it, chosen from — ${roleMenu}
Prefer fewer, well-scoped tickets over many tiny ones. Default type to "${typeHint}" when ambiguous.`;

    const res = await callClaude({ system, user: `Goal:\n${goal}`, maxTokens: 4096, temperature: 0.5 });
    if (!res.ok) throw new functions.https.HttpsError('internal', res.error);

    let parsed: any;
    try {
      parsed = parseJsonLoose(res.text);
    } catch (e: any) {
      throw new functions.https.HttpsError('internal', `Could not parse AI output: ${e?.message || e}`);
    }
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tickets) ? parsed.tickets : [];
    const drafts = arr
      .filter((d: any) => d && (d.title || d.spec))
      .slice(0, count)
      .map((d: any) => ({
        title: (d.title || '').toString().trim().slice(0, 140),
        spec: (d.spec || '').toString().trim(),
        type: coerceType(d.type, typeHint),
        priority: coercePriority(d.priority),
        role: coerceRole(d.role),
      }));
    return { drafts };
  });

// Manual dispatch. ops → execute immediately (inline). code → queue for the bridge.
export const adminRunTicket = functions
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(async (data, context) => {
    const adminUid = requireAdmin(context);
    const id = (data?.id || '').toString();
    if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');

    const ref = db().collection('tickets').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'ticket not found');
    const ticket = snap.data() as any;

    if (ticket.agentStatus === 'running') {
      throw new functions.https.HttpsError('failed-precondition', 'ticket is already running');
    }

    if (ticket.type === 'code') {
      const now = Date.now();
      await ref.update({ status: 'todo', agentStatus: 'queued', updatedAt: now });
      await logTicketAction(adminUid, 'queue_code_ticket', id);
      return { ok: true, queued: true };
    }

    await logTicketAction(adminUid, 'run_ops_ticket', id);
    const res = await executeOpsTicketInline(ref, ticket);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, output: res.text };
  });

// ============================================================
// SCHEDULED WORKER — auto-runs flagged ops tickets every 5 minutes
// ============================================================

export const ticketWorker = functions
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .pubsub.schedule('every 5 minutes')
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    // Equality-only query (no composite index needed); pick the oldest few.
    const snap = await db()
      .collection('tickets')
      .where('type', '==', 'ops')
      .where('status', '==', 'todo')
      .where('autoRun', '==', true)
      .limit(25)
      .get();

    const docs = snap.docs
      .sort((a, b) => ((a.data() as any).createdAt || 0) - ((b.data() as any).createdAt || 0))
      .slice(0, 3);

    let ran = 0;
    for (const doc of docs) {
      const ref = doc.ref;
      // Claim atomically so overlapping scheduler ticks never double-run a ticket.
      const claimed = await db().runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        const d = fresh.data() as any;
        if (!d || d.status !== 'todo' || d.agentStatus === 'running' || d.autoRun !== true) return false;
        const now = Date.now();
        tx.update(ref, {
          status: 'in_progress',
          agentStatus: 'running',
          claimedBy: 'worker',
          claimedAt: now,
          startedAt: now,
          error: null,
          updatedAt: now,
        });
        return true;
      });
      if (!claimed) continue;

      try {
        await completeOpsTicket(ref, doc.data());
        ran++;
      } catch (e: any) {
        await ref.update({
          status: 'todo',
          agentStatus: 'failed',
          error: String(e?.message || e),
          autoRun: false,
          updatedAt: Date.now(),
        });
      }
    }
    console.log(`ticketWorker: ran ${ran} ops ticket(s)`);
    return null;
  });

// ============================================================
// AGENT BRIDGE — key-gated HTTP for a Claude Code cloud agent to run code tickets.
// Same auth shape as bootstrapAdminClaim, but its own TICKET_AGENT_KEY secret.
//
//   GET  ?action=list                          → claimable code tickets
//   POST ?action=claim    {ticketId, agentId}  → lock a ticket, returns its spec
//   POST ?action=complete {ticketId, success, output, prUrl?}
//   POST ?action=log      {ticketId, message}  → append a progress line
// ============================================================

function codeTicketView(id: string, x: any) {
  return { id, title: x.title, spec: x.spec, priority: x.priority, linkedJobId: x.linkedJobId || null };
}

export const ticketAgentBridge = functions.https.onRequest(async (req, res) => {
  try {
    const key = req.get('x-agent-key') || (req.query.key as string | undefined);
    const expected = process.env.TICKET_AGENT_KEY;
    if (!expected || !key || key !== expected) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const action = ((req.query.action as string) || (req.body?.action as string) || '').toString();

    if (action === 'list') {
      const snap = await db()
        .collection('tickets')
        .where('type', '==', 'code')
        .where('status', '==', 'todo')
        .limit(50)
        .get();
      const tickets = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((t) => t.agentStatus !== 'running')
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .map((t) => codeTicketView(t.id, t));
      res.json({ tickets });
      return;
    }

    if (action === 'claim') {
      const ticketId = (req.body?.ticketId || req.query.ticketId || '').toString();
      const agentId = (req.body?.agentId || 'claude-code-agent').toString();
      if (!ticketId) {
        res.status(400).json({ error: 'ticketId required' });
        return;
      }
      const ref = db().collection('tickets').doc(ticketId);
      const result = await db().runTransaction<{ code: number; body: any }>(async (tx) => {
        const d = await tx.get(ref);
        if (!d.exists) return { code: 404, body: { error: 'not found' } };
        const x = d.data() as any;
        if (x.type !== 'code') return { code: 400, body: { error: 'not a code ticket' } };
        if (x.status !== 'todo' || x.agentStatus === 'running') {
          return { code: 409, body: { error: 'already claimed' } };
        }
        const now = Date.now();
        tx.update(ref, {
          status: 'in_progress',
          agentStatus: 'running',
          claimedBy: agentId,
          claimedAt: now,
          startedAt: now,
          error: null,
          updatedAt: now,
        });
        return { code: 200, body: { ok: true, ticket: codeTicketView(ref.id, x) } };
      });
      res.status(result.code).json(result.body);
      return;
    }

    if (action === 'complete') {
      const ticketId = (req.body?.ticketId || '').toString();
      if (!ticketId) {
        res.status(400).json({ error: 'ticketId required' });
        return;
      }
      const success = req.body?.success !== false;
      const output = (req.body?.output || '').toString();
      const prUrl = req.body?.prUrl ? req.body.prUrl.toString() : null;
      const now = Date.now();
      await db()
        .collection('tickets')
        .doc(ticketId)
        .update({
          // A completed code ticket with a PR lands in the 'pr' (review/ship)
          // lane, not 'done' — 'done' means merged + shipped.
          status: success ? (prUrl ? 'pr' : 'done') : 'todo',
          agentStatus: success ? 'succeeded' : 'failed',
          output,
          prUrl,
          finishedAt: now,
          updatedAt: now,
          ...(success ? { error: null } : { error: output || 'agent reported failure', autoRun: false }),
        });
      res.json({ ok: true });
      return;
    }

    if (action === 'log') {
      const ticketId = (req.body?.ticketId || '').toString();
      const message = (req.body?.message || '').toString();
      if (!ticketId || !message) {
        res.status(400).json({ error: 'ticketId and message required' });
        return;
      }
      await db()
        .collection('tickets')
        .doc(ticketId)
        .update({
          logs: admin.firestore.FieldValue.arrayUnion({ at: Date.now(), message }),
          updatedAt: Date.now(),
        });
      res.json({ ok: true });
      return;
    }

    res.status(400).json({ error: `unknown action: ${action || '(none)'}` });
  } catch (err: any) {
    console.error('ticketAgentBridge failed', err);
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

// ============================================================
// SHIP CONTROLS — merge PRs + drive EAS builds / submits / OTA via the GitHub
// Actions workflow (.github/workflows/eas.yml). All GitHub calls use
// GITHUB_TOKEN (functions/.env). Outward-facing + costs build credits / hits
// the stores — only ever fired on an explicit admin button click.
// ============================================================

async function githubFetch(
  path: string,
  init: { method: string; body?: any },
): Promise<{ status: number; body: any }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new functions.https.HttpsError('failed-precondition', 'GITHUB_TOKEN not configured');
  const res = await fetch(`https://api.github.com${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'quotemate-admin',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function parsePrUrl(prUrl: string | undefined | null): { owner: string; repo: string; number: number } | null {
  if (!prUrl) return null;
  const m = String(prUrl).match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

// Merge the ticket's PR (squash by default) via the GitHub API.
export const adminMergeTicketPR = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const id = (data?.id || '').toString();
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');
  const ref = db().collection('tickets').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'ticket not found');
  const ticket = snap.data() as any;
  const pr = parsePrUrl(ticket.prUrl);
  if (!pr) throw new functions.https.HttpsError('failed-precondition', 'ticket has no GitHub PR url');

  const method = ['squash', 'merge', 'rebase'].includes((data?.method || '').toString()) ? data.method : 'squash';
  const r = await githubFetch(`/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/merge`, {
    method: 'PUT',
    body: { merge_method: method },
  });
  if (r.status >= 300) {
    const msg = (r.body?.message || JSON.stringify(r.body) || '').toString().slice(0, 200);
    throw new functions.https.HttpsError('internal', `GitHub merge failed (${r.status}): ${msg}`);
  }
  await ref.update({ prMerged: true, shipStatus: 'merged', updatedAt: Date.now() });
  await logTicketAction(adminUid, 'merge_pr', id, { pr: pr.number, sha: r.body?.sha || null });
  return { ok: true, merged: true, sha: r.body?.sha || null };
});

// Dispatch the EAS workflow for this ticket. action: 'build' (full native),
// 'submit' (to the stores), or 'update' (instant OTA, JS-only).
export const adminDispatchEas = functions.https.onCall(async (data, context) => {
  const adminUid = requireAdmin(context);
  const id = (data?.id || '').toString();
  const eas = (data?.action || '').toString();
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');
  if (!['build', 'submit', 'update'].includes(eas)) {
    throw new functions.https.HttpsError('invalid-argument', 'action must be build | submit | update');
  }
  const platform = ['all', 'android', 'ios'].includes((data?.platform || '').toString()) ? data.platform : 'all';
  const profile = (data?.profile || 'production').toString();

  const ref = db().collection('tickets').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'ticket not found');
  const ticket = snap.data() as any;
  const message = (data?.message || ticket.releaseNotes || ticket.title || '').toString().slice(0, 800);

  const r = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${EAS_WORKFLOW_FILE}/dispatches`, {
    method: 'POST',
    body: { ref: 'main', inputs: { action: eas, platform, profile, message } },
  });
  if (r.status >= 300) {
    const msg = (r.body?.message || JSON.stringify(r.body) || '').toString().slice(0, 200);
    throw new functions.https.HttpsError('internal', `Workflow dispatch failed (${r.status}): ${msg}`);
  }
  const runsUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${EAS_WORKFLOW_FILE}`;
  const shipStatus = eas === 'build' ? 'building' : eas === 'submit' ? 'submitting' : 'updating';
  await ref.update({
    shipStatus,
    buildRunUrl: runsUrl,
    lastDispatch: { action: eas, platform, at: Date.now() },
    updatedAt: Date.now(),
  });
  await logTicketAction(adminUid, `eas_${eas}`, id, { platform, profile });
  return { ok: true, runsUrl };
});

// AI: write user-facing "What's New" notes from the ticket (store notes / OTA message).
export const adminGenerateReleaseNotes = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const adminUid = requireAdmin(context);
    const id = (data?.id || '').toString();
    if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');
    const ref = db().collection('tickets').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'ticket not found');
    const ticket = snap.data() as any;

    const res = await callClaude({
      system:
        "You write short App Store / Play Store \"What's New\" release notes for QuoteMate, an app for Australian tradies. 1-3 plain, benefit-led sentences or short bullets. No jargon, no version numbers, no implementation detail, Australian tone. Describe what the user gets.",
      user: `Ticket: ${ticket.title}\n\nDetails:\n${ticket.spec || ''}\n\nWhat was built:\n${ticket.output || ''}`,
      maxTokens: 400,
      temperature: 0.5,
    });
    if (!res.ok) throw new functions.https.HttpsError('internal', res.error);
    await ref.update({ releaseNotes: res.text, updatedAt: Date.now() });
    await logTicketAction(adminUid, 'generate_release_notes', id);
    return { releaseNotes: res.text };
  });
