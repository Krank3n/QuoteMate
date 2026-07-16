/**
 * Pure decision logic for the Path B (Square) nudge track — sibling to
 * lifecycleEmails.helpers.ts and dispatched by the same trialLifecycleDaily
 * cron, AFTER the lifecycle verdict (so a user never gets two emails in one
 * morning; lifecycle steps win).
 *
 * Two durable stall states, one send-once email each:
 *
 *   square_connected_idle  connected ≥5 days, never collected a payment —
 *                          "your Pay Now button's ready, put it to work".
 *   square_no_paylink      trial expired, sent quotes, never connected —
 *                          the post-trial "turn on payments" reactivation.
 *                          (Trialing users are NOT nudged here: the
 *                          lifecycle's trial_square_pitch owns that window.)
 *
 * Hard guard: anyone already monetised — billed Pro, bare isPro flag,
 * admin_grant comp, or ≥1 real Square payment — is never nudged to "start
 * collecting".
 */
import { deriveSubFields } from './subscription.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
// Give a fresh connection this long to produce a payment naturally before
// nudging — the opt-in send row and OAuth flow already point the way.
export const IDLE_GRACE_MS = 5 * DAY_MS;

export type SquareNudgeSend = 'square_connected_idle' | 'square_no_paylink';

export interface SquareNudgeEmailState {
  squareIdleNudgeEmailAt?: unknown;
  squareNoPaylinkNudgeEmailAt?: unknown;
}

export const NUDGE_SEND_ONCE_FIELD: Record<SquareNudgeSend, keyof SquareNudgeEmailState> = {
  square_connected_idle: 'squareIdleNudgeEmailAt',
  square_no_paylink: 'squareNoPaylinkNudgeEmailAt',
};

export interface SquareNudgeInput {
  /** Raw subscription doc (users/{uid}/profile/subscription), or null. */
  sub: any;
  emailState?: SquareNudgeEmailState;
  hasSquareConnection: boolean;
  /** ms epoch of the squareConnection doc's connectedAt; null = unknown. */
  connectedAtMs: number | null;
  /** ≥1 real (webhook-written) Square payment — already monetised. */
  hasSquarePayment: boolean;
  /** ≥1 activating (sent) document — see isActivatingDoc. */
  hasSentDoc: boolean;
}

/** Which Square nudge (if any) this user should get right now. */
export function squareNudgeVerdict(input: SquareNudgeInput, now: number): SquareNudgeSend | null {
  const f = deriveSubFields(input.sub, now);

  // Already monetised (either path) → never nudged to start collecting.
  if (f.isPro || input.hasSquarePayment) return null;

  if (input.hasSquareConnection) {
    if (input.emailState?.squareIdleNudgeEmailAt) return null;
    // Unknown connection age counts as old — those docs predate the
    // connectedAt stamp, so the connection is anything but fresh.
    const connectedAgo = input.connectedAtMs === null ? Infinity : now - input.connectedAtMs;
    return connectedAgo >= IDLE_GRACE_MS ? 'square_connected_idle' : null;
  }

  // No connection: only the durable post-trial stall. Trialing users get
  // trial_square_pitch from the lifecycle campaign instead of this.
  if (
    f.tier === 'trial_expired' &&
    input.hasSentDoc &&
    !input.emailState?.squareNoPaylinkNudgeEmailAt
  ) {
    return 'square_no_paylink';
  }

  return null;
}
