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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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
vi.mock('react-native-paper', () => ({
  DefaultTheme: { colors: {} },
  MD3DarkTheme: { colors: {} },
  Text: ({ children }: any) => React.createElement('span', null, children),
  Title: ({ children }: any) => React.createElement('span', null, children),
  Surface: ({ children }: any) => React.createElement('div', null, children),
  Chip: ({ children }: any) => React.createElement('span', null, children),
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

import { TradePricingScreen } from './TradePricingScreen';

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
});
