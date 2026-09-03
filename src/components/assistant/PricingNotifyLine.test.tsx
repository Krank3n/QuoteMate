// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../theme', () => ({
  useThemeColors: () => ({ accentText: '#f97316', textMuted: '#888' }),
}));

import { PricingNotifyLine } from './PricingNotifyLine';
import { NOTIFY_LINE_COPY } from '../../services/pricingNotifyLine';

const io = (over: Partial<{ has: boolean; canAsk: boolean; token: string | null }> = {}) => ({
  isWeb: false,
  available: () => true,
  hasPermission: async () => over.has ?? false,
  canAskPermission: async () => over.canAsk ?? true,
  register: vi.fn(async () => (over.token === undefined ? 'ExponentPushToken[x]' : over.token)),
});

describe('PricingNotifyLine', () => {
  it('reassures a tradie who already allowed pushes', async () => {
    render(<PricingNotifyLine io={io({ has: true })} />);
    await waitFor(() => expect(screen.getByText(NOTIFY_LINE_COPY.ready)).toBeTruthy());
  });

  it('offers the notification and flips to ready once the OS prompt is accepted', async () => {
    const deps = io({ has: false, canAsk: true });
    render(<PricingNotifyLine io={deps} />);
    const offer = await waitFor(() => screen.getByText(NOTIFY_LINE_COPY.offer));
    fireEvent.click(offer);
    await waitFor(() => expect(screen.getByText(NOTIFY_LINE_COPY.ready)).toBeTruthy());
    expect(deps.register).toHaveBeenCalledTimes(1);
  });

  it('stays quiet after a refusal instead of nagging', async () => {
    render(<PricingNotifyLine io={io({ has: false, canAsk: true, token: null })} />);
    fireEvent.click(await waitFor(() => screen.getByText(NOTIFY_LINE_COPY.offer)));
    await waitFor(() => expect(screen.getByText(NOTIFY_LINE_COPY.declined)).toBeTruthy());
    expect(screen.queryByText(NOTIFY_LINE_COPY.offer)).toBeNull();
  });

  it('still says the phone can be locked when the prompt can no longer be shown', async () => {
    render(<PricingNotifyLine io={io({ has: false, canAsk: false })} />);
    await waitFor(() => expect(screen.getByText(NOTIFY_LINE_COPY.plain)).toBeTruthy());
  });

  it('holds the row while the OS dialog is up instead of collapsing the card', async () => {
    let release: (token: string | null) => void = () => {};
    const deps = { ...io({ has: false, canAsk: true }), register: () => new Promise<string | null>((r) => { release = r; }) };
    render(<PricingNotifyLine io={deps} />);
    fireEvent.click(await waitFor(() => screen.getByText(NOTIFY_LINE_COPY.offer)));
    await waitFor(() => expect(screen.getByText(NOTIFY_LINE_COPY.asking)).toBeTruthy());
    release('ExponentPushToken[x]');
    await waitFor(() => expect(screen.getByText(NOTIFY_LINE_COPY.ready)).toBeTruthy());
  });
});
