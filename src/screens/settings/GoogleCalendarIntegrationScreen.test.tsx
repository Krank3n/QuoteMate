// @vitest-environment jsdom
/**
 * Regression: the Disconnect confirm used native Alert.alert, which
 * react-native-web does not implement, so on quotemateapp.au the button did
 * nothing. The screen must route the confirm through the themed AlertModal
 * and only revoke once the tradie confirms.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Alert } from 'react-native';

vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => null }));
vi.mock('../../components/GridBackground', () => ({ GridBackground: () => null }));
vi.mock('../../components/WebContainer', () => ({
  WebContainer: ({ children }: any) => React.createElement('div', null, children),
}));
vi.mock('react-native-paper', async () => {
  const { Text, View } = await import('react-native');
  return {
    Text,
    Surface: ({ children }: any) => React.createElement(View, null, children),
    ActivityIndicator: () => null,
    Button: ({ children, onPress, disabled }: any) => (
      <button onClick={onPress} disabled={disabled}>
        {children}
      </button>
    ),
  };
});

const alertSpy = vi.hoisted(() => ({ showAlert: vi.fn(), dismissAlert: vi.fn() }));
vi.mock('../../hooks/useAlertModal', () => ({
  useAlertModal: () => ({
    showAlert: alertSpy.showAlert,
    dismissAlert: alertSpy.dismissAlert,
    alertNode: null,
  }),
}));

const auth = vi.hoisted(() => ({
  ready: true,
  pending: false,
  lastError: null as string | null,
  connection: null as any,
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
}));
vi.mock('../../services/googleCalendarAuth', () => ({
  useGoogleCalendarAuth: () => auth,
}));

import { GoogleCalendarIntegrationScreen } from './GoogleCalendarIntegrationScreen';

function button(baseElement: HTMLElement, label: string): HTMLButtonElement {
  const b = [...baseElement.querySelectorAll('button')].find((el) =>
    el.textContent?.includes(label),
  );
  if (!b) throw new Error(`no "${label}" button rendered`);
  return b as HTMLButtonElement;
}

beforeEach(() => {
  alertSpy.showAlert.mockClear();
  auth.connect.mockClear();
  auth.disconnect.mockClear();
  auth.connection = null;
});

describe('GoogleCalendarIntegrationScreen — disconnect', () => {
  it('asks through the themed AlertModal, never the native Alert, and revokes only on confirm', async () => {
    const nativeAlert = vi.spyOn(Alert, 'alert');
    auth.connection = { connectedAt: 1, email: 'tradie@example.com' };
    const { baseElement } = render(<GoogleCalendarIntegrationScreen />);

    fireEvent.click(button(baseElement, 'Disconnect'));

    expect(nativeAlert).not.toHaveBeenCalled();
    expect(auth.disconnect).not.toHaveBeenCalled();
    expect(alertSpy.showAlert).toHaveBeenCalledTimes(1);
    const opts = alertSpy.showAlert.mock.calls[0][0];
    expect(opts.title).toBe('Disconnect Google Calendar?');
    expect(opts.primaryButtonText).toBe('Disconnect');
    expect(opts.secondaryButtonText).toBe('Cancel');

    await opts.primaryButtonAction();
    expect(auth.disconnect).toHaveBeenCalledTimes(1);
  });

  it('shows Connect when there is no connection and calls connect on tap', () => {
    const { baseElement } = render(<GoogleCalendarIntegrationScreen />);
    fireEvent.click(button(baseElement, 'Connect Google Calendar'));
    expect(auth.connect).toHaveBeenCalledTimes(1);
    expect(alertSpy.showAlert).not.toHaveBeenCalled();
  });
});
