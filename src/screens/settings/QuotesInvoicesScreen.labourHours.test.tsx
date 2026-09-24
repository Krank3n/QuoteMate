// @vitest-environment jsdom
/**
 * Show Labour Hours moved from the PDF Template screen into the customer
 * display defaults (Sep 2026), which now live on Settings → Quotes & Invoices
 * → What the Customer Sees. Pin:
 *  - it hydrates from and saves to `showLaborHours` (same field, no migration);
 *  - it is disabled with a note when "What the customer sees" hides per-line
 *    money, because the PDF builder never prints hours/rate in that mode;
 *  - an unrelated save keeps the stored value (whole-document write).
 *  - the PDF Template screen no longer offers the switch.
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
import { PDFTemplateScreen } from './PDFTemplateScreen';

beforeEach(() => {
  vi.clearAllMocks();
  store.state.businessSettings = {
    businessName: 'Harbour Plumbing',
    defaultLaborRate: 95,
    defaultPriceDetail: 'itemised',
    showLaborHours: true,
  };
});

const labourSwitch = () => screen.getByTestId('show-labour-hours') as HTMLInputElement;

describe('QuotesInvoicesScreen — Show Labour Hours', () => {
  it('sits in What the Customer Sees and hydrates from showLaborHours', () => {
    render(<QuotesInvoicesScreen />);
    expect(screen.getByText('What the Customer Sees')).toBeTruthy();
    expect(screen.getByText('Show Labour Hours')).toBeTruthy();
    expect(labourSwitch().checked).toBe(true);
    expect(labourSwitch().disabled).toBe(false);
  });

  it('saves a change to showLaborHours', async () => {
    render(<QuotesInvoicesScreen />);
    fireEvent.click(labourSwitch());
    expect(labourSwitch().checked).toBe(false);
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(store.state.setBusinessSettings).toHaveBeenCalledWith(
        expect.objectContaining({ showLaborHours: false }),
      ),
    );
  });

  it('keeps the stored value on an unrelated save', async () => {
    render(<QuotesInvoicesScreen />);
    fireEvent.click(screen.getByText('Use starter template'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(store.state.setBusinessSettings).toHaveBeenCalledWith(
        expect.objectContaining({ termsAndConditions: expect.any(String), showLaborHours: true }),
      ),
    );
  });

  it('is disabled with a note when the customer does not see line prices', () => {
    store.state.businessSettings.defaultPriceDetail = 'total';
    render(<QuotesInvoicesScreen />);
    expect(labourSwitch().disabled).toBe(true);
    expect(screen.getByText(/only show when the customer sees line prices/i)).toBeTruthy();
  });

  it('re-enables the moment the detail mode is switched back to itemised', () => {
    store.state.businessSettings.defaultPriceDetail = 'total';
    render(<QuotesInvoicesScreen />);
    expect(labourSwitch().disabled).toBe(true);
    fireEvent.click(screen.getByText('Itemised'));
    expect(labourSwitch().disabled).toBe(false);
  });
});

describe('PDFTemplateScreen — no display toggles', () => {
  it('only picks a style; the labour hours switch lives on Quotes & Invoices', () => {
    render(<PDFTemplateScreen />);
    expect(screen.queryByText('Display Options')).toBeNull();
    expect(screen.queryByText('Show Labour Hours')).toBeNull();
    expect(screen.queryByTestId('show-labour-hours')).toBeNull();
  });
});
