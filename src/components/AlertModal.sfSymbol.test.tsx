// @vitest-environment jsdom
/**
 * Apple's Tap to Pay on iPhone review (Case-ID 19476927, 28 Sep 2026) rejected
 * the setup modal because its icon was a drawn phone. The modal must show the
 * SF Symbol when one is given, and keep the plain icon as the fallback.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// Under jsdom expo-symbols resolves to its web build, which renders the
// fallback — so the SF Symbol name is only observable through this mock.
const symbols = vi.hoisted(() => ({ rendered: [] as string[] }));
vi.mock('expo-symbols', () => ({
  SymbolView: ({ name, fallback }: any) => {
    symbols.rendered.push(name);
    return fallback ?? null;
  },
}));

const icons = vi.hoisted(() => ({ rendered: [] as string[] }));
vi.mock('react-native-paper', async () => {
  const { Text, View } = await import('react-native');
  return {
    MD3DarkTheme: { colors: {} },
    Text,
    Portal: ({ children }: any) => <>{children}</>,
    Modal: ({ visible, children }: any) => (visible ? <View>{children}</View> : null),
    Button: ({ children }: any) => <button>{children}</button>,
    IconButton: ({ icon }: any) => {
      icons.rendered.push(icon);
      return null;
    },
  };
});
vi.mock('../utils/haptics', () => ({ successTap: () => {}, errorTap: () => {} }));

import { AlertModal } from './AlertModal';

const baseProps = {
  visible: true,
  onDismiss: () => {},
  type: 'info' as const,
  title: 'Set up Tap to Pay on iPhone',
  message: 'One-time, about 30 seconds.',
  showConfetti: false,
};

beforeEach(() => {
  symbols.rendered = [];
  icons.rendered = [];
});

describe('AlertModal sfSymbol', () => {
  it('renders the SF Symbol when one is given, with the plain icon as fallback', () => {
    render(<AlertModal {...baseProps} icon="cellphone-nfc" sfSymbol="wave.3.right.circle" />);

    expect([...new Set(symbols.rendered)]).toEqual(['wave.3.right.circle']);
    // The fallback is what the web build shows; iOS draws the symbol instead.
    expect(icons.rendered).toContain('cellphone-nfc');
  });

  it('renders no SF Symbol when none is given', () => {
    render(<AlertModal {...baseProps} icon="information" />);

    expect(symbols.rendered).toEqual([]);
    expect(icons.rendered).toContain('information');
  });
});
