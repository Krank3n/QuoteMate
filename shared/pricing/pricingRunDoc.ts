/**
 * The pricing-run document — users/{uid}/pricingRuns/{runId}.
 *
 * Written by the phone (src/services/serverPricingRun.ts), advanced by the
 * Cloud Function (functions/src/pricingRun.ts). This is the wire contract
 * between two processes, so it lives here and nowhere else.
 */

import type { WorkingStatus } from './progress';

export type PricingRunKind = 'draft' | 'scope';
export type PricingRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/**
 * What the phone asks for. The plan (and with it photo vision) is NOT here:
 * the server resolves it from the subscription document, so a run document
 * cannot hand its author a tier they don't have.
 */
export interface PricingRunOptions {
  /** Labour is charged through rate lines, so the analysis's hours come off. */
  stripLabour: boolean;
  /** Keep hours + sections, drop the gear list and skip pricing. */
  labourOnly: boolean;
}

export interface PricingRunResult {
  generatedMaterialCount: number;
  fetchedCount: number;
  failedCount: number;
  skippedCount: number;
  /** Terms a local supplier ranked above Bunnings could not cover. */
  missedSupplierTerms: string[];
  reeceReauthNeeded: boolean;
}

export interface PricingRunRecord {
  quoteId: string;
  /** A first draft or a scope correction — logged with the run's outcome. */
  kind: PricingRunKind;
  options: PricingRunOptions;
  status: PricingRunStatus;
  /** Live working-card state, in the shape the chat renders. */
  progress?: WorkingStatus;
  /**
   * Maintained by the phone: false while the app is backgrounded or the
   * phone is locked. Read once at the end to decide whether a push is worth
   * sending — a tradie watching the card doesn't need one.
   */
  foreground?: boolean;
  /** Last time the phone confirmed it was in front (ISO). */
  foregroundAt?: string;
  createdAt: string;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  result?: PricingRunResult;
  error?: string;
}
