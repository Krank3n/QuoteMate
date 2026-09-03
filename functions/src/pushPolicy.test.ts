import { describe, expect, it } from 'vitest';
import {
  ANDROID_CHANNEL,
  DEFAULT_TIMEZONE,
  NUDGE_DAILY_CAP,
  PUSH_CLASS,
  decidePush,
  localDayKey,
  localHourIn,
  normaliseTimezone,
  summariseOverdue,
} from './pushPolicy';

/** 18 Aug 2026, 07:30 Sydney (AEST, UTC+10) — the old daily-motivation slot. */
const SYDNEY_0730 = Date.UTC(2026, 7, 17, 21, 30);
/** 18 Aug 2026, 10:00 Sydney. */
const SYDNEY_1000 = Date.UTC(2026, 7, 18, 0, 0);
/** 18 Aug 2026, 22:00 Sydney. */
const SYDNEY_2200 = Date.UTC(2026, 7, 18, 12, 0);

describe('local time resolution', () => {
  it('reads the hour in the device timezone, not the server one', () => {
    expect(localHourIn('Australia/Sydney', SYDNEY_0730)).toBe(7);
    // The bug this exists to prevent: a Sydney-morning job on a Perth phone.
    expect(localHourIn('Australia/Perth', SYDNEY_0730)).toBe(5);
    expect(localHourIn('Australia/Brisbane', SYDNEY_0730)).toBe(7);
    expect(localHourIn('Australia/Adelaide', SYDNEY_0730)).toBe(7);
  });

  it('returns null for a timezone Intl does not know', () => {
    expect(localHourIn('Mars/Olympus', SYDNEY_0730)).toBeNull();
  });

  it('falls back to Sydney for missing or invalid zones', () => {
    expect(normaliseTimezone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(normaliseTimezone('')).toBe(DEFAULT_TIMEZONE);
    expect(normaliseTimezone(42)).toBe(DEFAULT_TIMEZONE);
    expect(normaliseTimezone('Not/AZone')).toBe(DEFAULT_TIMEZONE);
    expect(normaliseTimezone('Australia/Perth')).toBe('Australia/Perth');
  });

  it('keys the daily cap on the local calendar day', () => {
    // 22:00 Sydney is still the 18th there but already the 18th in Perth too;
    // at 00:30 Sydney on the 19th, Perth is still on the 18th.
    const sydneyJustAfterMidnight = Date.UTC(2026, 7, 18, 14, 30);
    expect(localDayKey('Australia/Sydney', sydneyJustAfterMidnight)).toBe('2026-08-19');
    expect(localDayKey('Australia/Perth', sydneyJustAfterMidnight)).toBe('2026-08-18');
  });
});

describe('event-class pushes', () => {
  it('classifies customer and money events as event-class', () => {
    expect(PUSH_CLASS.quote_accepted).toBe('event');
    expect(PUSH_CLASS.invoice_paid).toBe('event');
    expect(PUSH_CLASS.quote_viewed).toBe('event');
    expect(PUSH_CLASS.draft_nudge).toBe('nudge');
    expect(PUSH_CLASS.invoice_overdue).toBe('nudge');
  });

  it('never holds a pricing-run push — the tradie locked the phone waiting for it', () => {
    expect(PUSH_CLASS.quote_priced).toBe('event');
    expect(PUSH_CLASS.quote_pricing_snag).toBe('event');
    const lateNight = decidePush({
      event: 'quote_priced',
      prefs: {},
      timezone: 'Australia/Perth',
      nowMs: Date.UTC(2026, 7, 18, 15, 0), // 23:00 Perth
      nudgesSentToday: 5,
    });
    expect(lateNight.send).toBe(true);
    expect(lateNight.channelId).toBe('quote-ready');
  });

  it('delivers at any hour — money landing at 10pm is still worth knowing', () => {
    const decision = decidePush({
      event: 'invoice_paid',
      timezone: 'Australia/Sydney',
      nowMs: SYDNEY_2200,
    });
    expect(decision.send).toBe(true);
    expect(decision.reason).toBe('ok');
  });

  it('is never blocked by the nudge daily cap', () => {
    const decision = decidePush({
      event: 'quote_accepted',
      timezone: 'Australia/Sydney',
      nowMs: SYDNEY_1000,
      nudgesSentToday: 99,
    });
    expect(decision.send).toBe(true);
  });

  it('still respects an explicit opt-out', () => {
    const decision = decidePush({
      event: 'quote_accepted',
      prefs: { quoteUpdates: false },
      nowMs: SYDNEY_1000,
    });
    expect(decision.send).toBe(false);
    expect(decision.reason).toBe('opted_out');
  });

  it('treats a missing preference key as opted in', () => {
    const decision = decidePush({
      event: 'invoice_paid',
      prefs: {},
      nowMs: SYDNEY_1000,
    });
    expect(decision.send).toBe(true);
  });

  it('routes money events to their own Android channel', () => {
    expect(ANDROID_CHANNEL.invoice_paid).toBe('money');
    expect(ANDROID_CHANNEL.quote_accepted).toBe('money');
    expect(ANDROID_CHANNEL.draft_nudge).toBe('reminders');
    // Reminders must not share the money channel, or muting one mutes both.
    expect(ANDROID_CHANNEL.invoice_overdue).not.toBe(ANDROID_CHANNEL.invoice_paid);
    // A pricing-run push is one the tradie asked for; muting reminders must not mute it.
    expect(ANDROID_CHANNEL.quote_priced).toBe('quote-ready');
    expect(ANDROID_CHANNEL.quote_priced).not.toBe(ANDROID_CHANNEL.draft_nudge);
  });
});

describe('nudge-class pushes', () => {
  it('holds a Sydney-morning nudge until the Perth tradie is actually awake', () => {
    const sydney = decidePush({
      event: 'draft_nudge',
      timezone: 'Australia/Sydney',
      nowMs: Date.UTC(2026, 7, 17, 23, 0), // 09:00 Sydney
    });
    expect(sydney.send).toBe(true);

    const perth = decidePush({
      event: 'draft_nudge',
      timezone: 'Australia/Perth',
      nowMs: Date.UTC(2026, 7, 17, 23, 0), // 07:00 Perth — still too early
    });
    expect(perth.send).toBe(false);
    expect(perth.reason).toBe('quiet_hours');
  });

  it('suppresses nudges late at night', () => {
    const decision = decidePush({
      event: 'invoice_overdue',
      timezone: 'Australia/Sydney',
      nowMs: SYDNEY_2200,
    });
    expect(decision.send).toBe(false);
    expect(decision.reason).toBe('quiet_hours');
  });

  it('allows the first nudge of the day and blocks the next', () => {
    const first = decidePush({
      event: 'draft_nudge',
      timezone: 'Australia/Sydney',
      nowMs: SYDNEY_1000,
      nudgesSentToday: 0,
    });
    expect(first.send).toBe(true);

    const second = decidePush({
      event: 'invoice_overdue',
      timezone: 'Australia/Sydney',
      nowMs: SYDNEY_1000,
      nudgesSentToday: NUDGE_DAILY_CAP,
    });
    expect(second.send).toBe(false);
    expect(second.reason).toBe('daily_cap');
  });

  it('caps across nudge types, not per type', () => {
    // A draft nudge already went out today, so an overdue nudge must wait —
    // otherwise the 9am/11am schedulers stack up on the same morning.
    const decision = decidePush({
      event: 'invoice_overdue',
      timezone: 'Australia/Sydney',
      nowMs: SYDNEY_1000,
      nudgesSentToday: 1,
    });
    expect(decision.reason).toBe('daily_cap');
  });

  it('reports the local day key so the caller counts against the right day', () => {
    const decision = decidePush({
      event: 'draft_nudge',
      timezone: 'Australia/Perth',
      nowMs: SYDNEY_1000, // 08:00 Perth
    });
    expect(decision.send).toBe(true);
    expect(decision.localDayKey).toBe('2026-08-18');
    expect(decision.timezone).toBe('Australia/Perth');
  });

  it('falls back to Sydney hours when the device reported a junk timezone', () => {
    const decision = decidePush({
      event: 'draft_nudge',
      timezone: 'Not/AZone',
      nowMs: SYDNEY_1000,
    });
    expect(decision.send).toBe(true);
    expect(decision.timezone).toBe(DEFAULT_TIMEZONE);
  });
});

describe('scheduler slots clear quiet hours across Australia', () => {
  // A nudge scheduler runs once a day at a fixed Sydney time. If that instant
  // falls inside a user's quiet hours, that user is starved permanently, not
  // merely delayed — so every slot has to clear 8am in the westernmost zone.
  const SLOTS: Array<[string, number, number]> = [
    ['onQuoteExpiring', 11, 0],
    ['onInvoiceOverdue', 11, 30],
    ['draftNudge', 12, 0],
    ['milestoneChecker', 12, 30],
    ['inactivityNudge', 13, 0],
  ];

  const AU_ZONES = [
    'Australia/Perth',     // UTC+8, no DST — the binding constraint
    'Australia/Darwin',    // UTC+9:30
    'Australia/Brisbane',  // UTC+10, no DST
    'Australia/Adelaide',  // UTC+9:30 / +10:30
    'Australia/Sydney',    // UTC+10 / +11
    'Pacific/Auckland',    // NZ expansion
  ];

  // Both halves of the year: AEDT widens the Sydney↔Perth gap to three hours.
  const SAMPLE_DATES: Array<[number, number]> = [[7, 18], [0, 18]]; // Aug, Jan

  for (const [name, hour, minute] of SLOTS) {
    it(`${name} lands inside every Australian tradie's day`, () => {
      for (const [month, day] of SAMPLE_DATES) {
        // Build the UTC instant corresponding to that Sydney wall-clock time.
        const guessUtc = Date.UTC(2026, month, day, hour - 11, minute);
        const sydneyHour = localHourIn('Australia/Sydney', guessUtc)!;
        const correctedUtc = guessUtc + (hour - sydneyHour) * 3600_000;

        for (const zone of AU_ZONES) {
          const decision = decidePush({
            event: 'draft_nudge',
            timezone: zone,
            nowMs: correctedUtc,
            nudgesSentToday: 0,
          });
          expect(
            decision.send,
            `${name} at ${hour}:${String(minute).padStart(2, '0')} Sydney → ` +
            `${localHourIn(zone, correctedUtc)}:00 in ${zone} (month ${month})`
          ).toBe(true);
        }
      }
    });
  }
});

describe('overdue invoice summarising', () => {
  it('returns null when nothing is overdue', () => {
    expect(summariseOverdue([])).toBeNull();
  });

  it('names the single customer directly', () => {
    const summary = summariseOverdue([{ customerName: 'Dave', balance: 1200 }]);
    expect(summary).toEqual({ count: 1, customer: 'Dave', amount: '$1,200' });
  });

  it('collapses many invoices into one line instead of one push each', () => {
    const summary = summariseOverdue([
      { customerName: 'Dave', balance: 1200 },
      { customerName: 'Sam', balance: 800 },
      { customerName: 'Kim', balance: 500 },
    ]);
    expect(summary?.count).toBe(3);
    expect(summary?.customer).toBe('Dave +2 more');
    expect(summary?.amount).toBe('$2,500');
  });

  it('omits the dollar figure when no balance is known', () => {
    const summary = summariseOverdue([{ customerName: 'Dave' }]);
    expect(summary?.amount).toBe('');
  });
});
