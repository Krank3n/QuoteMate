/**
 * Shared timestamp handling for anything that reads a date off a Firestore doc.
 *
 * Firestore hands the same logical field back in several different shapes
 * depending on how it was written and how it travelled (Admin SDK Timestamp,
 * a JSON-round-tripped {_seconds, _nanoseconds}, a {seconds, nanoseconds}
 * literal, an ISO string, or plain epoch millis). `new Date(value)` only
 * understands two of those; handed a Timestamp object it returns
 * `Invalid Date` without throwing, which is how "Invalid Date" reached the
 * date line of customer-facing quote and invoice PDFs for ~8% of quotes.
 */

/**
 * Normalise any Firestore-shaped timestamp value into a JS Date.
 * Handles: Firestore Timestamp, {_seconds, _nanoseconds}, {seconds, nanoseconds},
 * ISO string, number, Date, null/undefined. Returns null for missing/invalid
 * input — expiry callers MUST treat that as "no expiry anchor available" and
 * handle accordingly rather than falling into `new Date(null)` (which is 1970
 * and would make every link appear expired).
 */
export function normaliseTimestamp(value: any): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    try {
      const d = value.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    } catch { /* fall through */ }
  }
  if (typeof value === 'object') {
    const seconds = typeof value.seconds === 'number' ? value.seconds
                  : typeof value._seconds === 'number' ? value._seconds
                  : null;
    const nanos = typeof value.nanoseconds === 'number' ? value.nanoseconds
                : typeof value._nanoseconds === 'number' ? value._nanoseconds
                : 0;
    if (seconds !== null) return new Date(seconds * 1000 + nanos / 1e6);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Australian long-date for a document, e.g. "22 July 2026".
 *
 * Accepts `any` on purpose: every caller is reading a Firestore field, so the
 * static type is a guess and the Timestamp shape is exactly what used to
 * break. A missing or unparseable value falls back to today, preserving the
 * long-standing `value || Date.now()` behaviour of the callers this replaced —
 * printing today's date is wrong, but it is the pre-existing contract and
 * quietly changing it would alter documents this fix isn't about.
 */
export function formatAuDate(value: any): string {
  const d = normaliseTimestamp(value) ?? new Date();
  return d.toLocaleDateString('en-AU', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}
