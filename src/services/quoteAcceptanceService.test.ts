import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => ({
  getIdToken: vi.fn(async () => 'firebase-token'),
  auth: { currentUser: null as null | { getIdToken: () => Promise<string> } },
}));
vi.mock('../config/firebase', () => ({ auth: firebase.auth }));

import { generateAcceptanceLink } from './quoteAcceptanceService';

describe('generateAcceptanceLink', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    firebase.auth.currentUser = { getIdToken: firebase.getIdToken };
    firebase.getIdToken.mockClear();
  });

  it('creates an authenticated customer quote link', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, acceptanceUrl: 'https://example.test/quote/token' }),
    } as Response);

    await expect(generateAcceptanceLink('quote-1')).resolves.toBe('https://example.test/quote/token');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/generateQuoteAcceptanceLink'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer firebase-token' }),
        body: JSON.stringify({ quoteId: 'quote-1' }),
      }),
    );
  });

  it('fails before making a request when nobody is signed in', async () => {
    firebase.auth.currentUser = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(generateAcceptanceLink('quote-1')).rejects.toThrow('signed in');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not return an unusable response without a URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: 'Quote not found' }),
    } as Response);

    await expect(generateAcceptanceLink('missing')).rejects.toThrow('Quote not found');
  });
});
