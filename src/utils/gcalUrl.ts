/**
 * Build a Google Calendar pre-filled "render" URL for a Job.
 *
 * This is the zero-backend escape hatch: tapping the link opens
 * calendar.google.com with the event template pre-populated from job
 * fields. The tradie tweaks whatever they want and hits save in GCal.
 *
 * Full OAuth-based sync (Phase 14) remains a later tranche — when it
 * lands, event creation moves server-side and this helper becomes a
 * fallback for users who haven't connected a Google account.
 */

import type { Job } from '../../shared/job/types';

const GCAL_RENDER = 'https://calendar.google.com/calendar/render';

/** YYYYMMDDTHHmmSS Z-less — GCal's template format. */
function gcalInstant(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getUTCFullYear()}` +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

/**
 * Build dates=YYYYMMDDTHHmmSSZ/YYYYMMDDTHHmmSSZ.
 *
 *  - Timed: `scheduledStartDate` carries hours → duration defaults to 2h.
 *  - All-day: date-only → dates=YYYYMMDD/YYYYMMDD (GCal quirk — all-day end
 *    is exclusive, so it's the same day twice for a single-day event).
 */
function gcalDates(job: Job): string | null {
  const start = job.scheduledStartDate;
  if (!start) return null;

  const startD = new Date(start);
  const isAllDay = startD.getHours() === 0 && startD.getMinutes() === 0;

  if (isAllDay) {
    const y = startD.getFullYear();
    const m = (startD.getMonth() + 1).toString().padStart(2, '0');
    const d = startD.getDate().toString().padStart(2, '0');
    // GCal all-day events are half-open: [start, end). Single day = same
    // date on both sides.
    return `${y}${m}${d}/${y}${m}${d}`;
  }

  const endMs =
    job.scheduledEndDate && job.scheduledEndDate > start
      ? job.scheduledEndDate
      : start + 2 * 60 * 60 * 1000; // default to 2h window

  return `${gcalInstant(start)}/${gcalInstant(endMs)}`;
}

function joinDetails(lines: Array<string | undefined | null>): string {
  return lines.filter((l): l is string => !!l && l.trim().length > 0).join('\n');
}

export function buildGoogleCalendarUrl(job: Job): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set(
    'text',
    job.name ? `${job.name} — ${job.customerName || ''}`.trim().replace(/—\s*$/, '').trim() : 'Job',
  );

  const details = joinDetails([
    job.description,
    job.customerEmail ? `Email: ${job.customerEmail}` : undefined,
    job.customerPhone ? `Phone: ${job.customerPhone}` : undefined,
  ]);
  if (details) params.set('details', details);

  if (job.jobAddress) params.set('location', job.jobAddress);

  const dates = gcalDates(job);
  if (dates) params.set('dates', dates);

  return `${GCAL_RENDER}?${params.toString()}`;
}
