/**
 * The Brevo webhook → customer-open filter. Only a human open of a
 * customer-facing quote email may stamp a quote; proxy prefetches, test
 * sends, lifecycle mail and rows with no document id never do.
 */
import { describe, expect, it } from 'vitest';

import { brevoOpenTarget, isBrevoHumanOpen } from './brevoOpenSignal.helpers';

const row = { userId: 'u1', documentId: 'q1', tags: ['quote-to-client'], status: 'delivered' };

describe('isBrevoHumanOpen', () => {
  it('accepts opened / unique_opened in any case and rejects proxy opens and everything else', () => {
    expect(isBrevoHumanOpen('opened')).toBe(true);
    expect(isBrevoHumanOpen('Unique_Opened')).toBe(true);
    expect(isBrevoHumanOpen('proxy_open')).toBe(false);
    expect(isBrevoHumanOpen('unique_proxy_open')).toBe(false);
    expect(isBrevoHumanOpen('click')).toBe(false);
    expect(isBrevoHumanOpen('')).toBe(false);
  });
});

describe('brevoOpenTarget', () => {
  it('returns the quote for a human open of a customer-facing quote email', () => {
    expect(brevoOpenTarget('opened', row)).toEqual({ userId: 'u1', quoteId: 'q1' });
    expect(brevoOpenTarget('unique_opened', row)).toEqual({ userId: 'u1', quoteId: 'q1' });
  });

  it('ignores a proxy prefetch even on a matching row', () => {
    expect(brevoOpenTarget('proxy_open', row)).toBeNull();
    expect(brevoOpenTarget('unique_proxy_open', row)).toBeNull();
  });

  it('ignores rows that are not customer-facing quote sends', () => {
    expect(brevoOpenTarget('opened', { ...row, tags: ['quote-test'] })).toBeNull();
    expect(brevoOpenTarget('opened', { ...row, tags: ['invoice-to-client'] })).toBeNull();
    expect(brevoOpenTarget('opened', { ...row, tags: ['trial-lifecycle', 'trial-ending'] })).toBeNull();
    expect(brevoOpenTarget('opened', { ...row, tags: 'quote-to-client' })).toBeNull();
  });

  it('ignores blocked rows and rows missing the user or document id', () => {
    expect(brevoOpenTarget('opened', { ...row, status: 'blocked' })).toBeNull();
    expect(brevoOpenTarget('opened', { ...row, tags: ['quote-to-client', 'blocked:unsendable-domain:x'] })).toBeNull();
    expect(brevoOpenTarget('opened', { ...row, documentId: undefined })).toBeNull();
    expect(brevoOpenTarget('opened', { ...row, userId: '  ' })).toBeNull();
    expect(brevoOpenTarget('opened', null)).toBeNull();
  });
});
