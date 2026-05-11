/**
 * Supplier priority resolver.
 *
 * Combines the user's saved priority order (`BusinessSettings.supplierPriority`)
 * with their currently-available pricing sources (Bunnings backbone + Reece
 * when connected + their saved local suppliers) into a single ordered list.
 *
 * Used by:
 *   - TradePricingScreen — to render the drag-and-drop reorderable list
 *   - MaterialsListScreen — to decide whether Reece runs before or after the
 *     Bunnings batch when fetching prices
 */

import type { SupplierGroup } from '../types';

export type SupplierKind = 'bunnings' | 'reece' | 'local';

export interface SupplierEntry {
  /** Stable identifier — 'bunnings', 'reece', or a SupplierGroup.id. */
  id: string;
  kind: SupplierKind;
  name: string;
  /** Friendly subtitle e.g. "Always on", "Connected", "Local supplier". */
  subtitle: string;
  /** True for Bunnings + Reece — these can be dragged but not removed. */
  builtIn: boolean;
  /**
   * The underlying SupplierGroup, when kind === 'local'. Lets the UI link
   * straight to the supplier's edit screen.
   */
  group?: SupplierGroup;
}

const BUILT_IN_IDS = new Set(['bunnings', 'reece']);

/**
 * Resolve the unified, ordered list of suppliers for the current user.
 *
 * Rules:
 *   1. Start with the saved `supplierPriority` order (if any).
 *   2. Append any built-in / local supplier the user has access to but that
 *      isn't yet in the saved order. Built-ins go first (Reece before
 *      Bunnings if Reece is connected), then locals.
 *   3. Drop entries from saved order that are no longer available
 *      (Reece-when-disconnected, deleted local groups).
 */
export function composeSupplierList(args: {
  savedPriority?: string[];
  reeceConnected: boolean;
  localGroups: SupplierGroup[];
}): SupplierEntry[] {
  const { savedPriority = [], reeceConnected, localGroups } = args;

  const groupsById = new Map<string, SupplierGroup>();
  for (const g of localGroups) {
    if (g?.id) groupsById.set(g.id, g);
  }

  const availableIds = new Set<string>();
  availableIds.add('bunnings');
  if (reeceConnected) availableIds.add('reece');
  for (const id of groupsById.keys()) availableIds.add(id);

  // Step 1: walk the saved order, keeping only entries that resolve to an
  // available source today.
  const ordered: SupplierEntry[] = [];
  const seen = new Set<string>();
  for (const id of savedPriority) {
    if (!availableIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(toEntry(id, groupsById));
  }

  // Step 2: append anything available the user hasn't ordered yet. New
  // installs hit this with everything; reconnecting Reece appends it; new
  // local supplier additions append at the end. Defaults: Reece first
  // (when connected), then Bunnings, then locals by their saved sortOrder.
  if (reeceConnected && !seen.has('reece')) ordered.push(toEntry('reece', groupsById));
  if (!seen.has('bunnings')) ordered.push(toEntry('bunnings', groupsById));
  for (const g of [...localGroups].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    if (g?.id && !seen.has(g.id)) ordered.push(toEntry(g.id, groupsById));
  }

  return ordered;
}

function toEntry(id: string, groupsById: Map<string, SupplierGroup>): SupplierEntry {
  if (id === 'bunnings') {
    return {
      id: 'bunnings',
      kind: 'bunnings',
      name: 'Bunnings',
      subtitle: 'Always on — every quote',
      builtIn: true,
    };
  }
  if (id === 'reece') {
    return {
      id: 'reece',
      kind: 'reece',
      name: 'Reece',
      subtitle: 'Your real trade prices',
      builtIn: true,
    };
  }
  const group = groupsById.get(id);
  return {
    id,
    kind: 'local',
    name: group?.name || 'Custom supplier',
    subtitle: group?.address || 'Your local supplier',
    builtIn: false,
    group,
  };
}

/**
 * Whether Reece should run as a pre-pass (before the Bunnings batch) for
 * the given priority list. True when Reece appears before Bunnings; false
 * when Bunnings is first or Reece isn't in the list.
 */
export function shouldRunReeceFirst(savedPriority?: string[]): boolean {
  if (!savedPriority || savedPriority.length === 0) {
    // Default for users who haven't reordered: Reece first when present.
    return true;
  }
  const reeceIdx = savedPriority.indexOf('reece');
  if (reeceIdx === -1) return false;
  const bunningsIdx = savedPriority.indexOf('bunnings');
  if (bunningsIdx === -1) return true;
  return reeceIdx < bunningsIdx;
}

/** Built-in supplier IDs — used to gate "delete" affordances in the UI. */
export function isBuiltInSupplier(id: string): boolean {
  return BUILT_IN_IDS.has(id);
}
