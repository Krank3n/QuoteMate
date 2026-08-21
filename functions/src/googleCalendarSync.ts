/**
 * Google Calendar — push Job schedules to the tradie's calendar.
 *
 * Phase-14 server trigger. Fires on writes to users/{uid}/jobs/{jobId}.
 * Decision matrix:
 *
 *               | scheduledStartDate set     | scheduledStartDate cleared
 *  ─────────────┼────────────────────────────┼───────────────────────────
 *   no GCal     | (skip — connection gate)   | (skip)
 *   connected & | upsert event:               | delete event if there is
 *   no event id |  - create, store id         | one (idempotent)
 *   connected & | update event with the new   | delete event, clear id
 *   has id      | start/end + summary etc.    |
 *
 * One-way (app → GCal). Tradies who reschedule inside GCal won't see
 * changes flow back into the app — that's deferred (two-way sync is a
 * conflict-resolution rabbit hole).
 *
 * Failure handling: any failure stamps `lastSyncError` on the
 * integration doc (which the client surfaces via the connection state)
 * and the Job's `googleCalendarSyncError` field. We don't fail the Job
 * write — calendar sync is supplementary.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';

import {
  calendarIntegrationRef,
  mintAccessTokenForUser,
} from './googleCalendarAuth';

const db = () => admin.firestore();
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

interface JobLike {
  id?: string;
  name?: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  scheduledStartDate?: number;
  scheduledEndDate?: number;
  googleCalendarEventId?: string;
  googleCalendarSyncError?: { at?: number; message?: string };
}

export const onJobWriteSyncCal = functions.firestore
  .document('users/{userId}/jobs/{jobId}')
  .onWrite(async (change, ctx) => {
    const userId = ctx.params.userId as string;
    const jobId = ctx.params.jobId as string;

    const before = (change.before.exists ? change.before.data() : null) as JobLike | null;
    const after = (change.after.exists ? change.after.data() : null) as JobLike | null;

    // Job deleted: best-effort delete the matching GCal event using the
    // id we last stored on it.
    if (!after) {
      const eventId = before?.googleCalendarEventId;
      if (eventId) await safeDeleteEvent(userId, eventId);
      return;
    }

    // No connection? Bail. Leave any existing event alone — the tradie
    // probably disconnected on purpose; we don't go and clean up GCal
    // events they may want to keep.
    const integrationSnap = await calendarIntegrationRef(userId).get();
    if (!integrationSnap.exists) return;

    const beforeMs = Number(before?.scheduledStartDate) || 0;
    const afterMs = Number(after?.scheduledStartDate) || 0;
    const eventId = after.googleCalendarEventId;

    // Skip if nothing scheduling-relevant changed and the event already
    // exists — saves a refresh + API call on every notes edit.
    const titleChanged =
      (before?.name || '') !== (after.name || '') ||
      (before?.customerName || '') !== (after.customerName || '');
    const addressChanged = (before?.jobAddress || '') !== (after.jobAddress || '');
    const descriptionChanged = (before?.description || '') !== (after.description || '');
    // `|| 0` matters: Number(undefined) is NaN and NaN !== NaN, so without it
    // any job lacking an end date always counts as "changed" — the write-backs
    // below then re-fire this trigger in an infinite loop.
    const endChanged =
      (Number(before?.scheduledEndDate) || 0) !== (Number(after.scheduledEndDate) || 0);
    if (
      beforeMs === afterMs &&
      !titleChanged &&
      !addressChanged &&
      !descriptionChanged &&
      !endChanged
    ) {
      return;
    }

    // Fresh schedule cleared → delete the event (if any).
    if (!afterMs) {
      if (eventId) {
        await safeDeleteEvent(userId, eventId);
        await db()
          .doc(`users/${userId}/jobs/${jobId}`)
          .set(
            { googleCalendarEventId: admin.firestore.FieldValue.delete() },
            { merge: true },
          );
      }
      return;
    }

    // Mint a token; bail (with a recorded error) if the connection is
    // broken — mintAccessTokenForUser handles the dead-grant cleanup.
    const tokenSnap = await mintAccessTokenForUser(userId);
    if (!tokenSnap) {
      await stampError(
        userId,
        jobId,
        'Calendar connection expired — reconnect in Settings.',
        after.googleCalendarSyncError,
      );
      return;
    }

    const eventBody = buildEventBody(after);
    try {
      if (eventId) {
        await patchEvent(tokenSnap.accessToken, eventId, eventBody);
      } else {
        const created = await createEvent(tokenSnap.accessToken, eventBody);
        await db()
          .doc(`users/${userId}/jobs/${jobId}`)
          .set({ googleCalendarEventId: created.id }, { merge: true });
      }
      // Clear any prior error.
      await db()
        .doc(`users/${userId}/jobs/${jobId}`)
        .set(
          { googleCalendarSyncError: admin.firestore.FieldValue.delete() },
          { merge: true },
        )
        .catch(() => undefined);
      await calendarIntegrationRef(userId)
        .set(
          { lastSyncError: admin.firestore.FieldValue.delete() },
          { merge: true },
        )
        .catch(() => undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      functions.logger.warn('[gcal] sync failed', { userId, jobId, message });
      await stampError(userId, jobId, message, after.googleCalendarSyncError);
    }
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEventBody(job: JobLike) {
  const start = Number(job.scheduledStartDate) || 0;
  const startD = new Date(start);
  const isAllDay = startD.getUTCHours() === 0 && startD.getUTCMinutes() === 0;
  const explicitEnd =
    job.scheduledEndDate && job.scheduledEndDate > start ? job.scheduledEndDate : null;
  const end = explicitEnd ?? start + 2 * 60 * 60 * 1000; // default 2h window

  const summary = job.name
    ? `${job.name}${job.customerName ? ' — ' + job.customerName : ''}`
    : 'Job';

  const descriptionLines = [
    job.description,
    job.customerEmail ? `Email: ${job.customerEmail}` : null,
    job.customerPhone ? `Phone: ${job.customerPhone}` : null,
  ].filter((l): l is string => !!l && l.trim().length > 0);

  const body: Record<string, unknown> = {
    summary,
    description: descriptionLines.join('\n') || undefined,
    location: job.jobAddress || undefined,
  };

  if (isAllDay) {
    // Half-open in GCal: end is exclusive. A single-day event uses end
    // = start + 1 day; multi-day jobs use scheduledEndDate (also
    // half-open from the caller's perspective).
    body.start = { date: ymd(start) };
    body.end = { date: ymd(end + (explicitEnd ? 0 : 24 * 60 * 60 * 1000)) };
  } else {
    body.start = { dateTime: new Date(start).toISOString() };
    body.end = { dateTime: new Date(end).toISOString() };
  }
  return body;
}

function ymd(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

async function createEvent(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await fetch(CALENDAR_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`createEvent ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return (await res.json()) as { id: string };
}

async function patchEvent(
  accessToken: string,
  eventId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${CALENDAR_API}/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  // 404 = the event was deleted in GCal; recreate next time by clearing
  // the stored id. Don't throw.
  if (res.status === 404) {
    throw new Error('event_missing');
  }
  if (!res.ok) {
    throw new Error(`patchEvent ${res.status}: ${await res.text().catch(() => '')}`);
  }
}

async function safeDeleteEvent(userId: string, eventId: string): Promise<void> {
  const tokenSnap = await mintAccessTokenForUser(userId);
  if (!tokenSnap) return;
  try {
    await fetch(`${CALENDAR_API}/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenSnap.accessToken}` },
    });
  } catch (err) {
    functions.logger.warn('[gcal] delete failed', {
      userId,
      eventId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function stampError(
  userId: string,
  jobId: string,
  message: string,
  current?: { at?: number; message?: string },
): Promise<void> {
  const stamp = { at: Date.now(), message };
  await Promise.all([
    // Writing the job doc re-fires onJobWriteSyncCal, so skip it when the
    // same error is already stamped — otherwise repeated failures churn
    // writes for no user-visible gain.
    current?.message === message
      ? Promise.resolve()
      : db()
          .doc(`users/${userId}/jobs/${jobId}`)
          .set({ googleCalendarSyncError: stamp }, { merge: true })
          .catch(() => undefined),
    calendarIntegrationRef(userId)
      .set({ lastSyncError: stamp }, { merge: true })
      .catch(() => undefined),
  ]);
}
