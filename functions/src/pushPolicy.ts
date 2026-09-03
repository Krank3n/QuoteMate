/**
 * Delivery policy for push notifications.
 *
 * The rule this encodes: a push is worth interrupting someone for when it
 * carries news about their customer or their money. Everything else is us
 * deciding to prod them, and that class earns a quiet-hours window and a hard
 * daily cap so it can never train a tradie to mute the channel that later says
 * "you've been paid".
 *
 * Kept free of firebase-admin so the rules can be unit-tested directly.
 */

import type { AussieEvent } from './aussieNotifications';

/**
 * event  — the customer did something, or money moved. Always delivered.
 * nudge  — we decided to prod them. Quiet hours + daily cap apply.
 */
export type PushClass = 'event' | 'nudge';

export const PUSH_CLASS: Record<AussieEvent, PushClass> = {
  quote_accepted: 'event',
  quote_rejected: 'event',
  quote_viewed: 'event',
  invoice_paid: 'event',
  quote_expiring: 'nudge',
  invoice_overdue: 'nudge',
  milestone: 'nudge',
  inactivity: 'nudge',
  draft_nudge: 'nudge',
  // The tradie asked for these by locking the phone mid-run; never hold them.
  quote_priced: 'event',
  quote_pricing_snag: 'event',
};

/**
 * Android notification channels. Splitting these lets a tradie silence the
 * reminders in the OS without also silencing "you got paid" — with one shared
 * channel their only option was to mute everything.
 */
export const ANDROID_CHANNEL: Record<AussieEvent, string> = {
  quote_accepted: 'money',
  invoice_paid: 'money',
  quote_rejected: 'quote-responses',
  quote_viewed: 'quote-responses',
  quote_expiring: 'reminders',
  invoice_overdue: 'reminders',
  milestone: 'reminders',
  inactivity: 'reminders',
  draft_nudge: 'reminders',
  quote_priced: 'quote-ready',
  quote_pricing_snag: 'quote-ready',
};

/** Which notificationPreferences toggle governs each event. */
export const PREF_KEY: Record<AussieEvent, string> = {
  quote_accepted: 'quoteUpdates',
  quote_rejected: 'quoteUpdates',
  quote_viewed: 'quoteUpdates',
  quote_expiring: 'quoteUpdates',
  invoice_paid: 'invoiceUpdates',
  invoice_overdue: 'invoiceUpdates',
  milestone: 'milestoneCelebrations',
  inactivity: 'inactivityNudges',
  draft_nudge: 'inactivityNudges',
  quote_priced: 'quoteUpdates',
  quote_pricing_snag: 'quoteUpdates',
};

/** Nudge-class pushes allowed per user per local day, across all nudge types. */
export const NUDGE_DAILY_CAP = 1;

/** Nudges are only delivered between these local hours (24h clock). */
export const NUDGE_EARLIEST_HOUR = 8;
export const NUDGE_LATEST_HOUR = 19;

/**
 * Every schedule in this codebase runs on Australia/Sydney. A tradie in Perth
 * is two hours behind that (three over summer), so a Sydney-morning job lands
 * on them before dawn. Used when a device hasn't reported its own zone.
 */
export const DEFAULT_TIMEZONE = 'Australia/Sydney';

function partsIn(timezone: string, nowMs: number): Record<string, string> | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-AU', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const parts: Record<string, string> = {};
    for (const part of formatter.formatToParts(new Date(nowMs))) {
      parts[part.type] = part.value;
    }
    return parts;
  } catch {
    // Unknown/garbage IANA zone — the caller falls back to the default.
    return null;
  }
}

/** Hour of day (0-23) at `nowMs` in `timezone`, or null if the zone is invalid. */
export function localHourIn(timezone: string, nowMs: number): number | null {
  const parts = partsIn(timezone, nowMs);
  if (!parts?.hour) return null;
  const hour = Number(parts.hour);
  return Number.isFinite(hour) ? hour : null;
}

/**
 * Calendar day at `nowMs` in `timezone` as YYYY-MM-DD. The daily cap counts
 * against the tradie's own day, not a UTC or Sydney one.
 */
export function localDayKey(timezone: string, nowMs: number): string {
  const parts = partsIn(timezone, nowMs) || partsIn(DEFAULT_TIMEZONE, nowMs);
  if (!parts) return 'unknown';
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Resolve a stored timezone to one Intl actually accepts. */
export function normaliseTimezone(timezone: unknown): string {
  if (typeof timezone !== 'string' || !timezone.trim()) return DEFAULT_TIMEZONE;
  return partsIn(timezone, 0) ? timezone : DEFAULT_TIMEZONE;
}

export interface PushDecisionInput {
  event: AussieEvent;
  /** Raw notificationPreferences doc; missing keys mean "not opted out". */
  prefs?: Record<string, unknown> | null;
  /** IANA zone reported by the device, if any. */
  timezone?: unknown;
  nowMs: number;
  /** Nudge-class pushes already delivered to this user on their local day. */
  nudgesSentToday?: number;
}

export interface PushDecision {
  send: boolean;
  /** Machine-readable suppression reason, for logging. */
  reason: 'ok' | 'opted_out' | 'quiet_hours' | 'daily_cap';
  pushClass: PushClass;
  channelId: string;
  timezone: string;
  localDayKey: string;
}

/**
 * Decide whether a single push should go out. Event-class always passes the
 * preference check only; nudge-class additionally has to clear quiet hours and
 * the daily cap.
 */
export function decidePush(input: PushDecisionInput): PushDecision {
  const { event, prefs, nowMs, nudgesSentToday = 0 } = input;
  const timezone = normaliseTimezone(input.timezone);
  const pushClass = PUSH_CLASS[event];
  const base = {
    pushClass,
    channelId: ANDROID_CHANNEL[event],
    timezone,
    localDayKey: localDayKey(timezone, nowMs),
  };

  const prefKey = PREF_KEY[event];
  if (prefs && prefKey && prefs[prefKey] === false) {
    return { ...base, send: false, reason: 'opted_out' };
  }

  if (pushClass === 'event') {
    return { ...base, send: true, reason: 'ok' };
  }

  const hour = localHourIn(timezone, nowMs) ?? localHourIn(DEFAULT_TIMEZONE, nowMs);
  if (hour === null || hour < NUDGE_EARLIEST_HOUR || hour >= NUDGE_LATEST_HOUR) {
    return { ...base, send: false, reason: 'quiet_hours' };
  }

  if (nudgesSentToday >= NUDGE_DAILY_CAP) {
    return { ...base, send: false, reason: 'daily_cap' };
  }

  return { ...base, send: true, reason: 'ok' };
}

/**
 * Collapse a set of overdue invoices into one line. Sending one push per
 * invoice meant a tradie with six overdue invoices got six buzzes in a row.
 */
export function summariseOverdue(
  invoices: Array<{ customerName?: string; balance?: number }>
): { count: number; customer: string; amount: string } | null {
  if (invoices.length === 0) return null;
  const total = invoices.reduce((sum, i) => sum + (Number(i.balance) || 0), 0);
  const first = invoices[0]?.customerName || 'a customer';
  return {
    count: invoices.length,
    customer: invoices.length === 1 ? first : `${first} +${invoices.length - 1} more`,
    amount: total > 0 ? `$${Math.round(total).toLocaleString('en-AU')}` : '',
  };
}
