/**
 * Snapshot identity preservation.
 *
 * Firestore listeners materialise brand-new object instances on every
 * snapshot — including echoes of our own writes and server-trigger writes
 * that changed nothing the client cares about. Feeding those straight into
 * the store replaces array/item identity wholesale, which re-renders every
 * subscriber (and defeats React.memo on list cards) right when the user is
 * navigating — the "flicker on return to dashboard" bug.
 *
 * `preserveSnapshotIdentity` maps a fresh snapshot back onto the previous
 * array: items whose id + version are unchanged keep their previous object
 * instance, and if the whole snapshot is element-wise identical the previous
 * array itself is returned so a `prev === next` check can skip the store
 * write entirely.
 */

export function preserveSnapshotIdentity<T>(
  prev: T[],
  next: T[],
  idOf: (item: T) => string,
  /**
   * Monotonic change marker (typically updatedAt as epoch ms). Return NaN
   * for items missing one — NaN never equals itself, so such items are
   * always treated as changed rather than risking a stale instance.
   */
  versionOf: (item: T) => number,
): T[] {
  const prevById = new Map<string, { item: T; index: number }>();
  prev.forEach((item, index) => prevById.set(idOf(item), { item, index }));

  let changed = next.length !== prev.length;
  const out = next.map((item, index) => {
    const match = prevById.get(idOf(item));
    if (match && versionOf(match.item) === versionOf(item)) {
      // Same content — reuse the old instance. Order changes still count
      // as a change so subscribers re-render lists in the new order.
      if (match.index !== index) changed = true;
      return match.item;
    }
    changed = true;
    return item;
  });

  return changed ? out : prev;
}
