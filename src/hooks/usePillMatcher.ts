import { useDeferredValue, useMemo } from 'react';
import { PillSpec } from '../data/nichePills';

export type PillState = Record<string, boolean>;

interface PillMatcherInput {
  transcript: string;
  pills: PillSpec[];
  /** Authoritative server result; once present, fully replaces client guesses. */
  serverState: PillState | null;
}

/**
 * Run keyword/regex matching over a live transcript and return the merged
 * pill state. Server state (returned by the cleanup LLM) takes priority
 * over the client-side keyword guess for any pill it covers.
 *
 * Known limitation: substring matching has no negation handling — "no oven"
 * still ticks the oven pill. The server pass corrects this on cleanup.
 */
export function usePillMatcher({ transcript, pills, serverState }: PillMatcherInput): PillState {
  // Defer to keep typing snappy — interim transcripts can fire many times
  // per second; matching against the deferred value lets React drop
  // intermediate frames under load.
  const deferred = useDeferredValue(transcript);

  return useMemo(() => {
    const lower = deferred.toLowerCase();
    const result: PillState = {};

    for (const pill of pills) {
      if (serverState && pill.id in serverState) {
        result[pill.id] = serverState[pill.id];
        continue;
      }
      result[pill.id] = pill.keywords.some(k =>
        typeof k === 'string' ? lower.includes(k.toLowerCase()) : k.test(deferred)
      );
    }

    return result;
  }, [deferred, pills, serverState]);
}
