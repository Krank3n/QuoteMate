// Safe release for expo-keep-awake locks. On web, deactivateKeepAwake
// REJECTS (ERR_KEEP_AWAKE_TAG_INVALID) when the tag isn't in its wake-lock
// map — which happens whenever activation failed, e.g. Chrome denies
// navigator.wakeLock.request under battery saver. A bare `void` call lets
// that rejection escape as an unhandled promise rejection (Sentry
// REACT-NATIVE-2), so all releases go through here. Losing a release is
// always non-fatal: the OS just resumes its default sleep behaviour.
import { deactivateKeepAwake } from 'expo-keep-awake';

export function releaseKeepAwake(tag: string): void {
  try {
    void Promise.resolve(deactivateKeepAwake(tag)).catch(() => { /* noop */ });
  } catch {
    /* noop */
  }
}
