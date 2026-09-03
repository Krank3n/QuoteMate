// @vitest-environment jsdom
/**
 * The working card offers the "tell me when it's done" line only while the
 * run is on the server and still going: a phone-side run dies the moment the
 * phone locks, so promising a notification there would be a lie, and a
 * finished card has nothing left to wait for.
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
vi.mock('./PricingNotifyLine', () => ({
  PricingNotifyLine: () => <span>notify-line</span>,
}));

import { MessageBubble } from './MessageBubble';
import type { ChatMessage, WorkingStatus } from '../../types/assistant';

function working(status: WorkingStatus): ChatMessage {
  return {
    id: 'w1',
    role: 'assistant',
    text: '',
    createdAt: new Date().toISOString(),
    working: status,
  } as ChatMessage;
}

describe('working card notify line', () => {
  it('shows the line while a server run is in flight', () => {
    render(<MessageBubble message={working({ phase: 'pricing', status: 'Pricing 8 items…', done: false, runsOnServer: true })} />);
    expect(screen.getByText('notify-line')).toBeTruthy();
  });

  it('hides it for a phone-side run and once the run is done', () => {
    const { unmount } = render(
      <MessageBubble message={working({ phase: 'pricing', status: 'Pricing 8 items…', done: false })} />,
    );
    expect(screen.queryByText('notify-line')).toBeNull();
    unmount();
    render(
      <MessageBubble message={working({ phase: 'done', status: 'Drafted 8 items.', done: true, runsOnServer: true })} />,
    );
    expect(screen.queryByText('notify-line')).toBeNull();
  });
});
