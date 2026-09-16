import { describe, expect, it } from 'vitest';
import { squareNotReadyCopy, squareConnectionStatusLine } from './squareReadinessCopy';

describe('squareNotReadyCopy', () => {
  it('an unactivated account names the merchant and says what happens to sends', () => {
    const copy = squareNotReadyCopy({ reasons: ['no_card_processing'] }, 'Slimjims');
    expect(copy.title).toBe('Square hasn’t switched on card payments yet');
    expect(copy.body).toContain('Slimjims can\'t take card payments');
    expect(copy.body).toContain('without a Pay Now button');
    expect(copy.action).toContain('squareup.com');
  });

  it('an inactive merchant or location reads the same way as unactivated', () => {
    for (const reason of ['merchant_inactive', 'location_inactive'] as const) {
      expect(squareNotReadyCopy({ reasons: [reason] }, 'X').title).toContain('switched on card payments');
    }
  });

  it('a non-AUD account asks for an Australian one and shows the currency', () => {
    const copy = squareNotReadyCopy({ reasons: ['currency_mismatch'], currency: 'USD' }, 'Bob Builds');
    expect(copy.title).toBe('This Square account is not Australian');
    expect(copy.body).toContain('Bob Builds isn\'t set up for Australian dollars (USD)');
    expect(copy.action).toBe('Connect an Australian Square account');
  });

  it('currency wins when both reasons are present: no activation will fix the country', () => {
    const copy = squareNotReadyCopy({ reasons: ['no_card_processing', 'currency_mismatch'], currency: 'NZD' }, null);
    expect(copy.title).toBe('This Square account is not Australian');
    expect(copy.body).toContain('this Square account isn\'t set up');
  });

  it('never says "AI" and never blames the tradie', () => {
    for (const reasons of [['no_card_processing'], ['currency_mismatch']] as const) {
      const copy = squareNotReadyCopy({ reasons: [...reasons] }, 'M');
      const text = `${copy.title} ${copy.body} ${copy.action}`;
      expect(text).not.toMatch(/\bAI\b/);
      expect(text).not.toMatch(/you (forgot|failed|didn)/i);
    }
  });
});

describe('squareConnectionStatusLine', () => {
  it('reads plain "Connected" while the verdict is ready or not yet known', () => {
    expect(squareConnectionStatusLine(null)).toEqual({ label: 'Connected', tone: 'ready' });
    expect(squareConnectionStatusLine(undefined).tone).toBe('ready');
    expect(squareConnectionStatusLine({ ready: true, reasons: [] })).toEqual({ label: 'Connected', tone: 'ready' });
  });

  it('carries the not-taking-payments truth on the line itself, in the warning tone', () => {
    const line = squareConnectionStatusLine({ ready: false, reasons: ['no_card_processing'] });
    expect(line.tone).toBe('warning');
    expect(line.label).toBe('Connected · not taking payments yet');
  });

  it('names the country problem when that is the reason', () => {
    const line = squareConnectionStatusLine({ ready: false, reasons: ['no_card_processing', 'currency_mismatch'] });
    expect(line).toEqual({ label: 'Connected · not an Australian account', tone: 'warning' });
  });
});
