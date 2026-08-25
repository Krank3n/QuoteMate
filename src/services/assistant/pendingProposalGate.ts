// Typed "yes" handling for the text chat.
//
// Voice resolves a waiting card via the live session's onControlAction; in
// text the control tools land in the dispatcher, which can't see the chat.
// The screen registers a probe that finds the waiting card, the gate pins its
// exact message + proposal ids at dispatch time, and the screen runs the same
// Apply / Dismiss the card's buttons run once the turn resolves.
//
// No probe registered (screen unmounted, tests) → nothing could be applied
// anyway, so the model is told no card is waiting.

export interface PendingProposalRef {
  messageId: string;
  proposalId: string;
}

let probe: ((proposalId?: string) => PendingProposalRef | null) | null = null;

export function setPendingProposalProbe(
  next: ((proposalId?: string) => PendingProposalRef | null) | null,
): void {
  probe = next;
}

export type ControlGateResult =
  | { ok: true; ref: PendingProposalRef }
  | { ok: false; error: string };

export function gateControlAction(requestedProposalId?: string): ControlGateResult {
  const found = probe?.(requestedProposalId) ?? null;
  if (found) return { ok: true, ref: found };
  // Same copy the voice path answers with, so the model recovers identically.
  return {
    ok: false,
    error: requestedProposalId
      ? 'That card is no longer waiting.'
      : 'No card is waiting to confirm.',
  };
}
