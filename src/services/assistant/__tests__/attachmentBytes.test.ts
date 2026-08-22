// @vitest-environment jsdom
/**
 * Chat attachments are typed from their MAGIC NUMBERS, never from the mime the
 * picker reported — the same discipline uploadQuotePhoto learned the hard way
 * when a mislabelled PDF 400'd both vision providers and killed materials
 * analysis for a whole quote.
 *
 * Platform.OS is 'web' here via the react-native → react-native-web alias, so
 * these exercise the fetch + FileReader read path with no expo-file-system.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveInlineBytes } from '../attachmentBytes';
import type { ChatAttachment } from '../../../types/assistant';

const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
]);
const PDF_BYTES = new Uint8Array([...'%PDF-1.7\n1 0 obj'].map((c) => c.charCodeAt(0)));
const GIF_BYTES = new Uint8Array(
  [...'GIF89a'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
);
const GARBAGE_BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

/** Serve a different blob per uri so the storageUrl fallback is observable. */
function serve(map: Record<string, Uint8Array | 'throw'>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (uri: string) => {
      const entry = map[uri];
      if (!entry || entry === 'throw') throw new Error('file gone');
      return { blob: async () => new Blob([entry]) } as any;
    }),
  );
}

function att(extra: Partial<ChatAttachment> = {}): ChatAttachment {
  return { id: 'p1', status: 'ready', localUri: 'blob:local', ...extra };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveInlineBytes', () => {
  it('types a JPEG from magic bytes not the recorded mimeType', async () => {
    serve({ 'blob:local': JPEG_BYTES });
    const res = await resolveInlineBytes(att({ mimeType: 'image/png' }));
    expect(res?.mimeType).toBe('image/jpeg');
    expect(res?.data.startsWith('/9j/')).toBe(true);
  });

  it('rejects a PDF picked in chat', async () => {
    serve({ 'blob:local': PDF_BYTES });
    expect(await resolveInlineBytes(att({ mimeType: 'image/jpeg' }))).toBeNull();
  });

  it('rejects a GIF', async () => {
    serve({ 'blob:local': GIF_BYTES });
    expect(await resolveInlineBytes(att())).toBeNull();
  });

  it('falls back to storageUrl when the local read throws', async () => {
    serve({ 'blob:local': 'throw', 'https://s/p1.jpg': JPEG_BYTES });
    const res = await resolveInlineBytes(att({ storageUrl: 'https://s/p1.jpg' }));
    expect(res?.mimeType).toBe('image/jpeg');
  });

  it('returns null on unreadable bytes instead of throwing', async () => {
    serve({ 'blob:local': GARBAGE_BYTES });
    await expect(resolveInlineBytes(att())).resolves.toBeNull();

    serve({});
    await expect(resolveInlineBytes(att({ storageUrl: 'https://s/gone.jpg' }))).resolves.toBeNull();
  });
});
