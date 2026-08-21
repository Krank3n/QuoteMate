/**
 * What the dashboard's draft banner does when it's tapped.
 *
 * A draft parked on `draftStep: 'JobPreview'` is a FINISHED quote waiting
 * on a send — the biggest stall bucket in the Jul 2026 send audit — but the
 * banner showed it a pencil and dropped the tradie back into the wizard
 * they'd already walked out of. When the draft carries a jobId we can land
 * them on the send sheet instead; without one there's no job to open, so
 * resuming the wizard stays the fallback.
 */

export type DraftBannerActionKind = 'send' | 'resume';

export interface DraftBannerAction {
  kind: DraftBannerActionKind;
  icon: string;
}

/**
 * @param canOpenSend Whether the send destination actually exists yet. The
 *   banner is fed by `quotes`, which is AsyncStorage-backed and therefore
 *   present offline and on the first frame of a cold launch — but the send
 *   route needs the JOB and the unified DOCUMENT, both Firestore-only, and
 *   the Document is minted by a server-side mirror trigger. So a freshly
 *   finished draft can be on screen seconds before anything it would open
 *   exists. Callers pass false in that window and the card falls back to
 *   resume — styling and route together — rather than promising a send the
 *   tap can't deliver.
 */
export function resolveDraftBannerAction(
  draft: { draftStep?: string; jobId?: string } | null | undefined,
  canOpenSend = true,
): DraftBannerAction {
  if (canOpenSend && draft?.draftStep === 'JobPreview' && draft.jobId) {
    return { kind: 'send', icon: 'send-outline' };
  }
  return { kind: 'resume', icon: 'pencil-outline' };
}
