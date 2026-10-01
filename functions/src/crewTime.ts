/**
 * Crew time links — a private link per crew member to send hours in from
 * their phone's browser, no app and no account.
 *
 *  - createCrewLink / revokeCrewLink: owner-only callables. A link is
 *    crewLinks/{sha256(token)} → { userId, crewId }; the raw token lives
 *    only on the owner's crew list (to share it again) and in the link.
 *  - crewTimePage: the public page and its two actions, `state` (who you
 *    are, which jobs are open, what you've sent) and `log` (send hours in).
 *
 * Every request re-checks that the crew member is still on the owner's
 * crew, so taking someone off kills their link even if the revoke call was
 * missed. Time sent in lands as status 'pending': it counts toward nothing
 * — no totals, no invoice, no timesheet — until the owner approves it on
 * the job. That is the safety net for a link that gets forwarded.
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

import { checkRateLimit } from './assistantToken';
import { remoteLogoUrl, sendCrewInviteEmail } from './email';
import {
  CREW_JOB_STAGES,
  crewJobView,
  crewLinkDeadPage,
  CREW_INVITE_DAILY_LIMIT,
  CREW_PAGE_FRAME_ANCESTORS,
  crewLinkPageUrl,
  isCrewEmail,
  crewTimePage as renderCrewTimePage,
  crewEntryView,
  crewMayChange,
  hashCrewToken,
  isCrewVisibleJob,
  rateLimitIp,
  isPlausibleToken,
  liveCrewMember,
  newCrewToken,
  validateCrewLog,
} from './crewTime.helpers';
import { CREW_WORKER_PREFIX } from './shared/time/types';
import { addDaysKey, weekStartKey as weekStartOf, isDateKey } from './shared/time/hours';

/** The Monday of the week asked for, or '' when the date isn't one. */
function weekStartKey(raw: string): string {
  return isDateKey(raw) ? weekStartOf(raw) : '';
}

const db = () => admin.firestore();
const PUBLIC_LIMIT = { maxRequests: 40, windowMs: 60_000 };
// Catching up a fortnight across two jobs is ~30 saves; deletes count too.
const LOG_LIMIT = { maxRequests: 60, windowMs: 60 * 60_000 };

async function linksFor(userId: string, crewId: string) {
  return db().collection('crewLinks').where('userId', '==', userId).where('crewId', '==', crewId).get();
}

function requireOwner(context: functions.https.CallableContext): string {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  return uid;
}

function requireCrewId(data: unknown): string {
  const crewId = (data as { crewId?: unknown })?.crewId;
  if (typeof crewId !== 'string' || !crewId || crewId.length > 128) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing crew member.');
  }
  return crewId;
}

/**
 * Count one invite email against the business's rolling-day allowance.
 * rateLimits is unreachable from clients (no rule matches it), so the owner
 * can't reset their own counter. False = over the limit.
 */
async function takeInviteAllowance(uid: string): Promise<boolean> {
  const ref = db().collection('rateLimits').doc(`crewInvite:${uid}`);
  const now = Date.now();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const recent = ((snap.data()?.timestamps as number[]) ?? []).filter((t) => t > now - 24 * 60 * 60 * 1000);
    if (recent.length >= CREW_INVITE_DAILY_LIMIT) return false;
    tx.set(ref, { timestamps: [...recent, now], updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  });
}

export const createCrewLink = functions.https.onCall(async (data, context) => {
  const uid = requireOwner(context);
  const crewId = requireCrewId(data);
  const settings = (await db().collection('users').doc(uid).collection('settings').doc('business').get()).data() || {};
  const member = liveCrewMember(settings.crew, crewId);
  if (!member) throw new functions.https.HttpsError('not-found', "That person isn't on your crew any more.");

  // Emailing is opt-in per call, and only ever to the address saved on the
  // crew member — never one passed in, so this can't be pointed at strangers.
  const wantsEmail = (data as { email?: unknown })?.email === true;
  const to = typeof member.email === 'string' ? member.email.trim() : '';
  if (wantsEmail) {
    if (!isCrewEmail(to)) {
      throw new functions.https.HttpsError('failed-precondition', `Add an email address for ${member.name} first.`);
    }
    if (!(await takeInviteAllowance(uid))) {
      throw new functions.https.HttpsError('resource-exhausted', "That's a lot of invites today — try again tomorrow, or send the link by text.");
    }
  }

  // One live link per person: minting a new one retires the old.
  const batch = db().batch();
  (await linksFor(uid, crewId)).docs.forEach((d) => batch.delete(d.ref));
  const token = newCrewToken();
  batch.set(db().collection('crewLinks').doc(hashCrewToken(token)), {
    userId: uid,
    crewId,
    createdAt: Date.now(),
  });
  await batch.commit();

  if (!wantsEmail) return { token };
  const ownerEmail = typeof settings.email === 'string' && settings.email ? settings.email
    : (await admin.auth().getUser(uid).catch(() => null))?.email || null;
  const emailed = await sendCrewInviteEmail({
    to,
    userId: uid,
    crewName: member.name,
    business: {
      businessName: settings.businessName,
      brandColor: settings.brandColor,
      logoUrl: remoteLogoUrl(settings.logoStorageUrl || settings.logoUri),
    },
    replyToEmail: ownerEmail,
    url: crewLinkPageUrl(token),
  }).catch(() => false);
  functions.logger.info('crew_invite_email', { uid, crewId, emailed });
  // The link is live either way; the app says when the email didn't go.
  return { token, emailed };
});

