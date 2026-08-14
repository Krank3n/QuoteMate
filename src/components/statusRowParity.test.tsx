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
function renderPillSheet(over: Partial<React.ComponentProps<typeof JobStageSheet>> = {}) {
  const { container } = render(
    <JobStageSheet
      visible
      onDismiss={() => {}}
      job={job}
      primaryDoc={null}
      onSelect={() => {}}
      onSchedule={() => {}}
      {...over}
    />,
  );
  return { container, q: within(container) };
}

function renderKebabSubmenu(over: Partial<React.ComponentProps<typeof JobActionsSheet>> = {}) {
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
      {...over}
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
    for (const label of ['Mark as Scheduled…', 'Mark as Accepted', 'Cancel Job']) {
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

/**
 * Scheduled used to be carved out of the status list entirely, replaced by
 * a "Schedule…" row pinned above the ladder. A tradie scanning for the
 * status they wanted found no Scheduled in the list — and the row that WAS
 * there didn't read as a status at all.
 */
describe('the Scheduled status row', () => {
  it('sits in the ladder, in stage order', () => {
    const icons = iconsAt(renderPillSheet().container, 18);
    const scheduled = icons.indexOf('calendar-clock-outline');
    expect(scheduled).toBeGreaterThan(icons.indexOf('check-circle-outline')); // accepted
    expect(scheduled).toBeLessThan(icons.indexOf('hammer-wrench')); // in progress
  });

  it('opens the date picker rather than flipping the stage on its own', () => {
    // A bare flip would leave the job marked Scheduled with no date on it.
    const onSelect = vi.fn();
    const onSchedule = vi.fn();
    const pill = renderPillSheet({ onSelect, onSchedule });
    fireEvent.click(pill.q.getByText('Mark as Scheduled…'));
    expect(onSchedule).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();

    const onSelectStage = vi.fn();
    const onScheduleFromKebab = vi.fn();
    const kebab = renderKebabSubmenu({ onSelectStage, onSchedule: onScheduleFromKebab });
    fireEvent.click(kebab.q.getByText('Mark as Scheduled…'));
    expect(onScheduleFromKebab).toHaveBeenCalledTimes(1);
    expect(onSelectStage).not.toHaveBeenCalled();
  });

  it('falls back to a plain flip where no picker is wired', () => {
    const onSelect = vi.fn();
    const pill = renderPillSheet({ onSelect, onSchedule: undefined });
    // No ellipsis: nothing further opens, so the label mustn't promise it.
    fireEvent.click(pill.q.getByText('Mark as Scheduled'));
    expect(onSelect).toHaveBeenCalledWith('scheduled');
  });

  it('keeps a door to the date on a job that is already scheduled', () => {
    // The ladder can't offer the stage the job is standing on, and the list
    // screens have no other way into the picker.
    const scheduled = { ...job, stage: 'scheduled' } as Job;

    const fromPill = vi.fn();
    const pill = renderPillSheet({ job: scheduled, onSchedule: fromPill });
    fireEvent.click(pill.q.getByText('Reschedule…'));
    expect(fromPill).toHaveBeenCalledTimes(1);

    const fromKebab = vi.fn();
    const kebab = renderKebabSubmenu({ job: scheduled, onSchedule: fromKebab });
    fireEvent.click(kebab.q.getByText('Reschedule…'));
    expect(fromKebab).toHaveBeenCalledTimes(1);
  });
});
