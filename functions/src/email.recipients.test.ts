/**
 * The wire contract for a multi-recipient send (Sep 2026: a quote to the
 * accounts desk as well as the owner). What has to hold: every address lands
 * on Brevo's To line, a dead or junk address is dropped on its own while the
 * others still go, and the emailLog row still carries a string `to` the admin
 * log and the bounce lookup can read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { firestore, fetchMock, logAdd, bounceGet } = vi.hoisted(() => {
  const logSet = vi.fn().mockResolvedValue(undefined);
  const logAdd = vi.fn().mockResolvedValue({ id: 'emailLog1', set: logSet });
  // hasPriorHardBounce: `.where('to', '==', address)` — the address under
  // test decides what comes back.
  const bounceGet = vi.fn().mockResolvedValue({ docs: [] });
  const collection = () => ({
    add: logAdd,
    where: (_field: string, _op: string, address: string) => ({
      select: () => ({ limit: () => ({ get: () => bounceGet(address) }) }),
    }),
  });
  const firestore: any = () => ({ collection, doc: () => ({ get: async () => ({ exists: false }), set: logSet }) });
  firestore.FieldValue = { serverTimestamp: () => 'server-timestamp' };
  return { firestore, fetchMock: vi.fn(), logAdd, bounceGet };
});

vi.mock('firebase-admin', () => ({ firestore }));
vi.mock('node-fetch', () => ({ default: fetchMock }));

import { sendEmail } from './email';

const brevoPayload = (): any => JSON.parse(fetchMock.mock.calls[0][1].body);
const pendingRow = (): any => logAdd.mock.calls.find(([row]) => row.status === 'pending')?.[0];
const blockedRows = (): any[] => logAdd.mock.calls.map(([row]) => row).filter((row) => row.status === 'blocked');

function send(to: string | string[]) {
  return sendEmail({
    to,
    subject: 'Quotation from Hansen Fencing',
    htmlContent: '<p>Hi Sarah,</p>',
    category: 'transactional',
    userId: 'test',
  });
}

describe('sendEmail — several recipients', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    logAdd.mockClear();
    bounceGet.mockReset();
    bounceGet.mockResolvedValue({ docs: [] });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messageId: 'brevo-1' }) });
    process.env.BREVO_API_KEY = 'test-key';
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('puts every address on the To line', async () => {
    const sent = await send(['sarah@bigpond.com.au', 'accounts@sarahs.com.au']);

    expect(sent).toBe(true);
    expect(brevoPayload().to).toEqual([{ email: 'sarah@bigpond.com.au' }, { email: 'accounts@sarahs.com.au' }]);
  });

  it('still takes the single string every other caller passes', async () => {
    await send('sarah@bigpond.com.au');

    expect(brevoPayload().to).toEqual([{ email: 'sarah@bigpond.com.au' }]);
    expect(pendingRow().to).toBe('sarah@bigpond.com.au');
    expect(pendingRow().recipients).toBeUndefined();
  });

  it('logs the list as one joined string plus the array', async () => {
    await send(['sarah@bigpond.com.au', 'accounts@sarahs.com.au']);

    expect(pendingRow().to).toBe('sarah@bigpond.com.au, accounts@sarahs.com.au');
    expect(pendingRow().recipients).toEqual(['sarah@bigpond.com.au', 'accounts@sarahs.com.au']);
  });

  it('drops a hard-bounced address and sends to the others', async () => {
    bounceGet.mockImplementation(async (address: string) => ({
      docs: address === 'dead@sarahs.com.au' ? [{ data: () => ({ bounceType: 'hard' }) }] : [],
    }));

    const sent = await send(['sarah@bigpond.com.au', 'dead@sarahs.com.au']);

    expect(sent).toBe(true);
    expect(brevoPayload().to).toEqual([{ email: 'sarah@bigpond.com.au' }]);
    expect(pendingRow().to).toBe('sarah@bigpond.com.au');
  });

  it('drops a junk address, logs it as blocked, and sends to the others', async () => {
    const sent = await send(['sarah@bigpond.com.au', 'flags@2x.webp']);

    expect(sent).toBe(true);
    expect(brevoPayload().to).toEqual([{ email: 'sarah@bigpond.com.au' }]);
    expect(blockedRows()).toEqual([expect.objectContaining({ to: 'flags@2x.webp', blockedReason: 'asset-filename' })]);
  });

  it('sends nothing when no address survives', async () => {
    bounceGet.mockResolvedValue({ docs: [{ data: () => ({ bounceType: 'hard' }) }] });

    const sent = await send(['dead@sarahs.com.au', 'a@example.com']);

    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pendingRow()).toBeUndefined();
  });

  it('sends nothing for an empty list', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await send([])).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
