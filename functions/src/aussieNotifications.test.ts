import { describe, expect, it } from 'vitest';
import { getAussieMessage, AussieEvent } from './aussieNotifications';

const ALL_EVENTS: AussieEvent[] = [
  'quote_accepted',
  'quote_rejected',
  'quote_viewed',
  'quote_expiring',
  'invoice_paid',
  'invoice_overdue',
  'milestone',
  'inactivity',
  'draft_nudge',
  'quote_priced',
  'quote_pricing_snag',
];

/** Run a message many times so a random variant choice can't hide a bad one. */
function everyVariant(event: AussieEvent, vars: Record<string, string>) {
  return Array.from({ length: 60 }, () => getAussieMessage(event, vars));
}

describe('notification copy', () => {
  it('has no daily motivation event left', () => {
    expect(ALL_EVENTS).not.toContain('daily_motivation' as AussieEvent);
    // The pool is typed by AussieEvent, so a stale key would fail to compile;
    // this asserts the runtime pool too.
    expect(() => getAussieMessage('daily_motivation' as AussieEvent)).toThrow();
  });

  it('never leaves an unfilled placeholder in the delivered text', () => {
    for (const event of ALL_EVENTS) {
      for (const msg of everyVariant(event, {})) {
        expect(msg.title, `${event} title`).not.toMatch(/[{}]/);
        expect(msg.body, `${event} body`).not.toMatch(/[{}]/);
        expect(msg.body.length, `${event} body empty`).toBeGreaterThan(0);
      }
    }
  });

  it('carries the money figure when one is supplied', () => {
    const messages = everyVariant('invoice_paid', {
      customer: 'Dave',
      job: 'Deck rebuild',
      amount: '$4,200',
    });
    // Every variant must state the amount — the old copy said "just paid up"
    // and forced the tradie to open the app to find out how much.
    for (const msg of messages) {
      expect(msg.body).toContain('$4,200');
      expect(msg.body).toContain('Dave');
    }
  });

  it('picks wording that does not need an amount when none is available', () => {
    const messages = everyVariant('invoice_paid', { customer: 'Dave' });
    for (const msg of messages) {
      expect(msg.body).toContain('Dave');
      expect(msg.body).not.toMatch(/\$/);
      // No dangling connective left behind by the stripped placeholder.
      expect(msg.body).not.toMatch(/\s{2,}/);
      expect(msg.body).not.toMatch(/\s[.,!?]/);
    }
  });

  it('names the customer and job on an accepted quote', () => {
    for (const msg of everyVariant('quote_accepted', {
      customer: 'Dave', job: 'Deck rebuild', amount: '$4,200',
    })) {
      expect(msg.body).toContain('Dave');
      expect(msg.body).toContain('$4,200');
    }
  });

  it('interpolates the milestone count', () => {
    for (const msg of everyVariant('milestone', { n: '50' })) {
      expect(msg.body).toContain('50');
    }
  });

  it('reports how long an expiring quote has left', () => {
    for (const msg of everyVariant('quote_expiring', {
      customer: 'Dave', job: 'Deck', days: '6 hours', amount: '$900',
    })) {
      expect(msg.body).toMatch(/6 hours/);
    }
  });

  it('keeps titles short enough for a lock screen', () => {
    for (const event of ALL_EVENTS) {
      for (const msg of everyVariant(event, { customer: 'Dave', job: 'Deck', n: '50', amount: '$900', days: '2 days' })) {
        expect(msg.title.length, `${event}: ${msg.title}`).toBeLessThanOrEqual(40);
      }
    }
  });

  it('uses gender-neutral address throughout', () => {
    const banned = /\b(blokes?|guys|folks|fellas?|missus)\b/i;
    for (const event of ALL_EVENTS) {
      for (const msg of everyVariant(event, { customer: 'Dave', job: 'Deck', n: '50', amount: '$900', days: '2 days' })) {
        expect(`${msg.title} ${msg.body}`, event).not.toMatch(banned);
      }
    }
  });

  it('ignores empty-string vars rather than printing a gap', () => {
    for (const msg of everyVariant('quote_viewed', { customer: 'Dave', job: 'Deck', amount: '' })) {
      expect(msg.body).not.toMatch(/\s{2,}/);
      expect(msg.body).toContain('Dave');
    }
  });
});

describe('pricing-run pushes', () => {
  it('names the job on every variant, with or without a count', () => {
    for (const msg of everyVariant('quote_priced', { job: 'Deck rebuild' })) {
      expect(msg.body).toContain('Deck rebuild');
      expect(msg.body).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
    }
    for (const msg of everyVariant('quote_priced', { job: 'Deck rebuild', count: '14 items' })) {
      expect(msg.body).toContain('Deck rebuild');
    }
  });

  it('tells the tradie how to recover from a snag', () => {
    for (const msg of everyVariant('quote_pricing_snag', { job: 'Deck rebuild' })) {
      expect(msg.body).toContain('Deck rebuild');
      expect(msg.body).toMatch(/Fetch Prices/);
    }
  });
});
