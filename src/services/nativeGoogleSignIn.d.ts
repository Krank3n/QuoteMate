/**
 * Type surface for the platform-resolved `nativeGoogleSignIn` module
 * (`nativeGoogleSignIn.native.ts` / `nativeGoogleSignIn.web.ts`).
 *
 * tsconfig uses `moduleResolution: "bundler"` with no platform `moduleSuffixes`,
 * so `tsc` can't resolve a bare `import '.../nativeGoogleSignIn'` to the
 * platform files. This declaration provides the shared type; Metro still picks
 * the correct `.native`/`.web` implementation at bundle time. Keep it in sync
 * with both implementations.
 */
export function ensureConfigured(): void;

export function signInGetIdToken(): Promise<string | null>;

export const statusCodes: {
  SIGN_IN_CANCELLED: string;
  IN_PROGRESS: string;
  PLAY_SERVICES_NOT_AVAILABLE: string;
  SIGN_IN_REQUIRED: string;
};
