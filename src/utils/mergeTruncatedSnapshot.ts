/**
 * Non-destructive merge for a capped Firestore listener.
 *
 * The live listeners cap their queries (`limit(N)`) while the one-shot loaders
 * — loadJobs / loadDocuments — are unbounded. Both write to the same store
 * array, and a snapshot REPLACES it (preserveSnapshotIdentity reuses item
 * instances but still returns an array of exactly `next.length`). So a
 * pull-to-refresh that fetched 130 jobs was silently trimmed back to the cap
 * by the next listener echo — and any write, including the server's own
 * aggregate trigger, fires an echo.
 *
 * For documents that was worse than losing rows: a job whose only invoice fell
 * outside the window got `docs = []`, so it bucketed to the wrong filter pile,
 * printed $0, and offered "Create Quote" on a job that already had a sent
 * invoice.
 *
 * The fix keeps items the snapshot could not have seen. `wasTruncated` is the
 * whole trick: only when the snapshot came back full is there anything beyond
 * it, so only then do we append. Under the cap the snapshot is the complete
 * truth and must win outright — otherwise a doc deleted on another device
 * would never leave the array, which is a far worse bug than a short list.
 */

export function mergeTruncatedSnapshot<T>(
  prev: T[],
  next: T[],
  idOf: (item: T) => string,
  wasTruncated: boolean,
): T[] {
  // Snapshot is authoritative: it saw everything, so deletes must land.
  if (!wasTruncated) return next;
  if (prev.length === 0) return next;

  const inSnapshot = new Set(next.map(idOf));
  const carried = prev.filter((item) => !inSnapshot.has(idOf(item)));
  if (carried.length === 0) return next;

  // Snapshot first — it is the freshest, and it is already ordered by the
  // query. Carried items are the older tail the listener never reached.
  return [...next, ...carried];
}
