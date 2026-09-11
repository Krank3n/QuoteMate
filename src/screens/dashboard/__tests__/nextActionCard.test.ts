/**
 * The dashboard's state-based action card: the key → card/route table, the
 * suppression rules, and the tap behaviour. Pure — no rendering, same shape
 * as doorActions.test.ts next door.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildCard,
  nextActionCard,
  pressNextAction,
  hasSquareEvidence,
  NEXT_ACTION_PAYWALL_SOURCE,
  type NextActionDeps,
  type NextActionDoc,
} from '../nextActionCard';
import type { NextBestAction, NextBestActionKey } from '../../../utils/nextBestAction';

const action = (
  key: NextBestActionKey,
  over: Partial<NextBestAction> = {},
): NextBestAction => ({
  key,
  sellingAllowed: ['continuity_choice', 'fee_comparison', 'keep_pro_tools'].includes(key),
  trialDaysRemaining: null,
  needsSquareConnect: false,
  ...over,
});

const doc = (over: Partial<NextActionDoc> & Pick<NextActionDoc, 'stage'>): NextActionDoc => ({
  id: 'd1',
  jobId: 'j1',
  updatedAt: 1,
  ...over,
});

describe('key → action mapping', () => {
  it('take_deposit opens the accepted, unpaid job', () => {
    const docs = [doc({ stage: 'quote_accepted', id: 'q1', jobId: 'job-a' })];
    const card = buildCard(action('take_deposit'), docs);
    expect(card?.route).toEqual({ screen: 'ViewJob', params: { jobId: 'job-a' } });
    expect(card?.tone).toBe('money');
  });

  // The card names the one step the job screen's primary button will offer
  // on landing (resolveJobActions reads the same depositOwed), so the tradie
  // is never promised one thing and shown another.
  it('take_deposit on an accepted quote names the deposit while one is owed, else the invoice', () => {
    const owing = buildCard(action('take_deposit'), [
      doc({ stage: 'quote_accepted', type: 'quote', depositAmount: 200, depositPaid: 0 }),
    ])!;
    expect(owing.subtitle).toContain('take the deposit');
    expect(owing.subtitle).not.toContain('invoice');

    const depositIn = buildCard(action('take_deposit'), [
      doc({ stage: 'quote_accepted', type: 'quote', depositAmount: 200, depositPaid: 200 }),
    ])!;
    expect(depositIn.subtitle).toContain('create the invoice');
    expect(depositIn.subtitle).not.toContain('deposit');

    const noDeposit = buildCard(action('take_deposit'), [doc({ stage: 'quote_accepted', type: 'quote' })])!;
    expect(noDeposit.subtitle).toContain('create the invoice');
  });

  it('take_deposit on a sent invoice names the payment', () => {
    const invoiced = buildCard(action('take_deposit'), [doc({ stage: 'invoice_sent', type: 'invoice' })])!;
    expect(invoiced.subtitle).toContain('invoice is out');
    expect(invoiced.subtitle).not.toContain('create the invoice');
    const partial = buildCard(action('take_deposit'), [doc({ stage: 'partially_paid', type: 'invoice' })])!;
    expect(partial.subtitle).toContain('invoice is out');
  });

  it('take_deposit lands on the most recent accepted job, not a list', () => {
    const docs = [
      doc({ stage: 'quote_accepted', type: 'quote', id: 'a', jobId: 'job-a', updatedAt: 10 }),
      doc({ stage: 'quote_accepted', type: 'quote', id: 'b', jobId: 'job-b', updatedAt: 20, depositAmount: 50 }),
    ];
    const card = buildCard(action('take_deposit'), docs)!;
    expect(card.route).toEqual({ screen: 'ViewJob', params: { jobId: 'job-b' } });
    expect(card.subtitle).toContain('take the deposit');
  });

  it('take_deposit picks the most recent unpaid job and skips Square-settled ones', () => {
    const docs = [
      doc({
        stage: 'invoice_sent',
        id: 'paid',
        jobId: 'job-paid',
        updatedAt: 99,
        payments: [{ amount: 100, method: 'square' }],
      }),
      doc({ stage: 'quote_accepted', id: 'old', jobId: 'job-old', updatedAt: 1 }),
      doc({ stage: 'invoice_sent', id: 'new', jobId: 'job-new', updatedAt: 50 }),
    ];
    expect(buildCard(action('take_deposit'), docs)?.route.params).toEqual({ jobId: 'job-new' });
  });

  it('create_first_quote points at the quote flow', () => {
    const card = buildCard(action('create_first_quote'), []);
    expect(card?.route).toEqual({ screen: 'Mate', params: { source: 'next_action' } });
  });

  it('send_first_quote opens the newest draft with the send dialog', () => {
    const docs = [
      doc({ stage: 'draft', id: 'old-draft', jobId: 'job-old', updatedAt: 1 }),
      doc({ stage: 'draft', id: 'new-draft', jobId: 'job-new', updatedAt: 9 }),
    ];
    const card = buildCard(action('send_first_quote'), docs);
    expect(card?.route).toEqual({
      screen: 'ViewJob',
      params: { jobId: 'job-new', openSendDocId: 'new-draft' },
    });
  });

  it('follow_up opens the sent quote that is still unanswered', () => {
    const docs = [
      doc({ stage: 'draft', id: 'd', jobId: 'job-draft', updatedAt: 9 }),
      doc({ stage: 'quote_sent', id: 's', jobId: 'job-sent', updatedAt: 5 }),
    ];
    const card = buildCard(action('follow_up'), docs);
    expect(card?.route).toEqual({ screen: 'ViewJob', params: { jobId: 'job-sent' } });
  });

  it('continuity_choice opens the paywall and counts the trial down', () => {
    const card = buildCard(action('continuity_choice', { trialDaysRemaining: 2 }), []);
    expect(card?.route).toEqual({
      screen: 'Paywall',
      params: { source: NEXT_ACTION_PAYWALL_SOURCE },
    });
    expect(card?.title).toBe('Your trial ends in 2 days');
  });

  it('counts the last day in the singular and the final day as today', () => {
    expect(buildCard(action('continuity_choice', { trialDaysRemaining: 1 }), [])?.title).toBe(
      'Your trial ends in 1 day',
    );
    expect(buildCard(action('continuity_choice', { trialDaysRemaining: 0 }), [])?.title).toBe(
      'Your trial ends today',
    );
  });

  it('fee_comparison and keep_pro_tools open the paywall', () => {
    for (const key of ['fee_comparison', 'keep_pro_tools'] as const) {
      expect(buildCard(action(key), [])?.route).toEqual({
        screen: 'Paywall',
        params: { source: NEXT_ACTION_PAYWALL_SOURCE },
      });
    }
  });

  it('complete_via_square opens the Square settings either way, and names the step', () => {
    const connect = buildCard(action('complete_via_square', { needsSquareConnect: true }), []);
    const connected = buildCard(action('complete_via_square'), []);
    expect(connect?.route).toEqual({ screen: 'SquareIntegration' });
    expect(connected?.route).toEqual({ screen: 'SquareIntegration' });
    expect(connect?.subtitle).toContain('Connect Square');
    expect(connected?.subtitle).not.toContain('Connect Square');
  });

  it('none renders nothing', () => {
    expect(nextActionCard(action('none'), [])).toBeNull();
  });
});

describe('nothing to land on', () => {
  it('drops a card whose state cannot be resolved to a job', () => {
    expect(buildCard(action('take_deposit'), [])).toBeNull();
    expect(buildCard(action('send_first_quote'), [])).toBeNull();
    expect(buildCard(action('follow_up'), [])).toBeNull();
    // A draft with no job behind it yet has nowhere to send from.
    expect(buildCard(action('send_first_quote'), [doc({ stage: 'draft', jobId: undefined })])).toBeNull();
  });
});

describe('suppression', () => {
  it('never sells while the selector says selling is not allowed', () => {
    const card = nextActionCard(action('continuity_choice', { sellingAllowed: false }), []);
    expect(card).toBeNull();
  });

  it('stands down when the banner slot above already holds a card', () => {
    const docs = [doc({ stage: 'quote_accepted' })];
    expect(nextActionCard(action('take_deposit'), docs)).not.toBeNull();
    expect(nextActionCard(action('take_deposit'), docs, { slotTaken: true })).toBeNull();
  });

  it('leaves create_first_quote to the quote doors', () => {
    expect(nextActionCard(action('create_first_quote'), [])).toBeNull();
  });

  it('says nothing to a settled account that is already on Square', () => {
    expect(nextActionCard(action('complete_via_square'), [])).toBeNull();
    expect(
      nextActionCard(action('complete_via_square', { needsSquareConnect: true }), []),
    ).not.toBeNull();
  });
});

describe('hasSquareEvidence', () => {
  it('is true on a real Square payment or any minted payment link', () => {
    expect(hasSquareEvidence([doc({ stage: 'paid', payments: [{ method: 'square' }] })])).toBe(true);
    expect(hasSquareEvidence([doc({ stage: 'invoice_sent', squarePaymentLinkUrl: 'https://sq' })])).toBe(true);
    expect(hasSquareEvidence([doc({ stage: 'quote_sent', depositPaymentLinkUrl: 'https://sq' })])).toBe(true);
    expect(hasSquareEvidence([doc({ stage: 'quote_sent', activePaymentLink: { url: 'https://sq' } })])).toBe(true);
  });

  it('is false on manually recorded money — that never went through Square', () => {
    expect(hasSquareEvidence([doc({ stage: 'paid', payments: [{ amount: 100, method: 'cash' }] })])).toBe(false);
    expect(hasSquareEvidence([])).toBe(false);
  });
});

describe('tap', () => {
  let deps: NextActionDeps;
  beforeEach(() => {
    deps = { navigate: vi.fn(), lightTap: vi.fn(), track: vi.fn() };
  });

  it('tracks the action and navigates to its route', () => {
    const card = buildCard(action('take_deposit'), [doc({ stage: 'quote_accepted', jobId: 'job-a' })])!;
    pressNextAction(card, deps);
    expect(deps.track).toHaveBeenCalledWith('next_action_tapped', { action: 'take_deposit' });
    expect(deps.navigate).toHaveBeenCalledWith('ViewJob', { jobId: 'job-a' });
    expect(deps.lightTap).toHaveBeenCalledOnce();
  });

  it('navigates paywall cards with the source that attributes them', () => {
    const card = buildCard(action('fee_comparison'), [])!;
    pressNextAction(card, deps);
    expect(deps.navigate).toHaveBeenCalledWith('Paywall', {
      source: NEXT_ACTION_PAYWALL_SOURCE,
    });
  });
});

describe('copy', () => {
  const keys: NextBestActionKey[] = [
    'take_deposit',
    'create_first_quote',
    'send_first_quote',
    'follow_up',
    'continuity_choice',
    'fee_comparison',
    'keep_pro_tools',
    'complete_via_square',
  ];

  it('never says "AI" and never uses excluded words', () => {
    const docs = [
      doc({ stage: 'quote_accepted', id: 'a', jobId: 'job-a', updatedAt: 3 }),
      doc({ stage: 'draft', id: 'b', jobId: 'job-b', updatedAt: 2 }),
      doc({ stage: 'quote_sent', id: 'c', jobId: 'job-c', updatedAt: 1 }),
    ];
    for (const key of keys) {
      const card = buildCard(action(key, { trialDaysRemaining: 2 }), docs);
      expect(card, key).not.toBeNull();
      const text = `${card!.title} ${card!.subtitle}`;
      expect(text, key).not.toMatch(/\bAI\b/);
      expect(text.toLowerCase(), key).not.toMatch(/\b(blokes|guys|folks|fancy)\b/);
    }
  });
});
