/**
 * useTapToPayReadiness
 *
 * Apple req 3.9.1: while Tap to Pay configures itself the app must show a
 * progress indicator and say the feature isn't usable yet — during first-time
 * setup *and* during ordinary use whenever the reader is preparing. Req 5.7
 * adds that pressing the button mid-configuration should read as
 * "initializing", not as a failure.
 *
 * Square reports a state, not a percentage, so callers should render an
 * indeterminate spinner plus `label` rather than a progress bar.
 *
 * Subscribes only while `active` — the payment sheet passes its own visibility
 * so a closed sheet isn't holding a live reader subscription.
 */

import { useEffect, useState } from 'react';

import {
  observeTapToPayReadiness,
  type TapToPayReadiness,
} from '../services/squarePayments';

export interface TapToPayReadinessState {
  readiness: TapToPayReadiness;
  /** Merchant-facing status line. Null once ready — nothing to report. */
  label: string | null;
}

export function useTapToPayReadiness(active: boolean): TapToPayReadinessState {
  const [readiness, setReadiness] = useState<TapToPayReadiness>('preparing');

  useEffect(() => {
    if (!active) return;
    const stop = observeTapToPayReadiness(setReadiness);
    return stop;
  }, [active]);

  return {
    readiness,
    label:
      readiness === 'preparing'
        ? 'Getting Tap to Pay on iPhone ready — not ready to take a card yet.'
        : null,
  };
}
