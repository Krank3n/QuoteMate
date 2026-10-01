// @vitest-environment jsdom
/**
 * The Log time sheet: log hours on a job, edit or delete what's there, and
 * see logged against quoted. Firestore is replaced by a mocked service so
 * these pin the wiring — what the sheet hands the service, and when it lets
 * the tradie save at all.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

import type { Job } from '../../shared/job/types';
import type { TimeEntry } from '../../shared/time/types';
import { dateKeyDaysAgo } from '../../shared/time/hours';

const service = vi.hoisted(() => ({
  createEntry: vi.fn(async (input: any) => input),
  updateEntry: vi.fn(async (entry: any) => entry),
  approveEntry: vi.fn(async (entry: any) => ({ ...entry, status: 'approved' })),
  deleteEntry: vi.fn(async () => {}),
}));
vi.mock('../services/timeEntryService', () => ({ timeEntryService: service }));

// The business settings the sheet reads its crew from.
const settings = vi.hoisted(() => ({ current: { businessName: 'Rivo Plumbing', crew: [] as any[] } }));
vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector({ businessSettings: settings.current }),
}));

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', async () => {
  const { Text } = await import('react-native');
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    Button: ({ children, onPress, disabled }: any) => (
      <button onClick={onPress} disabled={disabled}>
        {children}
      </button>
    ),
    TextInput: ({ value, onChangeText, accessibilityLabel }: any) => (
      <input aria-label={accessibilityLabel} value={value ?? ''} onChange={(e) => onChangeText?.(e.target.value)} />
    ),
    Switch: ({ value, onValueChange }: any) => (
      <input type="checkbox" aria-label="Charge for this time" checked={value} onChange={() => onValueChange(!value)} />
    ),
  };
});
vi.mock('react-native-calendars', () => ({
  Calendar: ({ onDayPress }: any) => (
    <button onClick={() => onDayPress({ dateString: '2026-09-02' })}>pick-day</button>
  ),
}));
vi.mock('./BottomSheet', async () => {
  const { View, Text } = await import('react-native');
  return {
    BottomSheet: ({ visible, title, children }: any) =>
      visible ? (
        <View>
          <Text>{title}</Text>
          {children}
        </View>
      ) : null,
  };
});
vi.mock('./AlertModal', () => ({
  AlertModal: ({ visible, title, primaryButtonText, primaryButtonAction, secondaryButtonText, secondaryButtonAction }: any) =>
    visible ? (
      <div>
        <span>{title}</span>
        <button onClick={primaryButtonAction}>{primaryButtonText}</button>
        <button onClick={secondaryButtonAction}>{secondaryButtonText}</button>
      </div>
    ) : null,
}));

import { LogTimeSheet } from './LogTimeSheet';

const job = { id: 'job-1', name: 'Back deck' } as Job;
const quote = { id: 'q-1', laborRate: 100, laborHours: 10, laborUnit: 'hours' } as any;

const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: 'e1',
  userId: 'u1',
  jobId: 'job-1',
  date: dateKeyDaysAgo(1),
  hours: 6,
  workerId: 'u1',
  billable: true,
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

function renderSheet(entries: TimeEntry[] = []) {
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  const onDismiss = vi.fn();
  render(
    <LogTimeSheet
      visible
      onDismiss={onDismiss}
      job={job}
      primaryDoc={quote}
      entries={entries}
      onSaved={onSaved}
      onDeleted={onDeleted}
      workerName="Rivo Plumbing"
    />,
  );
  return { onSaved, onDeleted, onDismiss };
}

beforeEach(() => {
  settings.current = { businessName: 'Rivo Plumbing', crew: [] };
  service.approveEntry.mockClear();
  service.createEntry.mockClear();
  service.updateEntry.mockClear();
  service.deleteEntry.mockClear();
});

describe('logging time', () => {
  it('logs typed hours for today against the job and its quote, then closes', async () => {
    const { onSaved, onDismiss } = renderSheet();
    fireEvent.change(screen.getByLabelText('Hours worked'), { target: { value: '7.5' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'rough-in' } });
    fireEvent.click(screen.getByText('Log 7.5 h'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onDismiss).toHaveBeenCalled();
    expect(service.createEntry).toHaveBeenCalledWith({
      jobId: 'job-1',
      documentId: 'q-1',
      date: dateKeyDaysAgo(0),
      hours: 7.5,
      note: 'rough-in',
      billable: true,
      workerName: 'Rivo Plumbing',
      source: 'manual',
    });
  });

  it('logs yesterday, a quick-pick amount, and not-charged time', async () => {
    renderSheet();
    fireEvent.click(screen.getByText('Yesterday'));
    fireEvent.click(screen.getByText('4h'));
    fireEvent.click(screen.getByLabelText('Charge for this time'));
    fireEvent.click(screen.getByText('Log 4 h'));
    await waitFor(() => expect(service.createEntry).toHaveBeenCalled());
    expect(service.createEntry.mock.calls[0][0]).toMatchObject({ date: dateKeyDaysAgo(1), hours: 4, billable: false });
  });

  it('picks another day off the calendar', async () => {
    renderSheet();
    fireEvent.click(screen.getByText('Other day'));
    fireEvent.click(screen.getByText('pick-day'));
    fireEvent.click(screen.getByText('8h'));
    fireEvent.click(screen.getByText('Log 8 h'));
    await waitFor(() => expect(service.createEntry).toHaveBeenCalled());
    expect(service.createEntry.mock.calls[0][0].date).toBe('2026-09-02');
  });

  it("won't save blank or impossible hours, and says why", () => {
    renderSheet();
    expect((screen.getByText('Log time', { selector: 'button' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Hours worked'), { target: { value: '30' } });
    expect((screen.getByText('Log time', { selector: 'button' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/up to 24/)).toBeTruthy();
  });
});

describe('what is already logged', () => {
  it('shows logged against quoted, and flags an overrun', () => {
    renderSheet([entry({ hours: 8 }), entry({ id: 'e2', hours: 4, date: dateKeyDaysAgo(0) })]);
    expect(screen.getByText('12 h logged · 10 h quoted')).toBeTruthy();
    expect(screen.getByText('Today · 4 h')).toBeTruthy();
    expect(screen.getByText('Yesterday · 8 h')).toBeTruthy();
  });

  it('counts not-charged time separately', () => {
    renderSheet([entry({ hours: 8 }), entry({ id: 'e2', hours: 2, billable: false })]);
    expect(screen.getByText('10 h logged · 10 h quoted · 2 h not charged')).toBeTruthy();
  });

  it('tapping an entry edits it in place, and the sheet stays open', async () => {
    const { onSaved, onDismiss } = renderSheet([entry({ note: 'framing' })]);
    fireEvent.click(screen.getByLabelText(/Edit 6 h on Yesterday/));
    expect(screen.getByText('Edit time')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Hours worked'), { target: { value: '6.5' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onDismiss).not.toHaveBeenCalled();
    expect(service.createEntry).not.toHaveBeenCalled();
    expect(service.updateEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', hours: 6.5, note: 'framing' }));
  });

  it('deleting asks first, naming the time, then removes it', async () => {
    const { onDeleted } = renderSheet([entry()]);
    fireEvent.click(screen.getByLabelText('Delete entry'));
    expect(screen.getByText('Delete 6 h from yesterday?')).toBeTruthy();
    expect(service.deleteEntry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(service.deleteEntry).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('e1'));
  });

  it('a failed delete says so, and keeps the entry', async () => {
    service.deleteEntry.mockRejectedValueOnce(new Error('No signal'));
    const { onDeleted } = renderSheet([entry()]);
    fireEvent.click(screen.getByLabelText('Delete entry'));
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(screen.getByText("Couldn't delete that")).toBeTruthy());
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe('crew', () => {
  const crew = [
    { id: 'c1', name: 'Jake', createdAt: 1 },
    { id: 'c2', name: 'Old mate', createdAt: 1, archived: true },
  ];

  it('asks who worked it only when there is a crew', () => {
    renderSheet();
    expect(screen.queryByText('Who worked it')).toBeNull();
  });

  it("logs time against a crew member, under their name", async () => {
    settings.current = { businessName: 'Rivo Plumbing', crew };
    renderSheet();
    expect(screen.getByText('Who worked it')).toBeTruthy();
    expect(screen.queryByText('Old mate')).toBeNull();
    fireEvent.click(screen.getByText('Jake'));
    fireEvent.click(screen.getByText('8h'));
    fireEvent.click(screen.getByText('Log 8 h'));
    await waitFor(() => expect(service.createEntry).toHaveBeenCalled());
    expect(service.createEntry.mock.calls[0][0]).toMatchObject({ crewMemberId: 'c1', workerName: 'Jake', hours: 8 });
  });

  it('shows sent-in time apart, counts none of it, and approves it on a tap', async () => {
    settings.current = { businessName: 'Rivo Plumbing', crew };
    const { onSaved } = renderSheet([
      entry({ id: 'mine', hours: 4 }),
      entry({ id: 'sent', hours: 7, workerId: 'crew:c1', status: 'pending', source: 'crew_link', note: 'Framing' }),
    ]);
    expect(screen.getByText('Sent in — waiting for you')).toBeTruthy();
    expect(screen.getByText('4 h logged · 10 h quoted · 1 waiting for you')).toBeTruthy();
    expect(screen.getByText(/Jake · .* · 7 h/)).toBeTruthy();
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'sent', status: 'approved' })));
  });
});
