/**
 * The dashboard's "Awaiting response", "Quotes sent" and "Jobs won" tiles.
 *
 * These read the legacy `quotes` collection while the tile beside them
 * ("Earned this month", see earnedInMonth) reads the unified Document model.
 * On a fresh sign-in `documents` populates first, so the earnings tile showed
 * a real figure while the other three sat on 0 / 0 / $0.00 — an account with
 * eight live jobs looked completely empty. The legacy mirror also drifts:
 * once a quote is converted, its legacy `status` leaves accepted/completed,
 * so a job you'd won and invoiced silently stopped counting as won.
 *
 * Both go away by reading the same source of truth as every other screen.
 */

import type { Document } from '../types/document';
import { isAwaitingResponse, isWon } from './documentStages';
import { representativeQuote } from '../../shared/job/aggregate';

export interface QuickStats {
  /** Jobs with a quote sent and not yet answered — one per job, not per option. */
  sentQuotes: number;
  /** Their value, counting one quote per job. */
  pipelineValue: number;
  /** Count of jobs accepted or further along. */
  acceptedQuotes: number;
}

export function quickStats(documents: Document[]): QuickStats {
  let sentQuotes = 0;
  let pipelineValue = 0;
  let acceptedQuotes = 0;

  // Competing options on one job are alternatives, not separate pipeline. Two
  // prices for the same work are one opportunity worth one of them — counting
  // both put $2,431.00 on the tile for a job the customer will pay at most
  // $1,458.60 for. Group by job and let one quote speak for it, the same rule
  // the job header and job card use (shared/job/aggregate.ts).
  //
  // A document with no job stands alone: it has no siblings to be an
  // alternative to.
  const awaitingByJob = new Map<string, Document[]>();

  for (const doc of documents || []) {
    if (!doc) continue;
    if (isAwaitingResponse(doc.stage)) {
      const key = doc.jobId || `doc:${doc.id}`;
      const group = awaitingByJob.get(key) ?? [];
      group.push(doc);
      awaitingByJob.set(key, group);
    } else if (isWon(doc.stage)) {
      acceptedQuotes++;
    }
  }

  for (const group of awaitingByJob.values()) {
    sentQuotes++;
    pipelineValue += Number(representativeQuote(group as any)?.total) || 0;
  }

  // Two decimals — summing floats otherwise shows $7,355.4299999 on a tile.
  return { sentQuotes, pipelineValue: Math.round(pipelineValue * 100) / 100, acceptedQuotes };
}
