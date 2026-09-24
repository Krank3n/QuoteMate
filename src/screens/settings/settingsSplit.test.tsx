// @vitest-environment jsdom
/**
 * Business Defaults split in two (Sep 2026): pricing stays on "Rates & GST"
 * (route BusinessDefaults); everything that shapes the customer's document
 * moved to "Quotes & Invoices". Same settings/business fields, so the only new
 * behaviour to pin is at the seam:
 *  - Rates & GST no longer carries the document cards;
 *  - a GST change still re-words UNEDITED starter T&Cs (they print a GST line)
 *    now that the terms live on the other screen, and never touches edited ones;
 *  - Quotes & Invoices shows the current template and opens the gallery.
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
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: nav.navigate, setOptions: vi.fn() }),
  useFocusEffect: () => {},
}));

vi.mock('react-native-paper', async () => {
  const { Text, View } = await import('react-native');
  return {
    Text,
    Title: ({ children }: any) => React.createElement(Text, null, children),
    Surface: ({ children }: any) => React.createElement(View, null, children),
    IconButton: () => null,
    SegmentedButtons: ({ buttons, onValueChange }: any) => (
      <div>
        {buttons.map((b: any) => (
          <button key={b.value} onClick={() => onValueChange(b.value)}>{b.label}</button>
        ))}
      </div>
    ),
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

import { BusinessDefaultsScreen } from './BusinessDefaultsScreen';
import { QuotesInvoicesScreen } from './QuotesInvoicesScreen';
import { defaultAuTradieTerms } from '../../../shared/pdf/terms/defaultAuTradie';

beforeEach(() => {
  vi.clearAllMocks();
  store.state.businessSettings = {
    businessName: 'Lakeside Painting',
    defaultLaborRate: 95,
    pricesIncludeGst: false,
    gstRegistered: true,
  };
});

const saved = () => (store.state.setBusinessSettings.mock.calls.at(-1) as any)[0];

describe('Rates & GST (BusinessDefaultsScreen)', () => {
  it('keeps pricing and drops the document cards', () => {
    render(<BusinessDefaultsScreen />);
    expect(screen.getByText('Default Rates')).toBeTruthy();
    for (const moved of ['Document Display', 'What the Customer Sees', 'Deposits (Square)', 'Customer Follow-Ups', 'Terms & Conditions', 'Extra Quote Section']) {
      expect(screen.queryByText(moved), moved).toBeNull();
    }
  });

  it('re-words unedited starter terms when GST changes', async () => {
    store.state.businessSettings.termsAndConditions = defaultAuTradieTerms('exclusive');
    render(<BusinessDefaultsScreen />);
    fireEvent.click(screen.getByText('Not registered'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(store.state.setBusinessSettings).toHaveBeenCalled());
    expect(saved()).toMatchObject({
      gstRegistered: false,
      termsAndConditions: defaultAuTradieTerms('none'),
      termsUpdatedAt: expect.any(String),
    });
  });

  it('leaves hand-edited terms alone', async () => {
    store.state.businessSettings.termsAndConditions = 'Our own terms. Cash only.';
    store.state.businessSettings.termsUpdatedAt = '2026-01-01T00:00:00.000Z';
    render(<BusinessDefaultsScreen />);
    fireEvent.click(screen.getByText('Not registered'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(store.state.setBusinessSettings).toHaveBeenCalled());
    expect(saved()).toMatchObject({
      termsAndConditions: 'Our own terms. Cash only.',
      termsUpdatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('does not rewrite starter terms on a save that leaves GST alone', async () => {
    store.state.businessSettings.termsAndConditions = defaultAuTradieTerms('exclusive');
    store.state.businessSettings.termsUpdatedAt = '2026-01-01T00:00:00.000Z';
    render(<BusinessDefaultsScreen />);
    fireEvent.change(screen.getByLabelText('Hourly Labour Rate'), { target: { value: '110' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(store.state.setBusinessSettings).toHaveBeenCalled());
    expect(saved()).toMatchObject({
      defaultLaborRate: 110,
      termsAndConditions: defaultAuTradieTerms('exclusive'),
      termsUpdatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('Quotes & Invoices — template style', () => {
  it('shows the current template and opens the gallery', () => {
    store.state.businessSettings.pdfTemplate = 'bold';
    render(<QuotesInvoicesScreen />);
    expect(screen.getByText('Template style')).toBeTruthy();
    expect(screen.getByText('Bold')).toBeTruthy();
    fireEvent.click(screen.getByText('Change'));
    expect(nav.navigate).toHaveBeenCalledWith('PDFTemplate');
  });

  it('falls back to Professional when none is saved', () => {
    render(<QuotesInvoicesScreen />);
    expect(screen.getByText('Professional')).toBeTruthy();
  });

  it('starter terms follow the GST mode set on Rates & GST', async () => {
    store.state.businessSettings.gstRegistered = false;
    render(<QuotesInvoicesScreen />);
    fireEvent.click(screen.getByText('Use starter template'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(store.state.setBusinessSettings).toHaveBeenCalled());
    expect(saved().termsAndConditions).toBe(defaultAuTradieTerms('none').trim());
  });
});
