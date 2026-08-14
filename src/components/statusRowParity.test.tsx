// @vitest-environment jsdom
/**
 * Three doors change a status: the card's timeline pill (JobStageSheet),
 * the kebab's "Change status" submenu (JobActionsSheet), and the document
 * sheet on ViewJob's scope rows (StageSheet). They were built separately,
 * so the two sheets opened chunky 42px icon-circle rows with chevrons while
 * the kebab listed compact icon+label rows — the same action wearing two
 * different faces.
 *
 * All three now render StageOptionRow. These tests hold that: same options,
 * same row, and none of the old chunky treatment left on the sheets.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';

// Icons carry the assertion: every StageOptionRow renders exactly one icon
// at size 18, so a size-18 sweep of the tree is the rendered option list.
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({
  default: ({ name, size }: { name: string; size: number }) => (
    <span data-icon={name} data-size={String(size)} />
  ),
}));
vi.mock('react-native-paper', async () => {
  const { Text } = await import('react-native');
  return { MD3DarkTheme: { colors: {} }, Text };
});
// The real sheet drags in react-native-safe-area-context, which ships
// untranspiled syntax vitest can't parse. Same shim as JobCard.ghost.test.
vi.mock('./BottomSheet', async () => {
  const { View, Animated } = await import('react-native');
  return {
    BottomSheet: ({
      visible,
      children,
      title,
      subtitle,
    }: {
      visible: boolean;
      children?: React.ReactNode;
      title?: string;
      subtitle?: string;
    }) =>
      visible ? (
        <View>
          <span>{title}</span>
          <span>{subtitle}</span>
          {children}
        </View>
      ) : null,
    useStaggeredEntrance: (count: number) =>
      Array.from({ length: count }, () => new Animated.Value(1)),
  };
});
vi.mock('../utils/haptics', () => ({ selectionTap: vi.fn(), lightTap: vi.fn() }));

import { JobStageSheet } from './JobStageSheet';
import { JobActionsSheet } from './JobActionsSheet';
import { StageSheet } from './StageSheet';
import type { Job } from '../../shared/job/types';
import type { Document } from '../types/document';

const job = {
  id: 'job-1',
  stage: 'quoted',
  name: 'Deck rebuild',
  customerName: 'Ana',
  createdAt: 1,
  updatedAt: 1,
} as unknown as Job;

const doc = {
  id: 'doc-1',
  jobId: 'job-1',
  type: 'quote',
  stage: 'quote_sent',
} as unknown as Document;

/** The icons rendered at a given size, in document order. */
function iconsAt(container: HTMLElement, size: number): (string | null)[] {
  return Array.from(container.querySelectorAll(`[data-size="${size}"]`)).map((el) =>
    el.getAttribute('data-icon'),
  );
}

// Both doors are mounted in the same document by the parity tests, and they
// deliberately share wording — so every query is scoped to its own container.
function renderPillSheet() {
  const { container } = render(
    <JobStageSheet
      visible
      onDismiss={() => {}}
      job={job}
      primaryDoc={null}
      onSelect={() => {}}
      onSchedule={() => {}}
    />,
  );
  return { container, q: within(container) };
}

function renderKebabSubmenu() {
  const { container } = render(
    <JobActionsSheet
      visible
      onDismiss={() => {}}
      job={job}
      primaryDoc={null}
      xeroConnected={false}
      onSelect={() => {}}
      onSelectStage={() => {}}
      onSchedule={() => {}}
    />,
  );
  const q = within(container);
  // The submenu is collapsed until the row is tapped.
  fireEvent.click(q.getByText('Change status'));
  return { container, q };
}

describe('status change UI parity', () => {
  it('offers the same options through both doors', () => {
    const pill = renderPillSheet();
    const kebab = renderKebabSubmenu();

    // No primary doc, so neither door offers the document-level
    // "Convert to invoice…" / "Back to a quote…" rows the kebab adds when
    // one is attached — what's left is the status list itself.
    expect(iconsAt(pill.container, 18)).toEqual(iconsAt(kebab.container, 18));
    expect(iconsAt(pill.container, 18)).toContain('calendar-clock-outline');
    expect(iconsAt(pill.container, 18).length).toBeGreaterThan(1);
  });

  it('renders both option lists on the shared compact row', () => {
    const pill = renderPillSheet();
    const kebab = renderKebabSubmenu();

    // Every option in the pill's sheet is a size-18 shared row: nothing is
    // left over at another size, and the labels match the submenu's wording.
    const optionIcons = iconsAt(pill.container, 18);
    expect(iconsAt(pill.container, 22)).toEqual([]);
    expect(optionIcons).not.toContain('chevron-right');
    for (const label of ['Schedule…', 'Mark as Accepted', 'Cancel Job']) {
      expect(pill.q.getByText(label)).toBeTruthy();
      expect(kebab.q.getByText(label)).toBeTruthy();
    }
    expect(optionIcons.length).toBeGreaterThan(1);
  });

  it('names the current status the way the kebab does', () => {
    const pill = renderPillSheet();
    expect(pill.q.getByText('Change status')).toBeTruthy();
    expect(pill.q.getByText('Currently Quoted')).toBeTruthy();
  });

  it('puts the document sheet on the same row', () => {
    const { container } = render(
      <StageSheet visible onDismiss={() => {}} doc={doc} onSelect={() => {}} />,
    );
    const q = within(container);

    // Every option is a size-18 shared row — no icon circles, no chevrons.
    expect(iconsAt(container, 18).length).toBeGreaterThan(1);
    expect(iconsAt(container, 22)).toEqual([]);
    expect(iconsAt(container, 18)).not.toContain('chevron-right');
    expect(q.getByText('Change status')).toBeTruthy();
    expect(q.getByText('Currently Quote sent')).toBeTruthy();
    expect(q.getByText('Mark as Accepted')).toBeTruthy();
  });

  it('names what the cancel row cancels', () => {
    // Bare "Cancel" at the foot of a sheet reads as "dismiss", not "cancel
    // the quote" — the chunky red icon circle used to carry that meaning.
    const quote = render(
      <StageSheet visible onDismiss={() => {}} doc={doc} onSelect={() => {}} />,
    );
    expect(within(quote.container).getByText('Cancel Quote')).toBeTruthy();
    expect(within(quote.container).queryByText('Cancel')).toBeNull();

    const invoice = render(
      <StageSheet
        visible
        onDismiss={() => {}}
        doc={{ ...doc, type: 'invoice', stage: 'invoice_sent' } as unknown as Document}
        onSelect={() => {}}
      />,
    );
    expect(within(invoice.container).getByText('Cancel Invoice')).toBeTruthy();
  });

  it('still fires the stage the tradie picked', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <JobStageSheet
        visible
        onDismiss={() => {}}
        job={job}
        primaryDoc={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(within(container).getByText('Mark as Accepted'));
    expect(onSelect).toHaveBeenCalledWith('accepted');
  });
});
