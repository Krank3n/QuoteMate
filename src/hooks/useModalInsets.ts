/**
 * Safe-area insets for content inside a React Native <Modal>. The reasoning
 * (and the arithmetic, which is unit-tested) lives in utils/modalInsets.
 */

import { useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';
import { MODAL_MIN_BOTTOM_PAD, resolveModalInset } from '../utils/modalInsets';

export { MODAL_MIN_BOTTOM_PAD } from '../utils/modalInsets';

export interface ModalInsets {
  /** Clears the status bar / notch. No minimum — headers add their own padding. */
  top: number;
  /** Clears the home indicator and Android's navigation bar. */
  bottom: number;
}

export function useModalInsets(minimumBottom: number = MODAL_MIN_BOTTOM_PAD): ModalInsets {
  const insets = useSafeAreaInsets();
  return {
    top: resolveModalInset({
      contextValue: insets.top,
      metricsValue: initialWindowMetrics?.insets.top,
    }),
    bottom: resolveModalInset({
      contextValue: insets.bottom,
      metricsValue: initialWindowMetrics?.insets.bottom,
      minimum: minimumBottom,
    }),
  };
}

/** Just the bottom, for a modal that only has a footer to protect. */
export function useModalBottomInset(minimum: number = MODAL_MIN_BOTTOM_PAD): number {
  return useModalInsets(minimum).bottom;
}
