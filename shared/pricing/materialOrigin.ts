// Origin marker for a Material line item — distinguishes gear the "Get
// Recommended Gear" pipeline generated from the job scope ('recommended') from
// rows the tradie added or edited by hand ('manual'). No UI hangs off this
// yet; it's captured so pipeline telemetry / future review can tell
// auto-suggested lines from hand-entered ones.

export type MaterialOrigin = 'recommended' | 'manual';

/**
 * Stamp `origin` onto a material only when it doesn't already carry one — never
 * overwrite an existing marker. This keeps the first source of truth: a
 * hand-edited 'manual' row stays 'manual' even if it later flows through a
 * 'recommended' code path (and vice versa). Returns the same object when it's
 * already stamped, otherwise a shallow copy with the marker added.
 */
export function withOrigin<T extends { origin?: MaterialOrigin }>(
  material: T,
  origin: MaterialOrigin,
): T {
  return material.origin ? material : { ...material, origin };
}
