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

export interface QuickStats {
  /** Count of quotes sent and not yet answered. */
  sentQuotes: number;
  /** Total value of those unanswered quotes. */
  pipelineValue: number;
  /** Count of jobs accepted or further along. */
  acceptedQuotes: number;
}

export function quickStats(documents: Document[]): QuickStats {
  let sentQuotes = 0;
  let pipelineValue = 0;
  let acceptedQuotes = 0;

  for (const doc of documents || []) {
    if (!doc) continue;
    if (isAwaitingResponse(doc.stage)) {
      sentQuotes++;
      pipelineValue += Number(doc.total) || 0;
    } else if (isWon(doc.stage)) {
      acceptedQuotes++;
    }
  }

  // Two decimals — summing floats otherwise shows $7,355.4299999 on a tile.
  return { sentQuotes, pipelineValue: Math.round(pipelineValue * 100) / 100, acceptedQuotes };
}
