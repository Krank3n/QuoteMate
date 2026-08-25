/**
 * Typed "yes" support (25 Aug 2026): the control tools used to exist only in
 * voice, so a typed "go ahead" dead-ended with Mate pointing at the button.
 * The gate pins the waiting card at dispatch time so the text path resolves
 * it like a tap — and tells the model in-turn when nothing is waiting.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { gateControlAction, setPendingProposalProbe } from '../pendingProposalGate';

afterEach(() => setPendingProposalProbe(null));

describe('gateControlAction', () => {
  it('errors with the voice-path copy when no probe is registered', () => {
    const res = gateControlAction();
    expect(res).toEqual({ ok: false, error: 'No card is waiting to confirm.' });
  });

  it('errors with the pinned-card copy when a requested id is gone', () => {
    setPendingProposalProbe(() => null);
    const res = gateControlAction('prop_stale');
    expect(res).toEqual({ ok: false, error: 'That card is no longer waiting.' });
  });

  it('pins the waiting card the probe resolves', () => {
    setPendingProposalProbe((id) =>
      id ? null : { messageId: 'm7', proposalId: 'prop_7' },
    );
    const res = gateControlAction();
    expect(res).toEqual({ ok: true, ref: { messageId: 'm7', proposalId: 'prop_7' } });
  });

  it('passes an explicit proposalId through to the probe', () => {
    let seen: string | undefined;
    setPendingProposalProbe((id) => {
      seen = id;
      return { messageId: 'm1', proposalId: id! };
    });
    const res = gateControlAction('prop_42');
    expect(seen).toBe('prop_42');
    expect(res.ok).toBe(true);
  });
});
