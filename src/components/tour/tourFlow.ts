/**
 * Unified tour flow — phase ordering, step offsets, and total count
 *
 * Each "phase" maps to one screen visit. The orchestrator advances
 * through phases, auto-navigating and injecting dummy data as it goes.
 */

import { TOUR_STEPS, SCREEN_TOURS } from './tourSteps';

export type TourPhase =
  | 'dashboard'
  | 'jobDetails'
  | 'customerDetails'
  | 'materialsList'          // empty state — AI generate / manual add cards
  | 'materialsListItems'     // items present — fetch prices, tap items, add more
  | 'addMaterial'
  | 'materialsListAdded'     // back to materials list after adding — show new item
  | 'laborMarkup'
  | 'quotePreview'
  | 'dashboardComplete';     // back on dashboard — show quote card actions

/** Ordered list of phases the unified tour walks through */
export const TOUR_PHASES: TourPhase[] = [
  'dashboard',
  'jobDetails',
  'customerDetails',
  'materialsList',
  'materialsListItems',
  'addMaterial',
  'materialsListAdded',
  'laborMarkup',
  'quotePreview',
  'dashboardComplete',
];

/** Number of tour steps per phase */
export const PHASE_STEP_COUNTS: Record<TourPhase, number> = {
  dashboard: TOUR_STEPS.length,                          // 2
  jobDetails: SCREEN_TOURS.jobDetails.length,            // 8
  customerDetails: SCREEN_TOURS.customerDetails.length,  // 3
  materialsList: SCREEN_TOURS.materialsList.length,      // 2
  materialsListItems: SCREEN_TOURS.materialsListItems.length, // 3
  addMaterial: SCREEN_TOURS.addMaterial.length,          // 3
  materialsListAdded: SCREEN_TOURS.materialsListAdded.length, // 1
  laborMarkup: SCREEN_TOURS.laborMarkup.length,          // 3
  quotePreview: SCREEN_TOURS.quotePreview.length,        // 2
  dashboardComplete: SCREEN_TOURS.dashboardComplete.length, // 1
};

/** Cumulative step offset for each phase (for "Step X of Y" display) */
export const PHASE_STEP_OFFSETS: Record<TourPhase, number> = (() => {
  const offsets: Partial<Record<TourPhase, number>> = {};
  let cumulative = 0;
  for (const phase of TOUR_PHASES) {
    offsets[phase] = cumulative;
    cumulative += PHASE_STEP_COUNTS[phase];
  }
  return offsets as Record<TourPhase, number>;
})();

/** Total number of steps across the entire unified tour */
export const UNIFIED_TOUR_TOTAL_STEPS = TOUR_PHASES.reduce(
  (sum, phase) => sum + PHASE_STEP_COUNTS[phase],
  0
);

/** Get the next phase after the given one, or null if it's the last */
export function getNextPhase(current: TourPhase): TourPhase | null {
  const idx = TOUR_PHASES.indexOf(current);
  if (idx < 0 || idx >= TOUR_PHASES.length - 1) return null;
  return TOUR_PHASES[idx + 1];
}

/** Which screen to navigate to for a given phase */
export function getScreenForPhase(phase: TourPhase): { screen: string; nested?: string } {
  switch (phase) {
    case 'dashboard':
    case 'dashboardComplete':
      return { screen: 'Main' };
    case 'jobDetails':
      return { screen: 'NewJob', nested: 'Details' };
    case 'customerDetails':
      return { screen: 'NewJob', nested: 'CustomerDetails' };
    case 'materialsList':
    case 'materialsListItems':
    case 'materialsListAdded':
      return { screen: 'NewJob', nested: 'MaterialsList' };
    case 'addMaterial':
      return { screen: 'NewJob', nested: 'AddMaterial' };
    case 'laborMarkup':
      return { screen: 'NewJob', nested: 'LaborMarkup' };
    case 'quotePreview':
      return { screen: 'NewJob', nested: 'JobPreview' };
  }
}
