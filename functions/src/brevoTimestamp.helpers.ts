/**
 * When did a Brevo webhook event happen, in epoch ms?
 *
 * Brevo's payload carries the instant several ways: `ts_epoch` (ms),
 * `ts_event` / `ts` (seconds), and `date` — a "YYYY-MM-DD HH:MM:SS" string
 * in the ACCOUNT's timezone with no offset. The webhook used to read `date`
 * first and Date.parse treated it as UTC, so every stored event time
 * (deliveredAt, openedAt, …) sat 10 hours in the future for an AEST
 * account, and the customer-open stamp inherited the error — which also
 * tripped the one-per-minute write throttle's "future stamp" guard for the
 * next real open. Epoch fields first; `date` only as a last resort, and
 * never a time in the future.
 */
export function brevoEventMs(body: any, nowMs: number = Date.now()): number | null {
  const candidates: unknown[] = [body?.ts_epoch, body?.ts_event, body?.ts];
  for (const raw of candidates) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      // ms if it already looks like ms, else seconds.
      const ms = raw > 1e12 ? raw : raw * 1000;
      return Math.min(ms, nowMs);
    }
  }
  const date = body?.date;
  if (typeof date === 'string') {
    const t = Date.parse(date);
    if (!Number.isNaN(t)) return Math.min(t, nowMs);
  }
  return null;
}
