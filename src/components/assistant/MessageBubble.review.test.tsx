// @vitest-environment jsdom
/**
 * The flagged-rows list under a "Here's the draft" bubble.
 *
 * The rows used to ride inside the sentence — "6 rows need a look — 2 carrying
 * money that can't be right, 4 estimated. ($2,386.50 of Paper Joint Tape,
 * $1,200.00 of Merbau decking, +3 more)" — which on a phone is a wall of
 * commas. Now each row is its own line: money, name, reason.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../JobScopeCard', () => ({ JobScopeCard: () => null }));
vi.mock('../JobDetailHeader', () => ({ JobDetailHeader: () => null }));
vi.mock('../../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector({ quotes: [], documents: [] }),
}));
vi.mock('../../store/useJobStore', () => ({
  useJobStore: (selector: (s: any) => unknown) => selector({ jobs: [] }),
}));

import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '../../types/assistant';
import type { ChatReviewBlock } from '../../utils/reviewChatFormat';

const block: ChatReviewBlock = {
  headline: '3 rows need a look',
  rows: [
    { amount: '$2,386.50', name: 'Paper Joint Tape', reason: "price can't be right" },
    { amount: '$1,200.00', name: 'Merbau decking board 90x19mm', reason: 'estimated, not a supplier price' },
  ],
  more: 1,
};

function message(over: Partial<ChatMessage>): ChatMessage {
  return { id: 'm1', role: 'assistant', text: "Here's the draft — 3 rows need a look. Tap to open it.", createdAt: '', ...over };
}

describe('MessageBubble review rows', () => {
  it('lists each flagged row on its own line with money, name and reason', () => {
    render(<MessageBubble message={message({ review: block })} />);
    expect(screen.getByText('Rows to check')).toBeTruthy();
    expect(screen.getAllByTestId('mate-review-row')).toHaveLength(2);
    expect(screen.getByText('$2,386.50')).toBeTruthy();
    expect(screen.getByText('Paper Joint Tape')).toBeTruthy();
    expect(screen.getByText("price can't be right")).toBeTruthy();
    expect(screen.getByText('estimated, not a supplier price')).toBeTruthy();
  });

  it('says how many more sit on the quote', () => {
    render(<MessageBubble message={message({ review: block })} />);
    expect(screen.getByText('+1 more on the quote')).toBeTruthy();
  });

  it('keeps the sentence above the list', () => {
    render(<MessageBubble message={message({ review: block })} />);
    expect(screen.getByText("Here's the draft — 3 rows need a look. Tap to open it.")).toBeTruthy();
  });

  it('renders nothing extra when the run came back clean', () => {
    render(<MessageBubble message={message({ review: undefined })} />);
    expect(screen.queryByTestId('mate-review-rows')).toBeNull();
    render(<MessageBubble message={message({ id: 'm2', review: { headline: '', rows: [], more: 0 } })} />);
    expect(screen.queryByTestId('mate-review-rows')).toBeNull();
  });
});