export const revokeCrewLink = functions.https.onCall(async (data, context) => {
  const uid = requireOwner(context);
  const crewId = requireCrewId(data);
  const batch = db().batch();
  (await linksFor(uid, crewId)).docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return { ok: true };
});

interface ResolvedLink {
  userId: string;
  crewId: string;
  crewName: string;
  businessName: string;
  linkId: string;
}

async function resolveLink(token: unknown): Promise<ResolvedLink | null> {
  if (!isPlausibleToken(token)) return null;
  const linkId = hashCrewToken(token);
  const link = await db().collection('crewLinks').doc(linkId).get();
  if (!link.exists) return null;
  const { userId, crewId } = link.data() as { userId: string; crewId: string };
  const settings = await db().collection('users').doc(userId).collection('settings').doc('business').get();
  const member = liveCrewMember(settings.data()?.crew, crewId);
  if (!member) return null;
  return {
    userId,
    crewId,
    crewName: member.name,
    businessName: String(settings.data()?.businessName || 'your boss'),
    linkId,
  };
}

async function openJobs(userId: string) {
  const snap = await db()
    .collection('users').doc(userId).collection('jobs')
    .where('stage', 'in', [...CREW_JOB_STAGES])
    .get();
  return snap.docs
    .filter((d) => isCrewVisibleJob(d.data()))
    .sort((a, b) => (Number(b.data().updatedAt) || 0) - (Number(a.data().updatedAt) || 0))
    .slice(0, 40)
    .map((d) => ({ view: crewJobView(d.id, d.data()), data: d.data() }));
}

/**
 * One week of this crew member's hours, with job names — every entry, open
 * job or not, so a week they worked on a job that's since closed still adds
 * up. Bounded by date in the query (workerId + date index).
 */
async function weekFor(link: ResolvedLink, startKey: string, jobNames: Map<string, string>) {
  const endKey = addDaysKey(startKey, 6);
  const snap = await db()
    .collection('users').doc(link.userId).collection('timeEntries')
    .where('workerId', '==', `${CREW_WORKER_PREFIX}${link.crewId}`)
    .where('date', '>=', startKey)
    .where('date', '<=', endKey)
    .get();
  const docs: Array<Record<string, any>> = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // Names for jobs no longer on the open list.
  const missing = [...new Set(docs.map((e) => String(e.jobId)).filter((id) => id && !jobNames.has(id)))];
  await Promise.all(missing.map(async (id) => {
    const job = (await db().collection('users').doc(link.userId).collection('jobs').doc(id).get()).data();
    jobNames.set(id, job ? crewJobView(id, job).name : 'A job');
  }));
  return docs
    .sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1))
    .map((e) => crewEntryView(e, jobNames));
}

