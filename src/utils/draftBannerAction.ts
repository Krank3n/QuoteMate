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

export function resolveDraftBannerAction(
  draft: { draftStep?: string; jobId?: string } | null | undefined,
): DraftBannerAction {
  if (draft?.draftStep === 'JobPreview' && draft.jobId) {
    return { kind: 'send', icon: 'send-outline' };
  }
  return { kind: 'resume', icon: 'pencil-outline' };
}
