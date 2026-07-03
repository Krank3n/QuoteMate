// Content selection for the materials-list empty state — the screen a tradie
// lands on right after writing their job notes, and the point where 40% of
// first quotes historically stalled with zero materials. Kept pure (no RN
// imports) so the hero copy/action logic is unit-testable without rendering
// the screen.

/** What tapping the hero card should do. */
export type MaterialsEmptyHeroAction = 'generate' | 'paywall' | 'add-notes';

export interface MaterialsEmptyStateContent {
  hero: {
    action: MaterialsEmptyHeroAction;
    title: string;
    subtitle: string;
    ctaLabel: string;
    showProBadge: boolean;
  };
  manual: {
    title: string;
    subtitle: string;
  };
  skipLabel: string;
}

/**
 * Pick the hero card's copy and tap action for the empty materials list.
 *
 * - Notes written + Pro/trial → 'generate': run Get Recommended Gear.
 * - Notes written + free plan → 'paywall': same pitch, Pro badge, paywall on tap.
 * - No job notes → 'add-notes': generation would dead-end ("No Description"
 *   modal), so instead the hero sends them back to Job Details to write notes.
 */
export function getMaterialsEmptyState(opts: {
  hasJobNotes: boolean;
  isPro: boolean;
}): MaterialsEmptyStateContent {
  const { hasJobNotes, isPro } = opts;

  // "Ballpark costs", not "costs" — generation estimates prices; the real
  // supplier price fetch is a separate follow-up step, so don't promise
  // quote-ready numbers here.
  const hero = hasJobNotes
    ? {
        action: (isPro ? 'generate' : 'paywall') as MaterialsEmptyHeroAction,
        title: 'Build the gear list for me',
        subtitle:
          'Reads your job notes and lines up the gear, quantities and ballpark costs — ready in a minute or so.',
        ctaLabel: 'Build my list',
        showProBadge: !isPro,
      }
    : {
        action: 'add-notes' as MaterialsEmptyHeroAction,
        title: 'Build the gear list for me',
        subtitle:
          'Chuck in a few notes about the job first, and they’ll be turned into a gear list with ballpark costs.',
        ctaLabel: 'Add job notes',
        // Tapping is a free action (just navigates to job notes) — a Pro
        // badge on it would wrongly signal a paywall.
        showProBadge: false,
      };

  return {
    hero,
    manual: {
      title: 'I’ll build it myself',
      subtitle: 'Start with a blank list and add your own gear by hand.',
    },
    skipLabel: 'Labour only · skip materials',
  };
}
