// @vitest-environment jsdom
/**
 * Settings → Quotes & Invoices → Extra Quote Section: the tradie's standing block printed
 * on every quote after the T&Cs (asked for as "Preferred trades"). Pin:
 *  - collapsed to one "Add a section" button until used;
 *  - hydrates from and saves to extraSectionTitle / extraSectionBody;
 *  - Remove clears both, and a heading with no body isn't kept.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('expo-print', () => ({ printAsync: vi.fn() }));
vi.mock('expo-haptics', () => ({ impactAsync: vi.fn(), notificationAsync: vi.fn(), selectionAsync: vi.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
vi.mock('../../components/GridBackground', () => ({ GridBackground: () => null }));
vi.mock('../../components/WebContainer', () => ({
  WebContainer: ({ children }: any) => React.createElement('div', null, children),
}));
vi.mock('../../components/AlertModal', () => ({ AlertModal: () => null }));
vi.mock('../../components/ProBadge', () => ({ ProBadge: () => null }));
vi.mock('../../components/FixedBottomButton', () => ({
  FixedBottomButton: ({ label, onPress }: any) => <button onClick={onPress}>{label}</button>,
}));
vi.mock('react-native-keyboard-controller', () => ({
  KeyboardAwareScrollView: ({ children }: any) => React.createElement('div', null, children),
}));
vi.mock('../../services/squareService', () => ({
  checkSquareConnection: vi.fn(async () => ({ connected: false })),
}));
vi.mock('../../utils/pdfGenerator', () => ({ prepareLogoHtml: vi.fn(async () => '') }));
vi.mock('../../hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => ({ unsavedModalProps: {} }),
}));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: vi.fn(), setOptions: vi.fn() }),
  useFocusEffect: () => {},
}));

vi.mock('react-native-paper', async () => {
  const { Text, View } = await import('react-native');
  return {
    Text,
    Title: ({ children }: any) => React.createElement(Text, null, children),
    Surface: ({ children }: any) => React.createElement(View, null, children),
    IconButton: () => null,
    SegmentedButtons: () => null,
    TextInput: ({ label, value, onChangeText }: any) => (
      <input aria-label={label} value={value} onChange={(e) => onChangeText?.(e.target.value)} />
    ),
    Switch: ({ value, onValueChange, disabled, testID }: any) => (
      <input
        type="checkbox"
        data-testid={testID}
        checked={!!value}
        disabled={!!disabled}
        onChange={(e) => onValueChange?.(e.target.checked)}
      />
    ),
    Button: ({ children, onPress, disabled }: any) => (
      <button onClick={onPress} disabled={disabled}>
        {children}
      </button>
    ),
  };
});

const store = vi.hoisted(() => ({
  state: {
    businessSettings: {
      businessName: 'Harbour Plumbing',
      defaultLaborRate: 95,
      defaultPriceDetail: 'itemised',
      showLaborHours: true,
    } as any,
    setBusinessSettings: vi.fn(async () => {}),
    subscriptionStatus: { isPro: true } as any,
  },
}));
vi.mock('../../store/useStore', () => ({
  useStore: (selector?: any) => (selector ? selector(store.state) : store.state),
}));

import { QuotesInvoicesScreen } from './QuotesInvoicesScreen';

const base = {
  businessName: 'Lakeside Painting',
  defaultLaborRate: 95,
  defaultPriceDetail: 'itemised',
};

beforeEach(() => {
  vi.clearAllMocks();
  store.state.businessSettings = { ...base };
});

const saved = () => (store.state.setBusinessSettings.mock.calls.at(-1) as any)[0];

describe('QuotesInvoicesScreen — Extra Quote Section', () => {
  it('starts collapsed behind one button', () => {
    render(<QuotesInvoicesScreen />);
    expect(screen.getByText('Extra Quote Section')).toBeTruthy();
    expect(screen.getByText('Add a section')).toBeTruthy();
    expect(screen.queryByLabelText('Heading')).toBeNull();
  });

  it('saves a new heading and body', async () => {
    render(<QuotesInvoicesScreen />);
    fireEvent.click(screen.getByText('Add a section'));
    fireEvent.change(screen.getByLabelText('Heading'), { target: { value: ' Preferred trades ' } });
    fireEvent.change(screen.getByLabelText('What to show'), {
      target: { value: 'Smith Plastering 0400 123 456\n' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(store.state.setBusinessSettings).toHaveBeenCalled());
    expect(saved()).toMatchObject({
      extraSectionTitle: 'Preferred trades',
      extraSectionBody: 'Smith Plastering 0400 123 456',
    });
  });

  it('hydrates an existing section open, and keeps it on an unrelated save', async () => {
    store.state.businessSettings = {
      ...base,
      extraSectionTitle: 'Preferred trades',
      extraSectionBody: 'Smith Plastering 0400 123 456',
    };
    render(<QuotesInvoicesScreen />);
    expect((screen.getByLabelText('Heading') as HTMLInputElement).value).toBe('Preferred trades');
    fireEvent.click(screen.getByText('Use starter template'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(store.state.setBusinessSettings).toHaveBeenCalled());
    expect(saved()).toMatchObject({
      termsAndConditions: expect.any(String),
      extraSectionTitle: 'Preferred trades',
      extraSectionBody: 'Smith Plastering 0400 123 456',
    });
  });

  it('Remove clears both fields on save', async () => {
    store.state.businessSettings = {
      ...base,
      extraSectionTitle: 'Preferred trades',
      extraSectionBody: 'Smith Plastering 0400 123 456',
    };
    render(<QuotesInvoicesScreen />);
    fireEvent.click(screen.getAllByText('Remove').at(-1)!);
    expect(screen.getByText('Add a section')).toBeTruthy();
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(store.state.setBusinessSettings).toHaveBeenCalled());
    expect(saved().extraSectionTitle).toBeUndefined();
    expect(saved().extraSectionBody).toBeUndefined();
  });

  it('does not keep a heading with no body', async () => {
    render(<QuotesInvoicesScreen />);
    fireEvent.click(screen.getByText('Add a section'));
    fireEvent.change(screen.getByLabelText('Heading'), { target: { value: 'Preferred trades' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(store.state.setBusinessSettings).toHaveBeenCalled());
    expect(saved().extraSectionTitle).toBeUndefined();
    expect(saved().extraSectionBody).toBeUndefined();
  });
});
