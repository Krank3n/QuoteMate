/**
 * What Mate tells a tradie to do after the materials + pricing pipeline
 * falls over.
 *
 * The bug this exists to fix: the snag note always said "tap Fetch Prices in
 * the wizard", but MaterialsListScreen only renders that button when the
 * quote has rows on it (`materials.length > 0`). A pipeline that dies in the
 * ANALYSE phase leaves zero rows — which is exactly what happened on
 * 7 Sep 2026 — so the tradie was sent looking for
 * a button that isn't on the screen. With no rows the empty state's hero card
 * is what's there, and it reads "Build my list".
 *
 * Pure, so the branch that matters can be tested without rendering a screen.
 */

/** Which run fell over: the first draft, or a scope correction on an existing one. */
export type PipelineSnagStage = 'draft' | 'scope';

export interface PipelineSnagFacts {
  stage: PipelineSnagStage;
  /**
   * Rows on the quote once the snag had been parked. Zero means the analyse
   * never landed, so there is nothing to price yet.
   */
  materialCount: number;
  /** The underlying failure, quoted verbatim for the chat log. */
  error: string;
}

/**
 * The button the tradie will actually see on the parked wizard step.
 * `undefined` keeps the old wording for a caller that can't count the rows.
 */
export function snagStepLabel(materialCount: number | undefined): string {
  return materialCount === undefined || materialCount > 0 ? 'Fetch Prices' : 'Build my list';
}

/** The "[context]" note that goes into the chat after a degraded apply. */
export function pipelineSnagNote({ stage, materialCount, error }: PipelineSnagFacts): string {
  const label = snagStepLabel(materialCount);
  const lead =
    materialCount > 0
      ? stage === 'draft'
        ? 'opened the draft'
        : "the scope's updated but pricing didn't finish"
      : stage === 'draft'
        ? "opened the draft, but the gear list didn't get built"
        : "the scope's updated but the gear list didn't get rebuilt";
  return `Pipeline snag — ${lead}; tap ${label} in the wizard. (${error})`;
}
