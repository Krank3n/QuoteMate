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

// ============================================================
// TYPES + VALIDATION
// ============================================================

type TicketType = 'ops' | 'code';
type TicketStatus = 'backlog' | 'todo' | 'in_progress' | 'done';
type TicketPriority = 'low' | 'medium' | 'high';

const VALID_TYPE: TicketType[] = ['ops', 'code'];
const VALID_STATUS: TicketStatus[] = ['backlog', 'todo', 'in_progress', 'done'];
const VALID_PRIORITY: TicketPriority[] = ['low', 'medium', 'high'];

function coerceType(v: any, fallback: TicketType = 'ops'): TicketType {
  return VALID_TYPE.includes(v) ? v : fallback;
}
function coercePriority(v: any, fallback: TicketPriority = 'medium'): TicketPriority {
  return VALID_PRIORITY.includes(v) ? v : fallback;
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

const OPS_SYSTEM = `You are an autonomous operations agent working inside the QuoteMate admin console (a CRM for an Australian tradie-invoicing SaaS). You are handed a single task ticket and must complete it end to end on your own.

Rules:
- Do the actual work — produce the deliverable, not a plan for it.
- Return your final result as clean, well-structured Markdown.
- If the task needs data or access you don't have, state exactly what's missing, then provide the best partial result you can with reasonable assumptions (label them).
- Be concise and useful. No preamble like "Sure, here is…".`;

// Runs the Claude call and writes the result. Assumes the ticket is already
// marked in_progress/running by the caller.
async function completeOpsTicket(
  ref: FirebaseFirestore.DocumentReference,
  ticket: any,
): Promise<ClaudeResult> {
  const res = await callClaude({
    system: OPS_SYSTEM,
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

const UPDATABLE_FIELDS = ['title', 'spec', 'type', 'priority', 'status', 'autoRun', 'linkedJobId'];

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

    const system = `You break a high-level goal into concrete, independently-executable task tickets for an autonomous agent. Return ONLY a JSON array (no prose, no fences) of up to ${count} objects with exactly these keys:
  "title"    : short imperative summary (max ~70 chars)
  "spec"     : a self-contained instruction the agent can act on with no other context — include acceptance criteria
  "type"     : "ops" for knowledge/research/drafting/analysis work, "code" for changes to the QuoteMate codebase
  "priority" : "low" | "medium" | "high"
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
          status: success ? 'done' : 'todo',
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
