// @vitest-environment jsdom
/**
 * The one Settings change the statement needed: where it goes.
 *
 * Business Profile saves with a whole-document write, so a field that is
 * hydrated but not carried into the save spread silently disappears on the
 * next save — which is exactly how the address the SERVER remembers would be
 * lost. Pin both ends: it comes back out of settings, and it goes back in.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../../components/GridBackground', () => ({ GridBackground: () => null }));
vi.mock('../../components/WebContainer', () => ({
  WebContainer: ({ children }: any) => React.createElement('div', null, children),
}));
vi.mock('../../components/BrandImageEditor', () => ({ BrandImageEditor: () => null }));
vi.mock('../../components/AddressSearchInput', () => ({ AddressSearchInput: () => null }));
vi.mock('../../components/AlertModal', () => ({ AlertModal: () => null }));
vi.mock('../../components/ProBadge', () => ({ ProBadge: () => null }));
vi.mock('../../components/FixedBottomButton', () => ({
  FixedBottomButton: ({ label, onPress }: any) => <button onClick={onPress}>{label}</button>,
}));
vi.mock('reanimated-color-picker', () => ({
  default: ({ children }: any) => <div>{children}</div>,
  Panel1: () => null,
  HueSlider: () => null,
}));
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), updateDoc: vi.fn(async () => {}) }));
vi.mock('../../utils/travelCalculator', () => ({ geocodeAddress: vi.fn(async () => null) }));
vi.mock('../../services/squareService', () => ({ checkSquareConnection: vi.fn(async () => false) }));
vi.mock('../../services/photoService', () => ({
  uploadBusinessCredentialLogo: vi.fn(),
  uploadBusinessLogo: vi.fn(),
  uploadAndProcessBusinessLogo: vi.fn(),
}));
vi.mock('../../hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => ({ unsavedModalProps: {} }),
}));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: vi.fn(), setOptions: vi.fn() }),
  useFocusEffect: () => {},
}));

vi.mock('react-native-paper', async () => {
  const { Text, View } = await import('react-native');
  const TextInput = ({ label, value, onChangeText }: any) => (
    <input aria-label={label} value={value} onChange={(e) => onChangeText?.(e.target.value)} />
  );
  return {
    Text,
    Title: ({ children }: any) => React.createElement(Text, null, children),
    Surface: ({ children }: any) => React.createElement(View, null, children),
    IconButton: () => null,
    Switch: () => null,
    TextInput,
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
      businessName: 'Leo Wright Electrical',
      email: 'leo@example.com.au',
      accountantEmail: 'books@accountant.com.au',
    } as any,
    setBusinessSettings: vi.fn(async () => {}),
    subscriptionStatus: { isPro: true } as any,
  },
}));
vi.mock('../../store/useStore', () => ({
  useStore: (selector?: any) => (selector ? selector(store.state) : store.state),
}));

import { BusinessProfileScreen } from './BusinessProfileScreen';

beforeEach(() => vi.clearAllMocks());

describe('BusinessProfileScreen — accountant email', () => {
  it('shows the saved accountant address', () => {
    render(<BusinessProfileScreen />);
    expect(screen.getByDisplayValue('books@accountant.com.au')).toBeTruthy();
  });

  it('carries a changed address into the save', async () => {
    render(<BusinessProfileScreen />);
    fireEvent.change(screen.getByLabelText('Accountant email'), {
      target: { value: 'new@accountant.com.au' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(store.state.setBusinessSettings).toHaveBeenCalledWith(
        expect.objectContaining({ accountantEmail: 'new@accountant.com.au' }),
      ),
    );
  });

  it('keeps the remembered address on an unrelated save', async () => {
    render(<BusinessProfileScreen />);
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0400 111 222' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(store.state.setBusinessSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '0400 111 222',
          accountantEmail: 'books@accountant.com.au',
        }),
      ),
    );
  });
});
