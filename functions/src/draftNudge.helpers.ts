/**
 * Pure, dependency-free logic for the "ready to send" draft nudge — a quote
 * that has been fully built in the wizard (customer + materials, sitting on the
 * preview screen) but never sent. The `draftNudge` scheduled function in
 * index.ts is a thin fetch-then-decide wrapper around these predicates so the
 * decision rules stay unit testable without Firestore.
 *
 * Kept separate from the generic "aging draft" tier logic that already lives in
 * draftNudge: this fires once per quote (recorded as `readyToSendNudgedAt`) and
 * only for quotes that are actually finished, not mid-wizard drafts.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// A finished-but-unsent quote gets a day to be sent by hand before we nudge,
// and we stop nagging after ~a month so the first run doesn't blast historical
// dead drafts and we don't pester about quotes that are never going out.
export const READY_TO_SEND_MIN_AGE_MS = 24 * HOUR_MS;
export const READY_TO_SEND_MAX_AGE_MS = 30 * DAY_MS;

/** The subset of a quote doc these predicates read. */
export interface NudgeQuote {
  status?: string | null;
  customerName?: string | null;
  materials?: unknown[] | null;
  /**
   * The wizard stamps the next screen to resume on per step; the JobPreview
   * mount clears it back to null/undefined once the user reaches the preview.
   * A finished quote therefore sits at null (cleared) or, if the preview hasn't
   * mounted yet / on older data, at 'JobPreview' ('QuotePreview' is the legacy
   * name for the same screen).
   */
  draftStep?: string | null;
  readyToSendNudgedAt?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
}

/**
 * Normalise a timestamp field to epoch ms. Quote timestamps may be epoch-ms
 * numbers, Firestore Timestamps (live or serialized), or ISO strings depending
 * on how the doc was written — parse defensively and return null if unusable.
 */
export function toMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === 'object') {
    const v = value as any;
    if (typeof v.toMillis === 'function') {
      const ms = v.toMillis();
      return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
    }
    if (typeof v.toDate === 'function') {
      const d = v.toDate();
      const ms = d instanceof Date ? d.getTime() : NaN;
      return Number.isNaN(ms) ? null : ms;
    }
    // Plain serialized Timestamp: { seconds, nanoseconds } or the admin SDK's
    // { _seconds, _nanoseconds } shape.
    const seconds = v.seconds ?? v._seconds;
    if (typeof seconds === 'number') {
      const nanos = v.nanoseconds ?? v._nanoseconds ?? 0;
      return seconds * 1000 + Math.floor(nanos / 1e6);
    }
  }
  return null;
}

/**
 * True when a draft is fully built and parked on the preview screen: it's a
 * draft, has a customer and at least one material line, and the wizard step is
 * cleared (or on the preview screen). Mid-wizard drafts return false.
 */
export function isReadyToSend(q: NudgeQuote | null | undefined): boolean {
  if (!q || q.status !== 'draft') return false;
  if (typeof q.customerName !== 'string' || !q.customerName.trim()) return false;
  if (!Array.isArray(q.materials) || q.materials.length === 0) return false;
  const step = q.draftStep;
  return step == null || step === 'JobPreview' || step === 'QuotePreview';
}

/**
 * True when a ready-to-send draft should be nudged now: it's ready, hasn't been
 * nudged before, and its age (from updatedAt, falling back to createdAt) is
 * within the [24h, 30d] window.
 */
export function shouldReadyToSendNudge(q: NudgeQuote | null | undefined, nowMs: number): boolean {
  if (!isReadyToSend(q)) return false;
  if (q!.readyToSendNudgedAt) return false;
  const ts = toMs(q!.updatedAt ?? q!.createdAt);
  if (ts == null) return false;
  const age = nowMs - ts;
  return age >= READY_TO_SEND_MIN_AGE_MS && age <= READY_TO_SEND_MAX_AGE_MS;
}
