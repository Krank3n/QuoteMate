// @vitest-environment jsdom
/**
 * Crew costing settings: super (12% unless changed) and other on-costs save
 * as the tradie leaves the field, and a crew member can be marked as a
 * contractor so nothing goes on top of their rate.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

const store = vi.hoisted(() => {
  const state: any = {
    businessSettings: { businessName: 'Rivo Plumbing', crew: [{ id: 'sam', name: 'Sam', costRate: 30, createdAt: 1 }] },
  };
  state.setBusinessSettings = vi.fn(async (next: any) => {
    state.businessSettings = next;
  });
  return state;
});
vi.mock('../../store/useStore', () => {
  const useStore: any = (sel: (s: any) => unknown) => sel(store);
  useStore.getState = () => store;
  return { useStore };
});
vi.mock('../../services/crewLinkService', () => ({ createCrewLink: vi.fn(), revokeCrewLink: vi.fn() }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', async () => {
  const { Text, View } = await import('react-native');
  const TextInput: any = ({ value, onChangeText, onBlur, accessibilityLabel }: any) => (
    <input aria-label={accessibilityLabel} value={value ?? ''} onChange={(e) => onChangeText?.(e.target.value)} onBlur={onBlur} />
  );
  TextInput.Affix = () => null;
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    Surface: View,
    TextInput,
    Button: ({ children, onPress, disabled }: any) => <button onClick={onPress} disabled={disabled}>{children}</button>,
    Switch: ({ value, onValueChange, accessibilityLabel }: any) => (
      <input type="checkbox" aria-label={accessibilityLabel} checked={value} onChange={() => onValueChange(!value)} />
    ),
  };
});
vi.mock('../../components/WebContainer', () => ({ WebContainer: ({ children }: any) => <div>{children}</div> }));
vi.mock('../../components/GridBackground', () => ({ GridBackground: () => null }));
vi.mock('../../components/BottomSheet', async () => {
  const { View } = await import('react-native');
  return { BottomSheet: ({ visible, children }: any) => (visible ? <View>{children}</View> : null) };
});
vi.mock('../../components/AlertModal', () => ({ AlertModal: () => null }));

import { CrewScreen } from './CrewScreen';

beforeEach(() => {
  store.setBusinessSettings.mockClear();
  store.businessSettings = { businessName: 'Rivo Plumbing', crew: [{ id: 'sam', name: 'Sam', costRate: 30, createdAt: 1 }] };
});

describe('what your crew costs', () => {
  it('starts super at 12% and saves on-costs as you leave the field', async () => {
    render(<CrewScreen />);
    expect((screen.getByLabelText('Super percent') as HTMLInputElement).value).toBe('12');
    const onCost = screen.getByLabelText('Other on-costs percent');
    fireEvent.change(onCost, { target: { value: '5%' } });
    fireEvent.blur(onCost);
    await waitFor(() => expect(store.setBusinessSettings).toHaveBeenCalled());
    expect(store.setBusinessSettings.mock.calls[0][0]).toMatchObject({ crewSuperPercent: 12, crewOnCostPercent: 5, businessName: 'Rivo Plumbing' });
  });

  it("won't save a percentage over 100, and says why", async () => {
    render(<CrewScreen />);
    const sup = screen.getByLabelText('Super percent');
    fireEvent.change(sup, { target: { value: '120' } });
    fireEvent.blur(sup);
    expect(await screen.findByText(/0 to 100/)).toBeTruthy();
    expect(store.setBusinessSettings).not.toHaveBeenCalled();
  });

  it('marks someone as a contractor', async () => {
    render(<CrewScreen />);
    fireEvent.click(screen.getByLabelText('Edit Sam'));
    fireEvent.click(screen.getByLabelText('Contractor with an ABN'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(store.setBusinessSettings).toHaveBeenCalled());
    expect(store.setBusinessSettings.mock.calls[0][0].crew[0]).toMatchObject({ id: 'sam', contractor: true, costRate: 30 });
  });
});
