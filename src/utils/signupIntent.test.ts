import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasSignupIntent, readSignupIntentFromLocation } from './signupIntent';

describe('hasSignupIntent', () => {
  it('reads the param the marketing CTAs actually send', () => {
    expect(hasSignupIntent('?signup=1')).toBe(true);
  });

  it('accepts a query string with or without the leading question mark', () => {
    expect(hasSignupIntent('signup=1')).toBe(true);
  });

  it('accepts the other truthy spellings', () => {
    expect(hasSignupIntent('?signup=true')).toBe(true);
    expect(hasSignupIntent('?signup=YES')).toBe(true);
    expect(hasSignupIntent('?signup=%20true%20')).toBe(true);
  });

  it('survives AttributionBridge appending ad params after ours', () => {
    expect(
      hasSignupIntent('?signup=1&utm_source=facebook&utm_medium=paid&fbclid=IwAR123'),
    ).toBe(true);
    expect(hasSignupIntent('?utm_source=google&gclid=abc&signup=1')).toBe(true);
  });

  it('leaves the site\'s "Log in" links on sign-in', () => {
    expect(hasSignupIntent('')).toBe(false);
    expect(hasSignupIntent(null)).toBe(false);
    expect(hasSignupIntent(undefined)).toBe(false);
    expect(hasSignupIntent('?')).toBe(false);
    expect(hasSignupIntent('?utm_source=facebook&fbclid=IwAR123')).toBe(false);
  });

  it('treats an explicitly falsy or empty value as no intent', () => {
    expect(hasSignupIntent('?signup=0')).toBe(false);
    expect(hasSignupIntent('?signup=false')).toBe(false);
    expect(hasSignupIntent('?signup=')).toBe(false);
    expect(hasSignupIntent('?signup')).toBe(false);
  });

  it('is case-sensitive on the key, since only our own links set it', () => {
    expect(hasSignupIntent('?SIGNUP=1')).toBe(false);
  });

  it('never throws on a malformed query string', () => {
    expect(hasSignupIntent('?%%%&signup=1')).toBe(true);
    expect(hasSignupIntent('%')).toBe(false);
  });
});

describe('readSignupIntentFromLocation', () => {
  const originalWindow = (globalThis as any).window;

  afterEach(() => {
    if (originalWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = originalWindow;
    vi.unstubAllGlobals();
  });

  it('reads the live URL on web', () => {
    vi.stubGlobal('window', { location: { search: '?signup=1' } });
    expect(readSignupIntentFromLocation()).toBe(true);
  });

  it('is false for a bare /app visit', () => {
    vi.stubGlobal('window', { location: { search: '' } });
    expect(readSignupIntentFromLocation()).toBe(false);
  });

  it('is false on native, where window.location does not exist', () => {
    vi.stubGlobal('window', {});
    expect(readSignupIntentFromLocation()).toBe(false);
  });

  it('is false with no window at all (SSR / prerender)', () => {
    delete (globalThis as any).window;
    expect(readSignupIntentFromLocation()).toBe(false);
  });
});
