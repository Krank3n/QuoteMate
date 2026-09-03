// @vitest-environment jsdom
/**
 * The set-total and pick-contact card bodies. The set-total card is the one
 * place the tradie can catch a wrong figure before it lands, so what it shows
 * is pinned: current → target with the GST basis, and what moves — named,
 * never a labour number (the labour figure on the quote rolls markup in),
 * and a discount that reads "-$183.70", not "$-183.70".
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../../theme', () => ({
  makeStyles: () => () => ({}),
  useThemeColors: () => ({}),
}));

import { ProposalCard } from './ProposalCard';
import { registerQuotingProfileSource } from '../../services/assistant/quotingProfileContext';
import type { PickContactProposal, SetTotalProposal } from '../../types/assistant';

const base = { id: 'p1', toolUseId: 't1', createdAt: '' };

function renderCard(proposal: SetTotalProposal | PickContactProposal) {
  render(<ProposalCard proposal={proposal} status="pending" onApply={() => {}} onDismiss={() => {}} />);
}

afterEach(() => registerQuotingProfileSource(() => null));

describe('ProposalCard — set the total', () => {
  it('shows current → target and that the labour takes it, with no labour figure', () => {
    renderCard({
      ...base,
      type: 'propose_set_total',
      quoteId: 'inv-004',
      targetTotal: 1232,
      displayName: 'Switchboard install',
      preview: { currentTotal: 1415.7, mechanism: 'labour', gstMode: 'none' },
    });
    expect(screen.getByText('Switchboard install')).toBeTruthy();
    expect(screen.getByText('$1,415.70 → $1,232.00')).toBeTruthy();
    expect(screen.getByText('Comes out of the labour. Materials stay as they are.')).toBeTruthy();
    expect(screen.getByText('Set it')).toBeTruthy();
  });

  it('names a discount line with the money the right way round, and the GST basis the figures are read in', () => {
    renderCard({
      ...base,
      type: 'propose_set_total',
      quoteId: 'inv-004',
      targetTotal: 600,
      preview: { currentTotal: 803.7, mechanism: 'adjustment', adjustment: -183.7, gstMode: 'exclusive' },
    });
    expect(screen.getByText('$803.70 → $600.00 ex GST')).toBeTruthy();
    expect(screen.getByText('Takes $183.70 off with a "Discount" line. Materials stay as they are.')).toBeTruthy();
    expect(screen.queryByText(/\$-/)).toBeNull();
  });

  it('names a price-adjustment line for money on', () => {
    renderCard({
      ...base,
      type: 'propose_set_total',
      quoteId: 'inv-004',
      targetTotal: 900,
      preview: { currentTotal: 803.7, mechanism: 'adjustment', adjustment: 96.3, gstMode: 'inclusive' },
    });
    expect(screen.getByText('$803.70 → $900.00 inc GST')).toBeTruthy();
    expect(screen.getByText('Adds $96.30 as a "Price adjustment" line. Materials stay as they are.')).toBeTruthy();
  });

  it('still reads sensibly with no preview — the document was not visible to the validator', () => {
    registerQuotingProfileSource(() => ({ businessName: 'x', defaultLaborRate: 90, defaultMarkup: 30, pricesIncludeGst: false, gstRegistered: true }));
    renderCard({ ...base, type: 'propose_set_total', quoteId: 'inv-004', targetTotal: 1232 });
    expect(screen.getByText('New total $1,232.00 ex GST')).toBeTruthy();
    expect(screen.getByText('Labour takes the difference, or a "Price adjustment" line does. Materials stay as they are.')).toBeTruthy();
  });
});

describe('ProposalCard — pick from your contacts', () => {
  it('says what the button does in one line, with the quote it lands on when there is one', () => {
    renderCard({ ...base, type: 'propose_pick_contact', quoteId: 'inv-004', displayName: 'Switchboard install' });
    expect(screen.getByText('Switchboard install')).toBeTruthy();
    expect(screen.getByText("Opens your phone's contacts — whoever you pick gets saved here and goes on this job.")).toBeTruthy();
    expect(screen.getByText('Open contacts')).toBeTruthy();
  });
});
