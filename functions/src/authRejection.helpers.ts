/**
 * Why an authenticated endpoint said 401 — the pure half of verifyAuth's
 * logging, so it can be tested without a request.
 *
 * Added 21 Sep 2026: updateActivityTimestamp answered 401 to 205 of 274
 * calls in a week, and nothing recorded whether the header was missing or
 * the token was bad, or from which client. The activity ping is what the
 * return trial and the re-engagement emails key off, so a silent 401 is a
 * tradie the app thinks has left. Never logs the token itself.
 */

export type AuthRejectionReason = 'missing-header' | 'bad-scheme' | 'empty-token' | 'invalid-token';

export interface AuthRejection {
  reason: AuthRejectionReason;
  /** firebase-admin's error code for an invalid token, e.g. auth/id-token-expired. */
  code?: string;
}

/** The bearer token out of an Authorization header, or why there isn't one. */
export function bearerToken(header: unknown): { ok: true; token: string } | { ok: false; rejection: AuthRejection } {
  if (typeof header !== 'string' || !header.trim()) return { ok: false, rejection: { reason: 'missing-header' } };
  if (!header.startsWith('Bearer ')) return { ok: false, rejection: { reason: 'bad-scheme' } };
  const token = header.slice('Bearer '.length).trim();
  // A client that interpolated a missing value: "Bearer undefined" / "Bearer null".
  if (!token || token === 'undefined' || token === 'null') return { ok: false, rejection: { reason: 'empty-token' } };
  return { ok: true, token };
}

export function invalidTokenRejection(error: unknown): AuthRejection {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return { reason: 'invalid-token', ...(typeof code === 'string' ? { code } : {}) };
}

export interface AuthRejectionRequest {
  path?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
}

const clip = (v: unknown, n: number): string | undefined => (typeof v === 'string' && v ? v.slice(0, n) : undefined);

/** The structured log line: endpoint, reason, and what the client said it was. Never the token. */
export function authRejectionLog(req: AuthRejectionRequest, rejection: AuthRejection): Record<string, unknown> {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const headers = req.headers || {};
  const header = headers.authorization;
  return {
    endpoint: clip(req.path, 80) ?? '/',
    reason: rejection.reason,
    ...(rejection.code ? { code: rejection.code } : {}),
    userAgent: clip(headers['user-agent'], 160) ?? null,
    origin: clip(headers.origin, 120) ?? null,
    appVersion: clip(body.appVersion, 32) ?? null,
    appPlatform: clip(body.appPlatform, 16) ?? null,
    tokenLength: typeof header === 'string' ? Math.max(0, header.length - 'Bearer '.length) : 0,
  };
}
