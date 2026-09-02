// @vitest-environment jsdom
/**
 * The draft card's rate lines show the money that will land on the quote.
 *
 * The apply path converts each line into the document's GST basis; a card
 * that printed the rate as said would have the tradie agreeing to $9,680 and
 * getting $8,800 (or the reverse) — the one screen where they could catch a
 * wrong figure showing a different one.
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
import type { DraftQuoteProposal } from '../../types/assistant';

const draft: DraftQuoteProposal = {
  id: 'p1',
  toolUseId: 't1',
  createdAt: '',
  type: 'propose_draft_quote',
  customerDraft: { name: 'Adam' },
  jobName: 'Patio roof',
  jobDescription: 'Supply and fit a 40 m² colorbond patio roof.',
  rateLines: [{ label: 'Patio roof supply and fit', quantity: 40, unit: 'm²', unitPrice: 220, pricesIncludeGst: false, includesMaterials: true }],
};

function renderCard() {
  render(<ProposalCard proposal={draft} status="pending" onApply={() => {}} onDismiss={() => {}} />);
}

afterEach(() => registerQuotingProfileSource(() => null));

describe('ProposalCard — rate lines', () => {
  it('shows the ex-GST rate as said on an ex-GST business', () => {
    registerQuotingProfileSource(() => ({ businessName: 'x', defaultLaborRate: 85, defaultMarkup: 30, pricesIncludeGst: false, gstRegistered: true }));
    renderCard();
    expect(screen.getByText(/40 m² × \$220\.00 per m² = \$8,800\.00 ex GST/)).toBeTruthy();
    expect(screen.getByText('Priced off your rate card — no materials list, no extra labour.')).toBeTruthy();
  });

  it('shows the converted figure on an inclusive-GST business — the same number the apply path writes', () => {
    registerQuotingProfileSource(() => ({ businessName: 'x', defaultLaborRate: 85, defaultMarkup: 30, pricesIncludeGst: true, gstRegistered: true }));
    renderCard();
    expect(screen.getByText(/40 m² × \$242\.00 per m² = \$9,680\.00 inc GST/)).toBeTruthy();
  });

  it('says nothing about GST, and converts nothing, for a business not registered for it', () => {
    registerQuotingProfileSource(() => ({ businessName: 'x', defaultLaborRate: 85, defaultMarkup: 30, pricesIncludeGst: false, gstRegistered: false }));
    renderCard();
    const line = screen.getByText(/40 m² × \$220\.00 per m² = \$8,800\.00/);
    expect(line.textContent).not.toMatch(/GST/);
  });
});
