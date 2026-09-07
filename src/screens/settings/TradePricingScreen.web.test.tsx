// @vitest-environment jsdom
/**
 * Web regression test for TradePricingScreen (GitHub issue #69).
 *
 * Production Sentry crash on the web build:
 *   "findNodeHandle is not supported on web. Use the ref property on the
 *    component instead."
 *
 * Root cause: react-native-draggable-flatlist's CellRendererComponent calls
 * findNodeHandle (imported from 'react-native') on mount for every cell.
 * react-native-web@0.20 removed findNodeHandle and throws exactly this error,
 * so opening Settings → Trade Pricing crashed the whole web app with zero user
 * interaction — the NestableDraggableFlatList mounts unconditionally.
 *
 * The library's own source can't be imported under vitest (it ships Flow/RN
 * source and pulls in reanimated/gesture-handler native deps), so we mock
 * react-native-draggable-flatlist with a faithful stand-in whose cells do the
 * one thing that matters for this bug: call the real findNodeHandle from
 * react-native on mount. Under jsdom, react-native is aliased to the real
 * react-native-web (see vitest.config.ts), whose findNodeHandle throws the
 * exact production error — so if TradePricingScreen mounts the draggable list
 * on web, render() genuinely throws here.
 *
 * The fix gates the draggable list (and its Nestable container) behind
 * Platform.OS !== 'web', rendering a plain ScrollView + static list instead —
 * nothing from the draggable library mounts on web. With the fix, the mocked
 * cells are never rendered, findNodeHandle is never called, and render()
 * succeeds with the supplier rows present.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import { View, findNodeHandle } from 'react-native';

// Faithful stand-in for react-native-draggable-flatlist. The Nestable
// containers pass children through; the draggable list renders each row via a
// cell that calls findNodeHandle on mount — mirroring the library's real
// CellRendererComponent, which is the confirmed crash source on web.
vi.mock('react-native-draggable-flatlist', () => {
  const CrashingCell = ({ children }: any) => {
    // This is what the real library does on mount and what throws on web.
    React.useLayoutEffect(() => {
      findNodeHandle(null);
    }, []);
    return <>{children}</>;
  };
  return {
    NestableScrollContainer: ({ children }: any) => <>{children}</>,
    NestableDraggableFlatList: ({ data, renderItem, keyExtractor }: any) => (
      <>
        {data.map((item: any, index: number) => (
          <CrashingCell key={keyExtractor(item, index)}>
            {renderItem({ item, drag: () => {}, isActive: false, getIndex: () => index })}
          </CrashingCell>
        ))}
      </>
    ),
  };
});

// Heavy native/expo dependency graphs irrelevant to the render path — same
// approach as TakePaymentSheet.test.tsx / StickyJobActionBar.test.tsx.
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('react-native-paper', () => {
  // Paper's TextInput carries its label as a prop; the shim exposes it as the
  // accessible name so tests can type by label, the way the real one reads.
  const TextInput: any = ({ label, value, onChangeText }: any) =>
    React.createElement('input', {
      'aria-label': label,
      value: value ?? '',
      onChange: (e: any) => onChangeText?.(e.target.value),
    });
  TextInput.Affix = () => null;
  return {
    DefaultTheme: { colors: {} },
    MD3DarkTheme: { colors: {} },
    Text: ({ children }: any) => React.createElement('span', null, children),
    Title: ({ children }: any) => React.createElement('span', null, children),
    Surface: ({ children }: any) => React.createElement('div', null, children),
    Chip: ({ children, onPress, accessibilityLabel, disabled }: any) =>
      React.createElement(
        'span',
        { role: 'button', 'aria-label': accessibilityLabel, 'aria-disabled': disabled ? 'true' : undefined, onClick: disabled ? undefined : onPress },
        children,
      ),
    TouchableRipple: ({ children, onPress, accessibilityLabel }: any) =>
      React.createElement('span', { role: 'button', 'aria-label': accessibilityLabel, onClick: onPress }, children),
    Switch: ({ value, onValueChange, accessibilityLabel }: any) =>
      React.createElement('input', {
        type: 'checkbox',
        role: 'switch',
        'aria-label': accessibilityLabel,
        checked: !!value,
        onChange: () => onValueChange?.(!value),
      }),
    TextInput,
  };
});
vi.mock('../../components/FooterButton', () => ({
  FooterButton: ({ label, onPress, disabled }: any) =>
    React.createElement('button', { disabled, onClick: onPress }, label),
}));

// Navigation: the screen calls useNavigation() and registers useFocusEffect
// callbacks. Run focus callbacks immediately (like a real focus) so the
// supplier-loading effects fire; honour their cleanup.
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    addListener: vi.fn(() => () => {}),
    dispatch: vi.fn(),
    goBack: vi.fn(),
  }),
  useFocusEffect: (cb: () => undefined | (() => void)) => {
    React.useEffect(() => cb(), []);
  },
}));

// Reece connected → composeSupplierList yields Bunnings + Reece, so at least
// two rows render regardless of any local supplier groups.
vi.mock('../../services/reeceApi', () => ({
  getReeceConnectionStatus: vi.fn(async () => ({ connected: true })),
}));
vi.mock('../../services/supplierGroupService', () => ({
  loadGroups: vi.fn(async () => []),
}));

// Store: business settings with no saved priority; composeSupplierList fills
// in the built-ins. Return a STABLE object each call — TradePricingScreen has
// a useEffect keyed on businessSettings identity, so a fresh literal per render
// would loop forever.
const storeValue = vi.hoisted(() => ({
  state: {
    businessSettings: { supplierPriority: [] as string[] },
    setBusinessSettings: async () => {},
  },
}));
vi.mock('../../store/useStore', () => ({
  useStore: () => storeValue.state,
}));

// Leaf components with their own heavy deps — render inert.
vi.mock('../../components/WebContainer', () => ({
  WebContainer: ({ children }: any) => React.createElement('div', null, children),
}));
vi.mock('../../components/FixedBottomButton', () => ({
  FixedBottomButton: () => null,
}));
vi.mock('../../components/AlertModal', () => ({
  AlertModal: () => null,
}));
vi.mock('../../hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => ({ unsavedModalProps: {}, allowNextNavigation: vi.fn() }),
}));

// The sheet chassis has its own lifecycle tests; the shim renders the "How you
// quote" add forms only while the screen says the sheet is open.
vi.mock('../../components/BottomSheet', () => ({
  BottomSheet: (props: any) =>
    props.visible
      ? React.createElement('div', null, React.createElement('span', null, props.title), props.children)
      : null,
}));

import { TradePricingScreen } from './TradePricingScreen';
import { TRADE_CATEGORIES } from '../../constants/tradeCategories';

describe('TradePricingScreen on web', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Sanity check: the mocked cell genuinely reproduces the production crash,
  // so a passing render() below is meaningful (not a mock that can never throw).
  it('react-native-web findNodeHandle throws the production error', () => {
    let mounted = false;
    const Cell = () => {
      React.useLayoutEffect(() => {
        findNodeHandle(null);
        mounted = true;
      }, []);
      return null;
    };
    expect(() => render(<View><Cell /></View>)).toThrow(/findNodeHandle is not supported on web/);
    expect(mounted).toBe(false);
  });

  it('renders without triggering the findNodeHandle crash and shows supplier rows', async () => {
    // If the draggable-flatlist path mounts on web, the mocked cell calls
    // react-native-web's findNodeHandle, which throws here.
    const { getByText, findByText } = render(<TradePricingScreen />);

    // Reece is added once the async connection check resolves; both built-in
    // suppliers must appear in the DOM via the static web list.
    expect(await findByText('Reece')).toBeTruthy();
    await waitFor(() => expect(getByText('Bunnings')).toBeTruthy());
  });

  // "How you quote": rules and rates Mate saved from chat. They must be
  // visible and removable here — a wrong rule left in place is applied to
  // the very next quote — and removing one saves straight away, outside the
  // screen's own Save button.
  describe('How you quote', () => {
    const plain = { supplierPriority: [] as string[] };
    const withProfile = {
      supplierPriority: [] as string[],
      quotingPreferences: ['Labour separate from materials', 'Customers supply their own materials'],
      rateCard: [
        { id: 'r1', label: 'Patio roof supply and fit', unit: 'm²', rate: 220, pricesIncludeGst: false, includesMaterials: true, updatedAt: '' },
      ],
    };

    afterEach(() => {
      storeValue.state.businessSettings = plain;
      storeValue.state.setBusinessSettings = async () => {};
    });

    // The card is the tradie's door into what Mate remembers, so it has to be
    // there before anything is saved — otherwise "memory" is invisible until
    // Mate happens to fill it.
    it('is there before anything is saved, with the two ways to add', () => {
      const { getByText, getByLabelText } = render(<TradePricingScreen />);
      expect(getByText('How you quote')).toBeTruthy();
      expect(getByLabelText('Add a rule')).toBeTruthy();
      expect(getByLabelText('Add a rate')).toBeTruthy();
    });

    it('adds a rule by hand in a sheet, saves straight away, and closes the sheet', async () => {
      const setBusinessSettings = vi.fn(async () => {});
      storeValue.state.setBusinessSettings = setBusinessSettings;
      const { getByLabelText, getByText, queryByLabelText } = render(<TradePricingScreen />);
      expect(queryByLabelText('Rule')).toBeNull();
      fireEvent.click(getByLabelText('Add a rule'));
      fireEvent.change(getByLabelText('Rule'), { target: { value: '  Labour only, the customer buys the  materials ' } });
      fireEvent.click(getByText('Save rule'));
      await waitFor(() => expect(setBusinessSettings).toHaveBeenCalledTimes(1));
      expect(setBusinessSettings.mock.calls[0][0]).toMatchObject({
        quotingPreferences: ['Labour only, the customer buys the materials'],
      });
      await waitFor(() => expect(queryByLabelText('Rule')).toBeNull());
    });

    it('adds a rate by hand in the business GST basis, and refuses one with no amount', async () => {
      const setBusinessSettings = vi.fn(async () => {});
      storeValue.state.businessSettings = { supplierPriority: [], gstRegistered: true, pricesIncludeGst: true } as any;
      storeValue.state.setBusinessSettings = setBusinessSettings;
      const { getByLabelText, getByText } = render(<TradePricingScreen />);
      fireEvent.click(getByLabelText('Add a rate'));
      expect(getByText('Inc GST, the way your quotes show prices.')).toBeTruthy();
      fireEvent.change(getByLabelText('What the rate is for'), { target: { value: 'End of lease clean' } });
      fireEvent.click(getByText('Save rate'));
      expect(setBusinessSettings).not.toHaveBeenCalled();

      fireEvent.change(getByLabelText('Rate'), { target: { value: '120' } });
      fireEvent.click(getByText('per room'));
      fireEvent.click(getByLabelText('Rate includes materials'));
      fireEvent.click(getByText('Save rate'));
      await waitFor(() => expect(setBusinessSettings).toHaveBeenCalledTimes(1));
      const saved = setBusinessSettings.mock.calls[0][0] as any;
      expect(saved.rateCard).toHaveLength(1);
      expect(saved.rateCard[0]).toMatchObject({
        label: 'End of lease clean',
        unit: 'room',
        rate: 120,
        pricesIncludeGst: true,
        includesMaterials: true,
      });
    });

    // The store updates local state first and only then awaits Firestore,
    // whose write never settles offline. Waiting on it left the sheet open
    // forever with the rule already showing behind it.
    it('closes the sheet on save even when the write never settles', async () => {
      storeValue.state.setBusinessSettings = vi.fn(() => new Promise<void>(() => {}));
      const { getByLabelText, getByText, queryByLabelText } = render(<TradePricingScreen />);
      fireEvent.click(getByLabelText('Add a rule'));
      fireEvent.change(getByLabelText('Rule'), { target: { value: 'Labour only' } });
      fireEvent.click(getByText('Save rule'));
      await waitFor(() => expect(queryByLabelText('Rule')).toBeNull());
    });

    it('keeps the add buttons off until the business settings have loaded', () => {
      storeValue.state.businessSettings = null as any;
      const { getByLabelText } = render(<TradePricingScreen />);
      expect(getByLabelText('Add a rule').getAttribute('aria-disabled')).toBe('true');
      expect(getByLabelText('Add a rate').getAttribute('aria-disabled')).toBe('true');
    });

    // Every settings write hands the screen a new object. The draft of
    // categories/niches/priority must only re-seed when THOSE fields change,
    // or a rule saved from the card wipes an unsaved category toggle.
    it('a settings write that leaves the trade fields alone does not reset unsaved category toggles', async () => {
      const category = TRADE_CATEGORIES[0].name;
      const { getByLabelText, findByText, rerender } = render(<TradePricingScreen />);
      const selected = (name: string) => getByLabelText(name).getAttribute('aria-selected');
      await findByText('Reece'); // the focus-time supplier loads have settled
      fireEvent.click(getByLabelText(category));
      await waitFor(() => expect(selected(category)).toBe('true'));

      storeValue.state.businessSettings = { supplierPriority: [], quotingPreferences: ['Labour only'] } as any;
      rerender(<TradePricingScreen />);
      await waitFor(() => expect(selected(category)).toBe('true'));

      // The control: a write that does change the trade fields still re-seeds.
      storeValue.state.businessSettings = { supplierPriority: [], tradeCategories: [TRADE_CATEGORIES[1].id] } as any;
      rerender(<TradePricingScreen />);
      await waitFor(() => expect(selected(TRADE_CATEGORIES[1].name)).toBe('true'));
      expect(selected(category)).toBe('false');
    });

    it('lists the saved rules and rates', () => {
      storeValue.state.businessSettings = withProfile as any;
      const { getByText } = render(<TradePricingScreen />);
      expect(getByText('How you quote')).toBeTruthy();
      expect(getByText('Labour separate from materials')).toBeTruthy();
      expect(getByText('Patio roof supply and fit')).toBeTruthy();
      expect(getByText(/\$220\.00 per m² ex GST · materials included/)).toBeTruthy();
    });

    it('removing a rule or a rate saves the settings without it, straight away', async () => {
      const setBusinessSettings = vi.fn(async () => {});
      storeValue.state.businessSettings = withProfile as any;
      storeValue.state.setBusinessSettings = setBusinessSettings;
      const { getByLabelText } = render(<TradePricingScreen />);

      fireEvent.click(getByLabelText('Remove preference: Labour separate from materials'));
      await waitFor(() => expect(setBusinessSettings).toHaveBeenCalledTimes(1));
      expect(setBusinessSettings.mock.calls[0][0]).toMatchObject({
        quotingPreferences: ['Customers supply their own materials'],
        rateCard: withProfile.rateCard,
      });

      fireEvent.click(getByLabelText('Remove rate: Patio roof supply and fit'));
      await waitFor(() => expect(setBusinessSettings).toHaveBeenCalledTimes(2));
      expect(setBusinessSettings.mock.calls[1][0]).toMatchObject({ rateCard: undefined });
    });
  });
});
