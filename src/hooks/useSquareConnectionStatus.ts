/**
 * useSquareConnectionStatus
 *
 * The dashboard's read of the Square connection: connected or not, and
 * whether Square will actually charge a card for the account. Until now the
 * home screen inferred "connected" from payment links on documents, which
 * can never say "connected but not activated" — the state where a tradie
 * connects, sees green, and finds out at the invoice gate that nothing can
 * be paid.
 *
 * One call per app session, shared across mounts, and re-asked no sooner
 * than the server re-asks Square for a flagged account (5 minutes), so a
 * dashboard that re-renders on every tap never pays for it twice. A failed
 * call reports "unknown" (nulls) rather than "not connected", because a
 * warning built on a guess is worse than no warning.
 */

import { useEffect, useState } from 'react';

import { checkSquareConnection, type SquareConnectionStatus } from '../services/squareService';
import { auth } from '../config/firebase';

export interface SquareConnectionRead {
  /** null until answered, or when the check could not complete. */
  connected: boolean | null;
  /** null when not connected, unknown, or the server has not asked Square yet. */
  paymentsReady: boolean | null;
}

export const SQUARE_STATUS_CACHE_MS = 5 * 60 * 1000;

const UNKNOWN: SquareConnectionRead = { connected: null, paymentsReady: null };

let cached: { uid: string; at: number; read: SquareConnectionRead } | null = null;
let inflight: Promise<SquareConnectionRead> | null = null;

/** Pure: the status the server returns → what the dashboard needs from it. */
export function readSquareConnection(status: SquareConnectionStatus | null | undefined): SquareConnectionRead {
  if (!status) return UNKNOWN;
  if (!status.connected) return { connected: false, paymentsReady: null };
  const ready = status.paymentReadiness?.ready;
  return { connected: true, paymentsReady: typeof ready === 'boolean' ? ready : null };
}

/** Forget the cached answer — after a connect, disconnect or "check again". */
export function invalidateSquareConnectionStatus(): void {
  cached = null;
}

async function fetchOnce(uid: string): Promise<SquareConnectionRead> {
  if (cached && cached.uid === uid && Date.now() - cached.at < SQUARE_STATUS_CACHE_MS) return cached.read;
  if (!inflight) {
    inflight = checkSquareConnection()
      .then((status) => {
        const read = readSquareConnection(status);
        cached = { uid, at: Date.now(), read };
        return read;
      })
      .catch(() => UNKNOWN)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * @param active Re-asks (through the cache) each time this flips true — the
 * dashboard passes its focus state, so a tradie coming back from the Square
 * screen after a connect or a "check again" sees the new truth at once.
 */
export function useSquareConnectionStatus(active: boolean = true): SquareConnectionRead {
  const uid = auth.currentUser?.uid ?? null;
  const [read, setRead] = useState<SquareConnectionRead>(() =>
    uid && cached && cached.uid === uid ? cached.read : UNKNOWN,
  );

  useEffect(() => {
    if (!uid || !active) return;
    let cancelled = false;
    fetchOnce(uid).then((r) => {
      if (!cancelled) setRead(r);
    });
    return () => {
      cancelled = true;
    };
  }, [uid, active]);

  return read;
}