export const crewTimePage = functions.https.onRequest(async (req, res) => {
  const ip = rateLimitIp(req.headers['x-forwarded-for'], req.ip);
  if (!(await checkRateLimit(`crew-ip:${ip}`, PUBLIC_LIMIT, res))) return;
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Security-Policy', CREW_PAGE_FRAME_ANCESTORS);

  const token = req.query.token;
  const action = req.query.action;

  if (!action) {
    // The page shell carries no data — the script asks for it — so this
    // only checks the token's shape, not the link.
    if (!isPlausibleToken(token)) {
      res.status(404).send(crewLinkDeadPage());
      return;
    }
    res.status(200).send(renderCrewTimePage(token));
    return;
  }

  try {
    const link = await resolveLink(token);
    if (!link) {
      res.status(404).json({ error: 'This link has been turned off. Ask your boss to send you a new one.' });
      return;
    }
    const jobs = await openJobs(link.userId);
    const jobNames = new Map(jobs.map((j) => [j.view.id, j.view.name]));
    const entriesRef = db().collection('users').doc(link.userId).collection('timeEntries');

    if (action === 'state' && req.method === 'GET') {
      res.status(200).json({
        crewName: link.crewName,
        businessName: link.businessName,
        jobs: jobs.map((j) => j.view),
      });
      return;
    }

    if (action === 'week' && req.method === 'GET') {
      const start = weekStartKey(String(req.query.start || ''));
      if (!start) {
        res.status(400).json({ error: 'Bad week.' });
        return;
      }
      res.status(200).json({ start, entries: await weekFor(link, start, jobNames) });
      return;
    }

    if ((action === 'log' || action === 'update') && req.method === 'POST') {
      if (!(await checkRateLimit(`crew-link:${link.linkId}`, LOG_LIMIT, res))) return;
      const { input, error } = validateCrewLog(req.body);
      if (!input) {
        res.status(400).json({ error });
        return;
      }
      const job = jobs.find((j) => j.view.id === input.jobId);
      const now = Date.now();
      const documentId = job && typeof job.data.primaryDocumentId === 'string' ? job.data.primaryDocumentId : undefined;
      const closedJobError = "That job isn't open any more — pick another or check with your boss.";

      if (action === 'update') {
        const id = String((req.body as { id?: unknown })?.id || '');
        if (!id || id.includes('/')) {
          res.status(400).json({ error: 'Which entry?' });
          return;
        }
        const ref = entriesRef.doc(id);
        // Read and write together, so an approve landing in between can't
        // let the crew change hours that have just been approved.
        const outcome = await db().runTransaction(async (tx) => {
          const current = (await tx.get(ref)).data();
          const may = crewMayChange(current, link.crewId);
          if (!may.ok) return may;
          // A job closed since still takes a fix to its own hours or note.
          if (!job && current?.jobId !== input.jobId) return { ok: false as const, status: 400, error: closedJobError };
          tx.update(ref, {
            jobId: input.jobId,
            ...(job ? { documentId: documentId ?? admin.firestore.FieldValue.delete() } : {}),
            date: input.date,
            hours: input.hours,
            note: input.note ?? admin.firestore.FieldValue.delete(),
            updatedAt: now,
          });
          return { ok: true as const };
        });
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error });
          return;
        }
        res.status(200).json({ ok: true });
        return;
      }

      if (!job) {
        res.status(400).json({ error: closedJobError });
        return;
      }
      // The page names the entry before sending it, so a save whose answer
      // got lost on bad signal and is sent again lands on the same entry
      // instead of a second one.
      const ref = input.clientId ? entriesRef.doc(input.clientId) : entriesRef.doc();
      const entry = {
        id: ref.id,
        userId: link.userId,
        jobId: input.jobId,
        ...(documentId ? { documentId } : {}),
        date: input.date,
        hours: input.hours,
        ...(input.note ? { note: input.note } : {}),
        workerId: `${CREW_WORKER_PREFIX}${link.crewId}`,
        workerName: link.crewName,
        status: 'pending',
        billable: true,
        source: 'crew_link',
        createdAt: now,
        updatedAt: now,
      };
      const created = await db().runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists) return existing.data()?.workerId === entry.workerId ? 'repeat' : 'taken';
        tx.create(ref, entry);
        return 'created';
      });
      if (created === 'taken') {
        res.status(409).json({ error: 'Something went wrong — try again.' });
        return;
      }
      if (created === 'created') {
        functions.logger.info('crewTimePage: hours sent in', { userId: link.userId, crewId: link.crewId, hours: input.hours });
      }
      res.status(200).json({ entry: { id: ref.id, date: entry.date, hours: entry.hours } });
      return;
    }

    if (action === 'delete' && req.method === 'POST') {
      if (!(await checkRateLimit(`crew-link:${link.linkId}`, LOG_LIMIT, res))) return;
      const id = String((req.body as { id?: unknown })?.id || '');
      if (!id || id.includes('/')) {
        res.status(400).json({ error: 'Which entry?' });
        return;
      }
      const ref = entriesRef.doc(id);
      const may = await db().runTransaction(async (tx) => {
        const check = crewMayChange((await tx.get(ref)).data(), link.crewId);
        if (check.ok) tx.delete(ref);
        return check;
      });
      if (!may.ok) {
        res.status(may.status).json({ error: may.error });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Not supported.' });
  } catch (err) {
    functions.logger.error('crewTimePage failed', err);
    res.status(500).json({ error: 'Something went wrong — try again in a minute.' });
  }
});
