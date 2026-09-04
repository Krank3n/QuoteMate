/**
 * Safe-area insets for content inside a React Native <Modal>.
 *
 * Deliberately dependency-free (the hook that reads the device lives in
 * hooks/useModalInsets) so the arithmetic is unit-testable without dragging
 * react-native-safe-area-context into the test runner.
 *
 * Two things make this worth its own helper:
 *
 *  1. A <Modal> renders in its own native view hierarchy, so the root
 *     SafeAreaProvider doesn't reach inside it and useSafeAreaInsets() reads
 *     0. initialWindowMetrics, captured from native at startup, still holds
 *     the real insets, so it is the fallback.
 *  2. Android used to push modals clear of the system bars by itself, so the
 *     send modal padded a flat 16 at the bottom there. Edge-to-edge ended
 *     that (targetSdk 35+, and this app sets edgeToEdgeEnabled): the window
 *     extends under the navigation bar and a modal's own footer sits beneath
 *     the back/home/recents buttons. Android now takes the same real insets
 *     as iOS.
 */

/** Breathing room under a footer even where the system reports no inset. */
export const MODAL_MIN_BOTTOM_PAD = 16;

/**
 * The largest of what the tree reports, what native captured at startup, and
 * a minimum. Junk (undefined, NaN, negative) counts as no inset.
 */
export function resolveModalInset(args: {
  contextValue?: number;
  metricsValue?: number;
  minimum?: number;
}): number {
  const usable = (v: number | undefined): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  return Math.max(usable(args.contextValue), usable(args.metricsValue), args.minimum ?? 0);
}
