// @vitest-environment jsdom
/**
 * The picker is where a tradie schedules a job, so it owns the stage that
 * comes out of it. It used to promote only an `accepted` job to Scheduled:
 * pick a day on a job whose quote was merely sent — the ordinary path, the
 * customer rings up and books — and the date saved while the status stayed
 * Quoted. The rule itself lives in scheduleStage; these hold the wiring.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';

import type { Job } from '../../shared/job/types';

const saveJob = vi.fn(async () => {});

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({
  default: ({ name }: { name: string }) => <span data-icon={name} />,
}));
vi.mock('react-native-paper', async () => {
  const { Text } = await import('react-native');
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    // A real <button> so `disabled` is enforced — a Save that shouldn't be
    // tappable must not quietly pass these tests.
    Button: ({
      children,
      onPress,
      disabled,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
    }) => (
      <button onClick={onPress} disabled={disabled}>
        {children}
      </button>
    ),
  };
});
// The real calendar is a native-flavoured month grid; all this test needs
// is the day-press it emits.
/**
 * The picked day must stay in the FUTURE.
 *
 * `handleSaveAndClose` only opens the demote prompt for an in-progress job when
 * `pendingIsInFuture`, so a hardcoded date stops exercising that path the day it
 * goes stale — silently, as a "can't find Keep in Progress" error that reads like
 * a rendering bug. This was pinned to 2026-09-01 and duly started failing on
 * 2026-09-02. Derive it from today instead, so the fixture states the intent.
 */
const pickedDay = vi.hoisted(() => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const iso = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
  return { iso, timestamp: new Date(`${iso}T00:00:00`).getTime() };
});

vi.mock('react-native-calendars', () => ({
  Calendar: ({ onDayPress }: { onDayPress: (d: { dateString: string }) => void }) => (
    <button onClick={() => onDayPress({ dateString: pickedDay.iso })}>pick-day</button>
  ),
}));
// Same shim as the other sheet tests: the real one drags in
// react-native-safe-area-context, which ships untranspiled syntax.
vi.mock('./BottomSheet', async () => {
  const { View } = await import('react-native');
  return {
    BottomSheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      visible ? <View>{children}</View> : null,
  };
});
// Rendered as its two answers, so the demote prompt can be answered.
vi.mock('./AlertModal', () => ({
  AlertModal: ({
    visible,
    primaryButtonText,
    primaryButtonAction,
    secondaryButtonText,
    secondaryButtonAction,
  }: any) =>
    visible ? (
      <div>
        <button onClick={primaryButtonAction}>{primaryButtonText}</button>
        <button onClick={secondaryButtonAction}>{secondaryButtonText}</button>
      </div>
    ) : null,
}));
vi.mock('../hooks/useAlertModal', () => ({
  useAlertModal: () => ({ showAlert: vi.fn(), alertNode: null }),
}));
vi.mock('../utils/haptics', () => ({ selectionTap: vi.fn(), lightTap: vi.fn() }));
vi.mock('../store/useJobStore', () => ({
  useJobStore: (selector: (s: any) => unknown) => selector({ saveJob }),
}));
vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector({ documents: [] }),
}));
vi.mock('../services/googleCalendarAuth', () => ({
  useGoogleCalendarAuth: () => ({ connection: null }),
}));

import { ScheduleJobSheet } from './ScheduleJobSheet';

const baseJob = {
  id: 'job-1',
  stage: 'quoted',
  name: 'Deck rebuild',
  customerName: 'Ana',
  createdAt: 1,
  updatedAt: 1,
} as unknown as Job;

// On site already, being pushed to a later day — the demote prompt's case.
const startedJob = {
  ...baseJob,
  stage: 'in_progress',
  actualStartDate: Date.UTC(2026, 7, 10, 7),
} as unknown as Job;

function renderSheet(job: Job) {
  const { container } = render(
    <ScheduleJobSheet visible onDismiss={() => {}} job={job} />,
  );
  return within(container);
}

beforeEach(() => {
  saveJob.mockClear();
});

describe('ScheduleJobSheet', () => {
  it('picks a day in the future, or the demote prompt below never opens', () => {
    // Guards the fixture itself. If someone re-pins pickedDay to a literal, this
    // fails immediately and by name, instead of the demote tests failing months
    // later with "unable to find Keep in Progress".
    expect(pickedDay.timestamp).toBeGreaterThan(Date.now());
  });

  it('marks a quoted job Scheduled once a date is saved onto it', async () => {
    const q = renderSheet(baseJob);
    fireEvent.click(q.getByText('pick-day'));
    fireEvent.click(q.getByText('Save'));

    await vi.waitFor(() => expect(saveJob).toHaveBeenCalledTimes(1));
    const saved = saveJob.mock.calls[0][0] as unknown as Job;
    expect(saved.stage).toBe('scheduled');
    expect(saved.scheduledStartDate).toBe(pickedDay.timestamp);
  });

  it('leaves a job that is already under way in progress', async () => {
    // Pushing an in-progress job forward asks whether they're coming back
    // to it. "Keep in Progress" must not walk the stage backwards, and the
    // start stamp it earned stays put.
    const q = renderSheet(startedJob);
    fireEvent.click(q.getByText('pick-day'));
    fireEvent.click(q.getByText('Save'));
    fireEvent.click(q.getByText('Keep in Progress'));

    await vi.waitFor(() => expect(saveJob).toHaveBeenCalledTimes(1));
    const saved = saveJob.mock.calls[0][0] as unknown as Job;
    expect(saved.stage).toBe('in_progress');
    expect(saved.actualStartDate).toBe(startedJob.actualStartDate);
  });

  it('drops it back to Scheduled when the tradie says they had not started', async () => {
    const q = renderSheet(startedJob);
    fireEvent.click(q.getByText('pick-day'));
    fireEvent.click(q.getByText('Save'));
    fireEvent.click(q.getByText('Move to Scheduled'));

    await vi.waitFor(() => expect(saveJob).toHaveBeenCalledTimes(1));
    const saved = saveJob.mock.calls[0][0] as unknown as Job;
    expect(saved.stage).toBe('scheduled');
    expect(saved.actualStartDate).toBeUndefined();
  });

  it('drops a scheduled job back to accepted when the date is cleared', async () => {
    const q = renderSheet({
      ...baseJob,
      stage: 'scheduled',
      scheduledStartDate: Date.UTC(2026, 8, 1, 9),
    } as Job);
    fireEvent.click(q.getByText('Clear date'));

    await vi.waitFor(() => expect(saveJob).toHaveBeenCalledTimes(1));
    const saved = saveJob.mock.calls[0][0] as unknown as Job;
    expect(saved.stage).toBe('accepted');
    expect(saved.scheduledStartDate).toBeUndefined();
  });
});
