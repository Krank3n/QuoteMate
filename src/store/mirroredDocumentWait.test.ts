import { describe, it, expect, vi } from 'vitest';
import { waitForMirroredDocument, MATE_INVOICE_MIRROR_WAIT } from './mirroredDocumentWait';

const noSleep = vi.fn(async () => {});

describe('waitForMirroredDocument', () => {
  it('returns the document on the first read without sleeping', async () => {
    const sleep = vi.fn(async () => {});
    const read = vi.fn(async () => ({ id: 'd1' }));

    const found = await waitForMirroredDocument(read, { attempts: 5, intervalMs: 10, sleep });

    expect(found).toEqual({ id: 'd1' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('keeps reading until the mirror lands, sleeping between reads', async () => {
    const sleep = vi.fn(async () => {});
    const read = vi
      .fn<() => Promise<{ id: string } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'd1' });

    const found = await waitForMirroredDocument(read, { attempts: 5, intervalMs: 10, sleep });

    expect(found).toEqual({ id: 'd1' });
    expect(read).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('gives up with undefined after the attempts are spent, and never sleeps after the last read', async () => {
    const sleep = vi.fn(async () => {});
    const read = vi.fn(async () => null);

    const found = await waitForMirroredDocument(read, { attempts: 4, intervalMs: 10, sleep });

    expect(found).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('treats undefined from the read the same as null', async () => {
    const read = vi.fn(async () => undefined);
    const found = await waitForMirroredDocument(read, { attempts: 2, intervalMs: 1, sleep: noSleep });
    expect(found).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("Mate's budget is about ten seconds — long enough for a cold-started mirror, short enough to notice", () => {
    const budgetMs = (MATE_INVOICE_MIRROR_WAIT.attempts - 1) * MATE_INVOICE_MIRROR_WAIT.intervalMs;
    expect(budgetMs).toBeGreaterThanOrEqual(8000);
    expect(budgetMs).toBeLessThanOrEqual(15000);
  });
});
