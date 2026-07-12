// The teardown-debounce timer for a live voice session, extracted from the
// AssistantScreen AppState wiring so the actual regression behaviour — a
// spurious background→active bounce must NOT tear the session down, but a
// genuine background must — is unit-testable with fake timers.
//
// One timer at a time: start() always supersedes a running grace (so an iOS
// foreground→inactive→background sequence replaces the long inactive grace
// with the short background one rather than leaving the mic hot for the full
// inactive window). onExpire fires only if the grace runs to completion; a
// clear() (the app returned to 'active') cancels it silently.

export interface GraceController {
  /** Begin a grace of `ms`; replaces any running grace. */
  start(ms: number): void;
  /** Cancel a running grace without firing onExpire. */
  clear(): void;
  /** True while a grace is counting down. */
  isRunning(): boolean;
}

export function createGraceController(onExpire: () => void): GraceController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    start(ms: number) {
      clear();
      timer = setTimeout(() => {
        timer = null;
        onExpire();
      }, ms);
    },
    clear,
    isRunning: () => timer !== null,
  };
}
