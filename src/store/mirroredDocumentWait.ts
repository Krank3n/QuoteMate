/**
 * Wait for a unified Document to be mirrored in.
 *
 * The legacy quote lands in `users/{uid}/quotes` and a Cloud Function
 * (onQuoteWritten) copies it into `users/{uid}/documents` a moment later.
 * Anything that converts by document id — convertDocumentToInvoice, client
 * and server — needs that copy to exist. The wizard's paths never noticed the
 * gap because a materials + pricing run takes 15–40 s; Mate's rate-card path
 * finishes in under a second, so its auto-convert of a lump-sum claim ran
 * before the copy existed and the tradie got a quote numbered Q-001 while the
 * chat said "Here's the invoice".
 *
 * Pure: the caller supplies the read and (in tests) the sleep. Returns the
 * document as soon as a read finds it, or undefined once the attempts are
 * spent. Never sleeps after the last attempt.
 */
export interface MirrorWaitOptions {
  /** How many reads to make before giving up. */
  attempts: number;
  /** Pause between reads. */
  intervalMs: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Mate's auto-convert budget. The mirror usually lands within a couple of
 * seconds; ten seconds covers a cold start without leaving the tradie staring
 * at the working card for long.
 */
export const MATE_INVOICE_MIRROR_WAIT: MirrorWaitOptions = { attempts: 20, intervalMs: 500 };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitForMirroredDocument<T>(
  read: () => Promise<T | null | undefined>,
  options: MirrorWaitOptions,
): Promise<T | undefined> {
  const attempts = Math.max(1, Math.floor(options.attempts));
  const sleep = options.sleep ?? defaultSleep;
  for (let i = 0; i < attempts; i++) {
    const found = await read();
    if (found) return found;
    if (i < attempts - 1) await sleep(options.intervalMs);
  }
  return undefined;
}
