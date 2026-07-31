import { describe, expect, it } from 'vitest';
import { userRateLimitKey } from './rateLimitKey';

describe('userRateLimitKey', () => {
  it('isolates unrelated features even when they use the same policy', () => {
    const policy = { maxRequests: 10, windowMs: 60_000 };

    expect(userRateLimitKey('uid-1', policy, 'materials-analyze'))
      .not.toBe(userRateLimitKey('uid-1', policy, 'assistant-token'));
  });

  it('isolates strict and permissive policies in the shared bucket', () => {
    expect(userRateLimitKey('uid-1', { maxRequests: 10, windowMs: 60_000 }))
      .not.toBe(userRateLimitKey('uid-1', { maxRequests: 30, windowMs: 60_000 }));
  });

  it('normalises feature names into Firestore-safe stable keys', () => {
    expect(userRateLimitKey('uid-1', { maxRequests: 10, windowMs: 60_000 }, 'Materials / Analyze'))
      .toBe('user:uid-1:materials-analyze:10:60000');
  });
});
