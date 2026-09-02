import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI,
  GOOGLE_CALENDAR_SCOPE,
  buildGoogleCalendarAuthUrl,
  parseGoogleTokenResponse,
} from './googleCalendarOAuth.helpers';

const NOW_MS = Date.parse('2026-09-02T02:00:00Z');

describe('buildGoogleCalendarAuthUrl', () => {
  const url = new URL(
    buildGoogleCalendarAuthUrl({
      clientId: '123-abc.apps.googleusercontent.com',
      redirectUri: DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI,
      state: 'nonce-1',
    }),
  );

  it('targets the Google authorize endpoint with the code flow', () => {
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('123-abc.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe(DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe('nonce-1');
  });

  it('asks for exactly the calendar.events scope on top of the sign-in scopes', () => {
    const scopes = (url.searchParams.get('scope') || '').split(' ');
    expect(scopes).toEqual(['openid', 'email', 'profile', GOOGLE_CALENDAR_SCOPE]);
  });

  it('forces a refresh token to be issued (offline + consent)', () => {
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  });

  it('defaults the redirect to the hosted callback page with a trailing slash', () => {
    expect(DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI).toBe(
      'https://quotemateapp.au/google-calendar/callback/',
    );
  });
});

describe('parseGoogleTokenResponse', () => {
  const good = {
    access_token: 'ya29.access',
    refresh_token: '1//refresh',
    expires_in: 3599,
    scope: `openid https://www.googleapis.com/auth/userinfo.email ${GOOGLE_CALENDAR_SCOPE}`,
    token_type: 'Bearer',
  };

  it('accepts a full grant and computes the access-token expiry', () => {
    const v = parseGoogleTokenResponse(good, NOW_MS);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.grant.refreshToken).toBe('1//refresh');
    expect(v.grant.accessToken).toBe('ya29.access');
    expect(v.grant.expiresAt).toBe(NOW_MS + 3599 * 1000);
    expect(v.grant.scope).toBe(good.scope);
  });

  it('rejects a response without a refresh token — the sync trigger cannot run on an access token alone', () => {
    const v = parseGoogleTokenResponse({ ...good, refresh_token: undefined }, NOW_MS);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error).toMatch(/complete token set/);
  });

  it('rejects a grant where the tradie un-ticked the calendar permission', () => {
    const v = parseGoogleTokenResponse({ ...good, scope: 'openid email profile' }, NOW_MS);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error).toMatch(/Calendar permission was not granted/);
  });

  it('tolerates a missing expires_in by leaving expiresAt null', () => {
    const v = parseGoogleTokenResponse({ ...good, expires_in: undefined }, NOW_MS);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.grant.expiresAt).toBeNull();
  });

  it('does not throw on garbage input', () => {
    expect(parseGoogleTokenResponse(null, NOW_MS).ok).toBe(false);
    expect(parseGoogleTokenResponse('nope', NOW_MS).ok).toBe(false);
  });
});
