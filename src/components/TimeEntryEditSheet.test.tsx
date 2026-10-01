// @vitest-environment jsdom
/**
 * The owner can change anything about an entry — who, job, day, hours, note,
 * charged — and approves waiting crew time from the same sheet.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import type { TimeEntry } from '../../shared/time/types';

const service = vi.hoisted(() => ({
  updateEntry: vi.fn(async (entry: any) => entry),
  deleteEntry: vi.fn(async () => {}),
}));
vi.mock('../services/timeEntryService', () => ({
  timeEntryService: service,
  StaleEntryError: class StaleEntryError extends Error {},
}));
const state = vi.hoisted(() => ({
  businessSettings: { businessName: 'Rivo Plumbing', crew: [{ id: 'jake', name: 'Jake', createdAt: 1 }, { id: 'amy', name: 'Amy', createdAt: 1 }] },
  jobs: [
    { id: 'deck', name: 'Back deck', customerName: 'Gigar', primaryDocumentId: 'q-deck', updatedAt: 2 },
    { id: 'fence', name: 'Side fence', customerName: 'Karl', primaryDocumentId: 'q-fence', updatedAt: 1 },
  ],
}));
vi.mock('../store/useStore', () => ({ useStore: (sel: (s: any) => unknown) => sel(state) }));
vi.mock('../store/useJobStore', () => ({ useJobStore: (sel: (s: any) => unknown) => sel(state) }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', async () => {
  const { Text } = await import('react-native');
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    Button: ({ children, onPress, disabled }: any) => <button onClick={onPress} disabled={disabled}>{children}</button>,
    TextInput: ({ value, onChangeText, accessibilityLabel, placeholder }: any) => (
      <input aria-label={accessibilityLabel || placeholder} value={value ?? ''} onChange={(e) => onChangeText?.(e.target.value)} />
    ),
    Switch: ({ value, onValueChange, accessibilityLabel }: any) => (
      <input type="checkbox" aria-label={accessibilityLabel} checked={value} onChange={() => onValueChange(!value)} />
    ),
  };
});
vi.mock('react-native-calendars', () => ({
  Calendar: ({ onDayPress }: any) => <button onClick={() => onDayPress({ dateString: '2026-09-21' })}>pick-day</button>,
}));
vi.mock('./BottomSheet', async () => {
  const { View, Text } = await import('react-native');
  return { BottomSheet: ({ visible, title, children }: any) => (visible ? <View><Text>{title}</Text>{children}</View> : null) };
});
vi.mock('./AlertModal', () => ({
  AlertModal: ({ visible, title, primaryButtonText, primaryButtonAction }: any) =>
    visible ? <div><span>{title}</span><button onClick={primaryButtonAction}>{primaryButtonText}</button></div> : null,
}));

import { TimeEntryEditSheet } from './TimeEntryEditSheet';

const waiting: TimeEntry = {
  id: 'w1', userId: 'owner', jobId: 'deck', documentId: 'q-deck', date: '2026-09-30', hours: 7, note: 'Frame',
  workerId: 'crew:jake', workerName: 'Jake', status: 'pending', billable: true, source: 'crew_link', createdAt: 1, updatedAt: 1,
};

function renderSheet(entry: TimeEntry) {
  const onSaved = vi.fn(); const onDeleted = vi.fn(); const onDismiss = vi.fn();
  render(<TimeEntryEditSheet entry={entry} onDismiss={onDismiss} onSaved={onSaved} onDeleted={onDeleted} />);
  return { onSaved, onDeleted, onDismiss };
}

beforeEach(() => { service.updateEntry.mockClear(); service.deleteEntry.mockClear(); });

describe('editing a time entry', () => {
  it('approves waiting crew time, with any changes made first', async () => {
    const { onSaved } = renderSheet(waiting);
    expect(screen.getByText('Sent in — waiting for you')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Hours worked'), { target: { value: '6.5' } });
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(service.updateEntry.mock.calls[0][0]).toMatchObject({ id: 'w1', hours: 6.5, status: 'approved', workerId: 'crew:jake' });
  });

  it('approves against the copy it loaded, so a crew change since is caught', async () => {
    renderSheet(waiting);
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(service.updateEntry).toHaveBeenCalled());
    expect(service.updateEntry.mock.calls[0][1]).toBe(waiting);
  });

  it('crew changed it on their link: says so, reloads, and leaves the sheet up until OK', async () => {
    const { StaleEntryError } = await import('../services/timeEntryService');
    service.updateEntry.mockRejectedValueOnce(new StaleEntryError('Jake changed those hours just now.'));
    const onStale = vi.fn(); const onSaved = vi.fn(); const onDismiss = vi.fn();
    render(<TimeEntryEditSheet entry={waiting} onDismiss={onDismiss} onSaved={onSaved} onDeleted={vi.fn()} onStale={onStale} />);
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(screen.getByText('Those hours just changed')).toBeTruthy());
    expect(onStale).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('OK'));
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });

  it('"Save, keep waiting" never approves', async () => {
    renderSheet(waiting);
    fireEvent.click(screen.getByText('Save, keep waiting'));
    await waitFor(() => expect(service.updateEntry).toHaveBeenCalled());
    expect(service.updateEntry.mock.calls[0][0].status).toBe('pending');
  });

  it('changes who, job, day, note and charging in one save', async () => {
    renderSheet({ ...waiting, status: undefined });
    fireEvent.click(screen.getByText('Amy'));
    fireEvent.click(screen.getByLabelText(/Job: Gigar — Back deck/));
    fireEvent.click(screen.getByText('Karl — Side fence'));
    fireEvent.click(screen.getByLabelText(/^Day: /));
    fireEvent.click(screen.getByText('pick-day'));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Gate' } });
    fireEvent.click(screen.getByLabelText('Charge for this time'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(service.updateEntry).toHaveBeenCalled());
    expect(service.updateEntry.mock.calls[0][0]).toMatchObject({
      workerId: 'crew:amy', workerName: 'Amy', jobId: 'fence', documentId: 'q-fence', date: '2026-09-21', note: 'Gate', billable: false,
    });
  });

  it("moving Jake's time to you puts it under the owner", async () => {
    renderSheet({ ...waiting, status: undefined });
    fireEvent.click(screen.getByText('You'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(service.updateEntry).toHaveBeenCalled());
    expect(service.updateEntry.mock.calls[0][0]).toMatchObject({ workerId: 'owner', workerName: 'Rivo Plumbing' });
  });

  it('deletes after asking', async () => {
    const { onDeleted } = renderSheet(waiting);
    fireEvent.click(screen.getAllByText('Delete')[0]);
    fireEvent.click(screen.getAllByText('Delete').slice(-1)[0]);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('w1'));
  });
});
