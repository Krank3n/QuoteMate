/**
 * Apple review requirements 3.1 and 3.3.
 *
 *   3.1 "Your app provides highly visible and easily discoverable communication
 *        for Tap to Pay on iPhone."
 *   3.3 "Your app should display communications about Tap to Pay on iPhone to
 *        all eligible users at least once."
 *
 * This is the awareness moment an existing merchant sees — the substance of
 * Apple's "Existing User Flow" recording. It is deliberately plain text plus
 * Apple's own SF Symbol: the Developer Marketing Guidelines forbid creating
 * custom illustrations, photography or icons depicting iPhone or the feature,
 * and we have no Marketing Toolkit assets. Requirement 3.4 (setup at the end of
 * onboarding) is already built the same way and needed nothing from Apple.
 *
 * Note what this is NOT. Marketing requirement 6.2 wants a full-screen splash
 * built from the Toolkit's 'Hero' banner, and 6.3 wants a push using the
 * Toolkit's 'Value Proposition' copy. Those still need Apple's assets. This
 * covers 3.1/3.3 — the requirement to communicate — without pretending to be
 * the launch campaign.
 */

export interface TapToPayAwarenessInput {
  platformOS: string;
  /** The device + flag gate: capable hardware, OS floor met, feature allowed. */
  tapToPayEnabled: boolean;
  /** No Square connection means there is nothing to enable yet. */
  squareConnected: boolean;
  /** Apple's own record of whether the merchant accepted the T&Cs. */
  termsAccepted: boolean;
  /** When the tradie dismissed it, or null if they never have. */
  dismissedAt: number | null;
}

/**
 * Whether to show the awareness banner.
 *
 * The interesting judgement is when to STOP. Requirement 3.3 asks for the
 * communication to reach every eligible user at least once, which is an
 * argument for persistence; but a banner that will not go away is the thing
 * tradies uninstall over. Accepting the terms retires it permanently — at that
 * point they have not merely seen the message, they have acted on it — and an
 * explicit dismissal is honoured for good.
 */
export function shouldShowTapToPayAwareness(
  input: TapToPayAwarenessInput,
): boolean {
  // Apple's requirement is about Tap to Pay on iPhone specifically. Android's
  // contactless reader is Square's, not Apple's, and announcing it under
  // Apple's name would breach the naming rules outright.
  if (input.platformOS !== 'ios') return false;

  // Nothing to announce on a phone that cannot do it, or while the feature is
  // switched off — that would be marketing something the tradie cannot use.
  if (!input.tapToPayEnabled) return false;

  // Square is the PSP. Without a connection the CTA would dead-end.
  if (!input.squareConnected) return false;

  // Already accepted Apple's terms: they know the feature exists.
  if (input.termsAccepted) return false;

  // Dismissed means dismissed.
  if (input.dismissedAt !== null) return false;

  return true;
}

/**
 * Copy for the banner.
 *
 * The full name is mandatory and must never be shortened or paired with
 * "Apple" — Developer Marketing Guidelines. Kept here rather than inline in the
 * component so the exact string is covered by a test.
 */
export const TAP_TO_PAY_AWARENESS_COPY = {
  title: 'Tap to Pay on iPhone',
  body: 'Take card payments on this iPhone. No reader, no extra gear.',
  cta: 'Set it up',
} as const;
