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
  /** Resolve the waiting cards of the same kind alongside it — a plain yes. */
  group?: boolean;
}

let probe: ((proposalId?: string) => PendingProposalRef | null) | null = null;

export function setPendingProposalProbe(
  next: ((proposalId?: string) => PendingProposalRef | null) | null,
): void {
  probe = next;
}

// The cards waiting in the chat right now — so the dispatcher can refuse a
// card that is an exact copy of one already up. The screen registers it.
let pendingCardsProbe: (() => import('../../types/assistant').Proposal[]) | null = null;

export function setPendingCardsProbe(next: (() => import('../../types/assistant').Proposal[]) | null): void {
  pendingCardsProbe = next;
}

/** A card's content, without the ids and timestamp every fresh copy gets. */
function cardContent(p: import('../../types/assistant').Proposal): string {
  const { id: _id, toolUseId: _tool, createdAt: _at, ...rest } = p as unknown as Record<string, unknown>;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

/**
 * The waiting card `incoming` is an exact copy of, if any. Sim, 23 Sep 2026:
 * the tradie typed "Yep" to a waiting draft card and Mate put the same card
 * up again instead of applying it — a second identical card to tap, and the
 * yes lost. Refused in-turn, the model gets the one move that works.
 */
export function findIdenticalPendingCard(
  incoming: import('../../types/assistant').Proposal,
): import('../../types/assistant').Proposal | null {
  const key = cardContent(incoming);
  return (pendingCardsProbe?.() ?? []).find((p) => p.id !== incoming.id && cardContent(p) === key) ?? null;
}

// The tradie's latest line (typed, or a voice transcript), for the re-propose
// guard below. The screen registers it.
let latestTradieLineProbe: (() => string) | null = null;

export function setLatestTradieLineProbe(next: (() => string) | null): void {
  latestTradieLineProbe = next;
}

/**
 * A line that is nothing but a yes: "yep", "yeah go ahead", "sweet, price it
 * up", "do it". Anything carrying more — a figure, a name, "yeah but make it
 * 7 by 4" — is not, because that may be a correction the new card carries.
 */
export function isBareYes(line: string): boolean {
  // A figure is always new information (a price, a size, a phone number).
  if (/\d/.test(line)) return false;
  const words = line
    .toLowerCase()
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length || words.length > 6) return false;
  const YES = new Set([
    'yes', 'yep', 'yeah', 'yea', 'yup', 'ya', 'ok', 'okay', 'k', 'sure', 'righto', 'sweet', 'mate', 'cheers',
    'go', 'ahead', 'do', 'it', 'that', 'please', 'pls', 'price', 'up', 'send', 'apply', 'save', 'them', 'both',
    'sounds', 'good', 'perfect', 'great', 'all', 'right', 'alright', 'looks', 'lock', 'in', 'on', 'thanks', 'ta',
    'too', 'those', 'the', 'card', 'cards', 'bonza', 'beauty', 'spot', 'correct', 'right', 'yessir', 'deal',
  ]);
  const STARTS = /^(yes|yep|yeah|yea|yup|ya|ok|okay|k|sure|righto|sweet|go|do|price|send|apply|save|sounds|perfect|great|looks|lock|all|alright|bonza|beauty|spot|correct|deal)$/;
  return STARTS.test(words[0]) && words.every((w) => YES.has(w));
}

/**
 * A card Mate is proposing again while one of the same kind waits and the
 * tradie's last word was just "yes" — the yes was for the waiting card.
 * Sim, 23 Sep 2026: "Yep" to a waiting draft → the same draft re-proposed with
 * one word of the description changed, and the yes was lost.
 */
export function reproposeAfterYes(incoming: import('../../types/assistant').Proposal): boolean {
  const line = latestTradieLineProbe?.() ?? '';
  if (!isBareYes(line)) return false;
  return (pendingCardsProbe?.() ?? []).some((p) => p.id !== incoming.id && p.type === incoming.type);
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
