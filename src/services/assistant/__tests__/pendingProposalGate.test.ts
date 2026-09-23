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

describe('dispatchToolCall — a plain yes vs a named card', () => {
  it('no proposalId → group: the screen confirms same-kind siblings too', async () => {
    const { dispatchToolCall } = await import('../toolDispatcher');
    setPendingProposalProbe(() => ({ messageId: 'm1', proposalId: 'prop_rate_2' }));
    const out = await dispatchToolCall({ name: 'apply_pending_proposal', id: 'c1', args: {} });
    expect(out.control).toEqual({ decision: 'apply', messageId: 'm1', proposalId: 'prop_rate_2', group: true });
  });

  it('a named card is resolved alone', async () => {
    const { dispatchToolCall } = await import('../toolDispatcher');
    setPendingProposalProbe((id) => ({ messageId: 'm1', proposalId: id! }));
    const out = await dispatchToolCall({ name: 'apply_pending_proposal', id: 'c2', args: { proposalId: 'prop_rate_1' } });
    expect(out.control).toEqual({ decision: 'apply', messageId: 'm1', proposalId: 'prop_rate_1' });
  });
});

describe('a card proposed again after a bare yes — the yes was for the waiting card', () => {
  const draftCard = (id: string, description: string) =>
    ({
      id,
      toolUseId: `t_${id}`,
      createdAt: '2026-09-23T03:00:00Z',
      type: 'propose_draft_quote',
      customerDraft: { name: 'Jade Testthree' },
      jobName: 'Colorbond Garden Shed',
      jobDescription: description,
      targetTotal: 9000,
    }) as never;

  afterEach(async () => {
    const gate = await import('../pendingProposalGate');
    gate.setPendingCardsProbe(null);
    gate.setLatestTradieLineProbe(null);
  });

  it('isBareYes: a plain yes, not a yes carrying a change', async () => {
    const { isBareYes } = await import('../pendingProposalGate');
    for (const yes of ['Yep', 'yeah go ahead', 'Sweet, price it up', 'do it', 'yep save both', 'ok']) expect(isBareYes(yes)).toBe(true);
    for (const more of ['yeah but make it 7 by 4', 'no phone yet, go ahead', 'nah', 'yes 9000', '', 'go to the next one mate please now ok']) {
      expect(isBareYes(more)).toBe(false);
    }
  });

  it('refuses the re-proposed draft in-turn and points at apply_pending_proposal (sim: "Yep" → same draft, one word changed)', async () => {
    const gate = await import('../pendingProposalGate');
    const { dispatchToolCall } = await import('../toolDispatcher');
    gate.setPendingCardsProbe(() => [draftCard('waiting', "Supply and install a Colorbond garden shed, 6m x 4m, on the customer's existing concrete slab.")]);
    gate.setLatestTradieLineProbe(() => 'Yep');
    const out = await dispatchToolCall({
      name: 'propose_draft_quote',
      id: 'c3',
      args: {
        customerDraft: { name: 'Jade Testthree' },
        jobName: 'Colorbond Garden Shed',
        jobDescription: "Supply and install a Colorbond garden shed, 6m x 4m, on the customer's existing slab.",
        targetTotal: 9000,
      },
    });
    expect(out.proposal).toBeUndefined();
    expect((out.response as { error: string }).error).toMatch(/apply_pending_proposal/);
  });

  it('a correction goes through — the fresh card replaces the waiting one as before', async () => {
    const gate = await import('../pendingProposalGate');
    const { dispatchToolCall } = await import('../toolDispatcher');
    gate.setPendingCardsProbe(() => [draftCard('waiting', 'Supply and install a Colorbond garden shed, 6m x 4m.')]);
    gate.setLatestTradieLineProbe(() => 'make it 7 by 4');
    const out = await dispatchToolCall({
      name: 'propose_draft_quote',
      id: 'c4',
      args: { customerDraft: { name: 'Jade Testthree' }, jobName: 'Colorbond Garden Shed', jobDescription: 'Supply and install a Colorbond garden shed, 7m x 4m.', targetTotal: 9000 },
    });
    expect(out.proposal).toBeDefined();
  });

  it('an exact copy of a waiting card is refused whatever the tradie said', async () => {
    const gate = await import('../pendingProposalGate');
    const { dispatchToolCall } = await import('../toolDispatcher');
    const args = { customerDraft: { name: 'Jade Testthree' }, jobName: 'Colorbond Garden Shed', jobDescription: 'Supply and install a Colorbond garden shed, 6m x 4m.', targetTotal: 9000 };
    const first = await dispatchToolCall({ name: 'propose_draft_quote', id: 'c5', args });
    gate.setPendingCardsProbe(() => [first.proposal!]);
    gate.setLatestTradieLineProbe(() => 'what colour are the doors?');
    const again = await dispatchToolCall({ name: 'propose_draft_quote', id: 'c6', args });
    expect(again.proposal).toBeUndefined();
  });
});
