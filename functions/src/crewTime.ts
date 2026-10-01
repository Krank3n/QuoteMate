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
import {
  CREW_JOB_STAGES,
  crewJobView,
  crewLinkDeadPage,
  CREW_PAGE_FRAME_ANCESTORS,
  crewTimePage as renderCrewTimePage,
  hashCrewToken,
  isCrewVisibleJob,
  rateLimitIp,
  isPlausibleToken,
  liveCrewMember,
  newCrewToken,
  validateCrewLog,
} from './crewTime.helpers';
import { CREW_WORKER_PREFIX } from './shared/time/types';

const db = () => admin.firestore();
const PUBLIC_LIMIT = { maxRequests: 40, windowMs: 60_000 };
const LOG_LIMIT = { maxRequests: 20, windowMs: 60 * 60_000 };
const RECENT_DAYS = 21;

async function crewOf(userId: string): Promise<unknown> {
  const snap = await db().collection('users').doc(userId).collection('settings').doc('business').get();
  return snap.exists ? snap.data()?.crew : undefined;
}

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

export const createCrewLink = functions.https.onCall(async (data, context) => {
  const uid = requireOwner(context);
  const crewId = requireCrewId(data);
  const member = liveCrewMember(await crewOf(uid), crewId);
  if (!member) throw new functions.https.HttpsError('not-found', "That person isn't on your crew any more.");

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
  return { token };
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

/** What this crew member has sent in lately, newest first, with job names. */
async function recentFor(link: ResolvedLink, jobNames: Map<string, string>) {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // Bounded by date in the query (composite index in firestore.indexes.json)
  // so a long-serving crew member's page doesn't read their whole history.
  const snap = await db()
    .collection('users').doc(link.userId).collection('timeEntries')
    .where('workerId', '==', `${CREW_WORKER_PREFIX}${link.crewId}`)
    .where('date', '>=', since)
    .get();
  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1))
    .slice(0, 15)
    .map((e) => ({
      date: String(e.date),
      hours: Number(e.hours) || 0,
      jobName: jobNames.get(String(e.jobId)) || 'A job',
      status: e.status === 'pending' ? 'pending' : 'approved',
    }));
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

    if (action === 'state' && req.method === 'GET') {
      res.status(200).json({
        crewName: link.crewName,
        businessName: link.businessName,
        jobs: jobs.map((j) => j.view),
        recent: await recentFor(link, jobNames),
      });
      return;
    }

    if (action === 'log' && req.method === 'POST') {
      if (!(await checkRateLimit(`crew-link:${link.linkId}`, LOG_LIMIT, res))) return;
      const { input, error } = validateCrewLog(req.body);
      if (!input) {
        res.status(400).json({ error });
        return;
      }
      const job = jobs.find((j) => j.view.id === input.jobId);
      if (!job) {
        res.status(400).json({ error: "That job isn't open any more — pick another or check with your boss." });
        return;
      }
      const ref = db().collection('users').doc(link.userId).collection('timeEntries').doc();
      const now = Date.now();
      const entry = {
        id: ref.id,
        userId: link.userId,
        jobId: input.jobId,
        ...(typeof job.data.primaryDocumentId === 'string' ? { documentId: job.data.primaryDocumentId } : {}),
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
      await ref.set(entry);
      functions.logger.info('crewTimePage: hours sent in', { userId: link.userId, crewId: link.crewId, hours: input.hours });
      res.status(200).json({
        entry: { date: entry.date, hours: entry.hours },
        recent: await recentFor(link, jobNames),
      });
      return;
    }

    res.status(405).json({ error: 'Not supported.' });
  } catch (err) {
    functions.logger.error('crewTimePage failed', err);
    res.status(500).json({ error: 'Something went wrong — try again in a minute.' });
  }
});
