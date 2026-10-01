// @vitest-environment jsdom
/**
 * Timesheets: a week never shows another week's rows, waiting hours from
 * other weeks aren't lost, and Approve all asks first and reports a partial
 * result — skipping hours the crew changed since they loaded.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import type { TimeEntry } from '../../shared/time/types';
import { addDaysKey, dateKeyDaysAgo, weekStartKey } from '../../shared/time/hours';

const service = vi.hoisted(() => ({
  listRange: vi.fn(),
  listWaiting: vi.fn(),
  approveEntry: vi.fn(async (e: any) => ({ ...e, status: 'approved' })),
  updateEntry: vi.fn(async (e: any) => e),
  deleteEntry: vi.fn(),
}));
vi.mock('../services/timeEntryService', () => ({
  timeEntryService: service,
  StaleEntryError: class StaleEntryError extends Error {},
}));
const state = vi.hoisted(() => ({
  businessSettings: { businessName: 'Rivo Plumbing', crew: [{ id: 'jake', name: 'Jake Smith', createdAt: 1 }] },
  jobs: [{ id: 'deck', name: 'Back deck', customerName: 'Gigar', updatedAt: 1 }],
}));
vi.mock('../store/useStore', () => ({ useStore: (sel: (s: any) => unknown) => sel(state) }));
vi.mock('../store/useJobStore', () => ({ useJobStore: (sel: (s: any) => unknown) => sel(state) }));
vi.mock('@react-navigation/native', async () => {
  const R = await import('react');
  return { useNavigation: () => ({ navigate: vi.fn() }), useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]) };
});
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', async () => {
  const { Text } = await import('react-native');
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    Button: ({ children, onPress, disabled }: any) => <button onClick={onPress} disabled={disabled}>{children}</button>,
  };
});
vi.mock('../components/WebContainer', () => ({ WebContainer: ({ children }: any) => <div>{children}</div> }));
vi.mock('../components/GridBackground', () => ({ GridBackground: () => null }));
vi.mock('../components/TimeEntryEditSheet', () => ({ TimeEntryEditSheet: () => null }));
vi.mock('../components/AlertModal', () => ({
  AlertModal: ({ visible, title, message, primaryButtonText, primaryButtonAction }: any) =>
    visible ? (
      <div>
        <span>{title}</span>
        <span>{message}</span>
        {primaryButtonText ? <button onClick={primaryButtonAction}>{primaryButtonText}</button> : null}
      </div>
    ) : null,
}));

import { TimesheetsScreen } from './TimesheetsScreen';
import { StaleEntryError } from '../services/timeEntryService';

const monday = weekStartKey(dateKeyDaysAgo(0));
const e = (id: string, date: string, hours: number, over: Partial<TimeEntry> = {}): TimeEntry => ({
  id, userId: 'u', jobId: 'deck', date, hours, workerId: 'crew:jake', workerName: 'Jake Smith',
  billable: true, source: 'crew_link', status: 'pending', createdAt: 1, updatedAt: 1, ...over,
});

beforeEach(() => {
  service.listRange.mockReset();
  service.listWaiting.mockReset().mockResolvedValue([]);
  service.approveEntry.mockClear();
});

describe('the Timesheets screen', () => {
  it("shows waiting hours from other weeks, and jumps to that week", async () => {
    const lastWeek = addDaysKey(monday, -3);
    service.listRange.mockResolvedValue([]);
    service.listWaiting.mockResolvedValue([e('old', lastWeek, 8)]);
    render(<TimesheetsScreen />);
    const banner = await screen.findByText(/1 more waiting in other weeks/);
    fireEvent.click(banner);
    await waitFor(() => expect(service.listRange).toHaveBeenLastCalledWith(weekStartKey(lastWeek), addDaysKey(weekStartKey(lastWeek), 6)));
  });

  it("never shows last week's rows under the new week's heading", async () => {
    service.listRange.mockResolvedValueOnce([e('a', monday, 6, { status: undefined })]).mockReturnValueOnce(new Promise(() => {}));
    render(<TimesheetsScreen />);
    await screen.findByText(/Gigar — Back deck/);
    fireEvent.click(screen.getByLabelText('Previous week'));
    await waitFor(() => expect(screen.queryByText(/Gigar — Back deck/)).toBeNull());
  });

  it("shows a person's waiting hours next to their approved total", async () => {
    service.listRange.mockResolvedValue([e('a', monday, 8, { status: undefined }), e('b', monday, 7.5)]);
    render(<TimesheetsScreen />);
    expect(await screen.findByText(/7\.5 h waiting/)).toBeTruthy();
  });

  it('asks before approving everything, then skips hours the crew changed since', async () => {
    service.listRange.mockResolvedValue([e('a', monday, 8), e('b', monday, 4)]);
    service.approveEntry
      .mockImplementationOnce(async (x: any) => ({ ...x, status: 'approved' }))
      .mockRejectedValueOnce(new StaleEntryError('Jake Smith changed those hours just now.'));
    render(<TimesheetsScreen />);
    fireEvent.click(await screen.findByText('Approve all'));
    expect(screen.getByText('Approve 2 entries?')).toBeTruthy();
    expect(service.approveEntry).not.toHaveBeenCalled();
    // The confirm's button — the alert renders after the rows' inline Approves.
    fireEvent.click(screen.getAllByText('Approve').at(-1)!);
    expect(await screen.findByText('Approved 1 of 2')).toBeTruthy();
    expect(screen.getByText(/1 changed on their link/)).toBeTruthy();
  });

  it('names the person when the list is filtered to them', async () => {
    service.listRange.mockResolvedValue([e('a', monday, 8)]);
    render(<TimesheetsScreen />);
    await screen.findByText('Approve all');
    // The filter chip, above the person's heading.
    fireEvent.click(screen.getAllByText('Jake Smith')[0]);
    expect(screen.getByText("Approve Jake's")).toBeTruthy();
  });
});
