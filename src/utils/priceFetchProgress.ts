import { Material } from '../types';

// Countdown + live-row helpers for the price-fetch progress UI
// (MaterialsListScreen's estimate modal). Extracted from the screen so the
// estimate math has real unit tests — the inline version had a bug where the
// chunkIndex-0 event (emitted before any chunk completed) divided elapsed
// time by max(0, 1) and crushed the countdown to a few seconds, after which
// the first real chunk made it jump back up.

/** Seconds allowed for the post-batch phases (Reece post-pass, individual
 *  fallback, reconcile). Keeps the countdown from freezing at 0:00 while
 *  those passes are still running. */
export const POST_BATCH_TAIL_SECONDS = 10;

/** Initial estimate shown when the fetch kicks off: the Bunnings batch pass
 *  works in chunks of 3 at roughly 35s each. */
export function initialFetchEstimateSeconds(itemCount: number): number {
  return Math.max(Math.ceil(itemCount / 3) * 35, 35) + POST_BATCH_TAIL_SECONDS;
}

/**
 * Re-estimate the countdown from actual batch pace.
 *
 * Returns null when there is nothing measured yet (no completed chunks) —
 * the caller should leave the running countdown alone rather than guess.
 * `batchStartedAtMs` must be when the BATCH phase started, not when the
 * whole fetch started: preflight/local/Reece time would otherwise inflate
 * the per-chunk average.
 */
export function reestimateFetchSeconds(opts: {
  completedChunks: number;
  totalChunks: number;
  batchStartedAtMs: number;
  nowMs: number;
}): number | null {
  const { completedChunks, totalChunks, batchStartedAtMs, nowMs } = opts;
  if (completedChunks <= 0) return null;
  const chunksRemaining = totalChunks - completedChunks;
  if (chunksRemaining <= 0) return POST_BATCH_TAIL_SECONDS;
  const elapsedMs = Math.max(nowMs - batchStartedAtMs, 0);
  const avgMsPerChunk = elapsedMs / completedChunks;
  return Math.ceil((avgMsPerChunk * chunksRemaining) / 1000) + POST_BATCH_TAIL_SECONDS;
}

/**
 * Replace one row in a materials list with the snapshot the pricing pipeline
 * just emitted (item-priced event `material` payload), matching by id.
 * Returns a new array; the input is never mutated. Unknown ids return the
 * list unchanged so a stale event can't invent rows.
 */
export function applyPricedRow(materials: Material[], priced: Material): Material[] {
  if (!materials.some((m) => m.id === priced.id)) return materials;
  return materials.map((m) => (m.id === priced.id ? priced : m));
}

/**
 * Final-apply merge: fold the pipeline's finished rows into the LIVE
 * materials list rather than overwriting it wholesale. The pipeline version
 * wins per-id (it carries reconcile/pack-size adjustments), but rows the
 * user added mid-fetch survive and rows they deleted stay deleted — the
 * fetch modal is dismissable, so the list is editable while prices stream.
 */
export function mergePipelineMaterials(live: Material[], pipeline: Material[]): Material[] {
  const byId = new Map(pipeline.map((m) => [m.id, m]));
  return live.map((m) => byId.get(m.id) ?? m);
}
