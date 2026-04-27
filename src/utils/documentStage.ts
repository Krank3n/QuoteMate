/**
 * Re-exports from the canonical state machine in `shared/document/stage.ts`.
 * Kept here so existing imports (`src/utils/documentStage`) keep working.
 */
export {
  LEGAL_TRANSITIONS,
  canTransition,
  allowedNextStages,
  isTerminal,
} from '../../shared/document/stage';
