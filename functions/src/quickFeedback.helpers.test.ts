import { describe, it, expect } from 'vitest';
import {
  getFeedbackDocId,
  getCategoryLabel,
  isSideEffectFreeRequest,
  isRatingRecordRequest,
} from './quickFeedback.helpers';

describe('getFeedbackDocId — deterministic, idempotent per user+category', () => {
  it('buckets first-quote (default/undefined/unknown) to one stable id', () => {
    expect(getFeedbackDocId('u1', undefined)).toBe('u1__first-quote');
    expect(getFeedbackDocId('u1', 'first-quote')).toBe('u1__first-quote');
    expect(getFeedbackDocId('u1', 'whatever')).toBe('u1__first-quote');
  });
  it('buckets re-engagement separately', () => {
    expect(getFeedbackDocId('u1', 're-engagement')).toBe('u1__re-engagement');
  });
  it('is stable across calls so re-taps/prefetches upsert one doc, not append', () => {
    expect(getFeedbackDocId('u1', undefined)).toBe(getFeedbackDocId('u1', undefined));
    expect(getFeedbackDocId('u1', 're-engagement')).not.toBe(getFeedbackDocId('u1', undefined));
  });
});

describe('getCategoryLabel — fixes the re-engagement mislabel', () => {
  it('labels re-engagement vs first-quote correctly', () => {
    expect(getCategoryLabel('re-engagement')).toBe('Re-engagement');
    expect(getCategoryLabel(undefined)).toBe('First Quote Follow-Up');
    expect(getCategoryLabel('first-quote')).toBe('First Quote Follow-Up');
  });
});

describe('isSideEffectFreeRequest — the scanner/prefetch guard (root-cause fix)', () => {
  it('treats HEAD (any case) as side-effect-free', () => {
    expect(isSideEffectFreeRequest('HEAD', {})).toBe(true);
    expect(isSideEffectFreeRequest('head', {})).toBe(true);
  });
  it('detects prefetch/preview across every purpose header variant', () => {
    expect(isSideEffectFreeRequest('GET', { purpose: 'prefetch' })).toBe(true);
    expect(isSideEffectFreeRequest('GET', { 'x-purpose': 'preview' })).toBe(true);
    expect(isSideEffectFreeRequest('GET', { 'x-moz': 'prefetch' })).toBe(true);
    expect(isSideEffectFreeRequest('GET', { 'sec-purpose': 'prefetch;prerender' })).toBe(true);
  });
  it('is case-insensitive and tolerates array header values', () => {
    expect(isSideEffectFreeRequest('GET', { purpose: 'Prefetch' })).toBe(true);
    expect(isSideEffectFreeRequest('GET', { 'sec-purpose': ['prefetch'] })).toBe(true);
  });
  it('lets a real human GET/POST through so the rating still records', () => {
    expect(isSideEffectFreeRequest('GET', {})).toBe(false);
    expect(isSideEffectFreeRequest('GET', { purpose: 'navigate' })).toBe(false);
    expect(isSideEffectFreeRequest('POST', {})).toBe(false);
  });
});

describe('isRatingRecordRequest — POST routing (rating record vs detailed feedback)', () => {
  it('is a rating record when record:true', () => {
    expect(isRatingRecordRequest({ record: true })).toBe(true);
    expect(isRatingRecordRequest({ record: true, rating: 'great' })).toBe(true);
  });
  it('is a rating record when a rating is present with no details', () => {
    expect(isRatingRecordRequest({ rating: 'okay' })).toBe(true);
  });
  it('is NOT a rating record when details are supplied (detailed-feedback path)', () => {
    expect(isRatingRecordRequest({ rating: 'great', details: 'loved it' })).toBe(false);
    expect(isRatingRecordRequest({ details: 'text' })).toBe(false);
  });
  it('is NOT a rating record for an empty body', () => {
    expect(isRatingRecordRequest({})).toBe(false);
  });
});
