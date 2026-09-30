import { describe, it, expect } from 'vitest';
import { decideQuoteOpenedEmail, quoteOpenedEmailCopy } from './quoteOpenedEmail.helpers';

const base = { quoteUpdatesOff: false, hasPushToken: false, alreadyEmailed: false, tradieEmail: 'sparky@gmail.com' };

describe('decideQuoteOpenedEmail', () => {
  it('emails a tradie that no push can reach', () => {
    expect(decideQuoteOpenedEmail(base)).toEqual({ send: true });
  });
  it('leaves it to push when the tradie has a token, even if that push is held for quiet hours', () => {
    expect(decideQuoteOpenedEmail({ ...base, hasPushToken: true })).toEqual({ send: false, reason: 'has-push' });
  });
  it('respects quote updates being switched off', () => {
    expect(decideQuoteOpenedEmail({ ...base, quoteUpdatesOff: true })).toEqual({ send: false, reason: 'prefs-off' });
  });
  it('sends once per quote', () => {
    expect(decideQuoteOpenedEmail({ ...base, alreadyEmailed: true })).toEqual({ send: false, reason: 'already-emailed' });
  });
  it('skips addresses that cannot receive mail', () => {
    expect(decideQuoteOpenedEmail({ ...base, tradieEmail: null })).toEqual({ send: false, reason: 'unreachable' });
    expect(decideQuoteOpenedEmail({ ...base, tradieEmail: 'tradie@example.com' })).toEqual({ send: false, reason: 'unreachable' });
  });
});

describe('quoteOpenedEmailCopy', () => {
  it('names the customer, the amount and the job', () => {
    const c = quoteOpenedEmailCopy({ customerName: 'Nigel', jobName: 'Kitchen rewire', amount: '$1,250.00' });
    expect(c.subject).toBe('Nigel just opened your quote');
    expect(c.intro).toBe('Nigel just opened your $1,250.00 quote for Kitchen rewire.');
  });
  it('reads naturally with nothing but the open', () => {
    const c = quoteOpenedEmailCopy({});
    expect(c.subject).toBe('Your customer just opened your quote');
    expect(c.intro).toBe('Your customer just opened your quote.');
  });
  it('never says "AI" and assumes nobody\'s gender', () => {
    const text = Object.values(quoteOpenedEmailCopy({ customerName: 'Sam', jobName: 'Deck', amount: '$900.00' })).join(' ');
    expect(text).not.toMatch(/\bAI\b/);
    expect(text).not.toMatch(/\b(he|she|his|her|guys|blokes|mate)\b/i);
  });
});
