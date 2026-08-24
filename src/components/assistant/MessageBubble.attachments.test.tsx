// @vitest-environment jsdom
/**
 * The attachment strip inside a chat bubble. A photo that uploaded, one that's
 * still going up, and one that failed all have to read differently — a broken
 * <Image> tile with no explanation is how a tradie concludes Mate never got
 * their photo and gives up on the feature.
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
import type { ChatAttachment, ChatMessage } from '../../types/assistant';

function att(id: string, extra: Partial<ChatAttachment> = {}): ChatAttachment {
  return { id, status: 'ready', localUri: `file:///${id}.jpg`, storageUrl: `https://s/${id}.jpg`, ...extra };
}

function message(attachments: ChatAttachment[], text = ''): ChatMessage {
  return { id: 'm1', role: 'user', text, createdAt: '', attachments };
}

describe('MessageBubble attachments', () => {
  it('renders one attachment as a single large thumbnail', () => {
    render(<MessageBubble message={message([att('a')])} />);
    expect(screen.getAllByTestId('mate-attachment-single')).toHaveLength(1);
    expect(screen.queryAllByTestId('mate-attachment-thumb')).toHaveLength(0);
  });

  it('renders two side by side', () => {
    render(<MessageBubble message={message([att('a'), att('b')])} />);
    expect(screen.getAllByTestId('mate-attachment-thumb')).toHaveLength(2);
    expect(screen.queryAllByTestId('mate-attachment-single')).toHaveLength(0);
  });

  it('shows a spinner while uploading', () => {
    render(<MessageBubble message={message([att('a', { status: 'uploading', storageUrl: undefined })])} />);
    expect(screen.getAllByTestId('mate-attachment-uploading')).toHaveLength(1);
  });

  it('shows a failed state instead of a broken image', () => {
    render(<MessageBubble message={message([att('a', { status: 'failed' })])} />);
    expect(screen.getAllByTestId('mate-attachment-failed')).toHaveLength(1);
    expect(screen.getByText("Didn't send")).toBeTruthy();
    expect(screen.queryAllByTestId('mate-attachment-single')).toHaveLength(0);
  });

  it('renders the caption under the thumbnail', () => {
    const { container } = render(
      <MessageBubble message={message([att('a')], 'how much to replace this?')} />,
    );
    const caption = screen.getByText('how much to replace this?');
    const thumb = screen.getByTestId('mate-attachment-single');
    expect(container.contains(caption)).toBe(true);
    // DOCUMENT_POSITION_PRECEDING on the thumb means it is painted first.
    expect(caption.compareDocumentPosition(thumb) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});

describe('supplier import card coverage line', () => {
  function saved(coveredRows: number): ChatMessage {
    return {
      id: 'm2', role: 'assistant', text: '', createdAt: '',
      supplierImport: {
        importId: 'i1', phase: 'saved', supplierName: 'Metro Fencing Supplies',
        savedCount: 8, coveredRows,
      },
    };
  }

  it('agrees the verb with a single covered row', () => {
    render(<MessageBubble message={saved(1)} />);
    expect(screen.getByText(/1 row on that quote now prices off your list\./)).toBeTruthy();
  });

  it('agrees the verb with several covered rows', () => {
    render(<MessageBubble message={saved(6)} />);
    expect(screen.getByText(/6 rows on that quote now price off your list\./)).toBeTruthy();
  });
});

// The wait used to render as an empty grey blob plus a second "Mate is
// thinking…" row underneath — two indicators for one event, and the blob read
// as a broken message.
describe('thinking bubble', () => {
  function thinking(label: string, text = ''): ChatMessage {
    return { id: 'm3', role: 'assistant', text, createdAt: '', thinking: label };
  }

  it('renders the activity line instead of an empty bubble', () => {
    render(<MessageBubble message={thinking('Looking up Sam…')} />);
    expect(screen.getByText('Looking up Sam…')).toBeTruthy();
  });

  it('announces itself to a screen reader as a reply in progress', () => {
    render(<MessageBubble message={thinking('Thinking…')} />);
    expect(screen.getByLabelText('Mate is replying')).toBeTruthy();
  });

  it('gives way the moment real text streams in', () => {
    render(<MessageBubble message={thinking('Thinking…', "Righto, here's the go")} />);
    expect(screen.getByText("Righto, here's the go")).toBeTruthy();
    expect(screen.queryByLabelText('Mate is replying')).toBeNull();
  });
});
