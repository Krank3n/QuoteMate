/**
 * Regression tests for quote/invoice email body generation routing.
 *
 * The client bundle deliberately ships no LLM API keys (removed after the
 * July 2026 key leak), but generateQuoteEmail/generateInvoiceEmail kept a
 * mobile-only direct-API branch that needed them. On Android/iOS that branch
 * threw immediately, so every Pro tradie silently got the generic fallback
 * template instead of a written email ("it's not writing on Android").
 * Generation must now route through the generateQuoteEmail Firebase Function
 * on every platform, with the plain template only as a network-failure
 * fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Simulate a native Android runtime (the vitest default aliases react-native
// to react-native-web, whose Platform.OS is 'web' — the platform the bug
// never affected).
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const fetchMock = vi.fn();

const quoteParams = {
  jobName: 'Deck restain',
  jobDescription: 'Sand and restain the back deck',
  materials: [{ name: 'Decking oil', quantity: 2, unit: 'each' }],
  laborHours: 6,
  total: 1250,
  businessName: 'Hansen Decks',
  customerName: 'Sam',
};

const invoiceParams = {
  ...quoteParams,
  dueDate: new Date('2026-08-01').toISOString(),
  invoiceNumber: 'INV-042',
};

async function importFresh() {
  vi.resetModules();
  const mod = await import('./llmService');
  const { auth } = await import('../config/firebase');
  (auth as any).currentUser = { uid: 'test-uid', getIdToken: vi.fn(async () => 'test-token') };
  return mod;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generateQuoteEmail on Android', () => {
  it('routes through the Firebase Function, never a direct LLM API', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ emailBody: 'Thanks for having us out to look at the deck.' }),
    });
    const { generateQuoteEmail } = await importFresh();

    const body = await generateQuoteEmail(quoteParams);

    expect(body).toBe('Thanks for having us out to look at the deck.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/generateQuoteEmail');
    expect(url).not.toContain('api.anthropic.com');
    expect(url).not.toContain('generativelanguage.googleapis.com');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(init.body).prompt).toContain('Deck restain');
  });

  it('strips a leading greeting so the template greeting is not doubled', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ emailBody: "G'day Sam,\n\nHere is the quote for the deck." }),
    });
    const { generateQuoteEmail } = await importFresh();

    expect(await generateQuoteEmail(quoteParams)).toBe('Here is the quote for the deck.');
  });

  it('falls back to the default template when the server call fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { generateQuoteEmail } = await importFresh();

    const body = await generateQuoteEmail(quoteParams);

    expect(body).toContain('Please find attached your quotation for Deck restain');
    expect(body).toContain('$1250.00');
  });
});

describe('generateInvoiceEmail on Android', () => {
  it('routes through the Firebase Function, never a direct LLM API', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ emailBody: 'The deck work is done and dusted.' }),
    });
    const { generateInvoiceEmail } = await importFresh();

    const body = await generateInvoiceEmail(invoiceParams);

    expect(body).toBe('The deck work is done and dusted.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/generateQuoteEmail');
    expect(url).not.toContain('api.anthropic.com');
  });

  it('falls back to the default template when the server call fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { generateInvoiceEmail } = await importFresh();

    const body = await generateInvoiceEmail(invoiceParams);

    expect(body).toContain('Please find attached your invoice for Deck restain');
  });
});
