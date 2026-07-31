export interface UserRateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

/**
 * Build a Firestore-safe rate-limit bucket for one authenticated feature.
 *
 * The old key was only `user:<uid>`, so unrelated endpoints polluted the same
 * rolling timestamp list. In particular, address autocomplete (30/min) could
 * put 10+ timestamps in the shared document and make materials analysis
 * (10/min) reject its very first request. Include both the feature bucket and
 * policy shape so a permissive endpoint can never exhaust a stricter one.
 */
export function userRateLimitKey(
  uid: string,
  config: UserRateLimitConfig,
  bucket = 'shared',
): string {
  const safeBucket = bucket.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'shared';
  return `user:${uid}:${safeBucket}:${config.maxRequests}:${config.windowMs}`;
}
