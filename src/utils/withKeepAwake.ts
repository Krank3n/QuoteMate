// Screen-wake guard for long-running pipeline work (materials generation,
// price fetching). If the phone sleeps mid-run the OS drops the network and
// the run dies, so the screen is held awake for the duration.
//
// A module-level refcount (rather than expo-keep-awake's per-tag counting)
// makes overlapping runs safe with a single tag: generate + price-fetch can
// overlap via Mate's apply path, and the lock releases only when the last
// run finishes. Activation/deactivation failures are swallowed — losing the
// wake lock (e.g. web without the Wake Lock API) must never fail the run.
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const PIPELINE_KEEP_AWAKE_TAG = 'materials-pipeline';

let activeRuns = 0;

export async function withKeepAwake<T>(fn: () => Promise<T>): Promise<T> {
  activeRuns += 1;
  if (activeRuns === 1) {
    try {
      await activateKeepAwakeAsync(PIPELINE_KEEP_AWAKE_TAG);
    } catch {
      /* non-fatal — run proceeds without the wake lock */
    }
  }
  try {
    return await fn();
  } finally {
    activeRuns -= 1;
    if (activeRuns === 0) {
      try {
        void deactivateKeepAwake(PIPELINE_KEEP_AWAKE_TAG);
      } catch {
        /* non-fatal */
      }
    }
  }
}
