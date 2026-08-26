/**
 * Platform-split declaration for the ElevenLabs runtime shim, so tsc and the
 * vitest alias both see one shape. Same pattern as nativeGoogleSignIn.d.ts.
 */
export declare function ensureElevenLabsRuntime(): Promise<void>;
