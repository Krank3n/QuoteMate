// @vitest-environment jsdom
/**
 * Two quotes on one job — the store side.
 *
 * A tradie pricing "either a multi-head, or two splits" gets a second QUOTE on
 * the same job rather than a second section inside one, because everything
 * downstream of a quote resolves to a single total (see
 * shared/document/quoteOptions.ts). These cover the two actions that makes
 * possible: creating the option, and taking the losers off the table when one
 * is accepted.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) },
}));
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: vi.fn(async () => {}),
  deactivateKeepAwake: vi.fn(async () => {}),
}));
// The store's import graph reaches most expo-* native modules; none of their
// behaviour matters for the conversion-stamp logic under test.
vi.mock('expo-constants', () => ({ default: { expoConfig: {} } }));
vi.mock('expo-haptics', () => ({ impactAsync: vi.fn(), notificationAsync: vi.fn(), selectionAsync: vi.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
vi.mock('expo-file-system', () => ({ documentDirectory: '/tmp/', cacheDirectory: '/tmp/', writeAsStringAsync: vi.fn(), readAsStringAsync: vi.fn(), getInfoAsync: vi.fn(), EncodingType: { UTF8: 'utf8', Base64: 'base64' } }));
vi.mock('expo-print', () => ({ printToFileAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ shareAsync: vi.fn(), isAvailableAsync: vi.fn(async () => false) }));
vi.mock('expo-store-review', () => ({ requestReview: vi.fn(), hasAction: vi.fn(async () => false), isAvailableAsync: vi.fn(async () => false) }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn(), openAuthSessionAsync: vi.fn(), maybeCompleteAuthSession: vi.fn() }));
vi.mock('expo-auth-session', () => ({ makeRedirectUri: vi.fn(() => 'redirect://'), useAuthRequest: vi.fn(), AuthRequest: class {}, ResponseType: {} }));
vi.mock('expo-crypto', () => ({ digestStringAsync: vi.fn(async () => 'hash'), CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, randomUUID: vi.fn(() => 'uuid') }));
vi.mock('expo-contacts', () => ({ requestPermissionsAsync: vi.fn(), getContactsAsync: vi.fn() }));
vi.mock('expo-av', () => ({ Audio: { Sound: class {}, setAudioModeAsync: vi.fn() } }));
vi.mock('expo-image-manipulator', () => ({ manipulateAsync: vi.fn(), SaveFormat: {} }));
vi.mock('expo-mail-composer', () => ({ composeAsync: vi.fn(), isAvailableAsync: vi.fn(async () => false) }));


import { useStore } from './useStore';
import type { Document } from '../types/document';

function doc(over: Partial<Document> = {}): Document {
  return {
    id: 'opt-1',
    jobId: 'job-1',
    type: 'quote',
    stage: 'quote_sent',
    number: 'QU-001',
    createdAt: 1,
    updatedAt: 1,
    customerName: 'Barb',
    job: { name: 'Aircon replacement' },
    materials: [{ id: 'm-1', name: 'Multi head', quantity: 1, unit: 'each', price: 100, totalPrice: 100 }],
    sections: [{ id: 's-1', name: 'Option 1', laborHours: 8, laborRate: 100, laborUnit: 'hours', laborTotal: 800, multiplier: 1, sortOrder: 0 }],
    photos: [{ id: 'p-1', storageUrl: 'https://example.test/a.jpg' }],
    payments: [],
    total: 6389.02,
    materialsSubtotal: 100,
    laborTotal: 800,
    subtotal: 900,
    markupAmount: 0,
    gst: 90,
    balanceDue: 6389.02,
    ...over,
  } as unknown as Document;
}

let saved: Document[] = [];

beforeEach(() => {
  saved = [];
  useStore.setState({
    documents: [doc()],
    getNextQuoteNumber: async () => 'QU-002',
    // Capture writes and keep the in-memory list current so the actions can
    // read back what they just wrote.
    saveDocument: async (d: Document) => {
      saved.push(d);
      const rest = useStore.getState().documents.filter((x) => x.id !== d.id);
      useStore.setState({ documents: [...rest, d] } as any);
    },
  } as any);
});

describe('addQuoteOptionToJob', () => {
  it('puts a second quote on the SAME job', async () => {
    const option = await useStore.getState().addQuoteOptionToJob('opt-1');

    expect(option.jobId).toBe('job-1');
    expect(option.id).not.toBe('opt-1');
    expect(useStore.getState().documents.filter((d) => d.jobId === 'job-1')).toHaveLength(2);
  });

  it('lands as an editable draft, not as won work', async () => {
    const option = await useStore.getState().addQuoteOptionToJob('opt-1');

    expect(option.stage).toBe('draft');
    expect(option.sentAt).toBeUndefined();
    expect(option.acceptedAt).toBeUndefined();
  });

  it('takes its own quote number', async () => {
    const option = await useStore.getState().addQuoteOptionToJob('opt-1');

    expect(option.number).toBe('QU-002');
  });

  it('copies the priced scope so the tradie edits rather than retypes', async () => {
    const option = await useStore.getState().addQuoteOptionToJob('opt-1');

    expect(option.materials).toHaveLength(1);
    expect(option.sections).toHaveLength(1);
    expect(option.photos).toHaveLength(1);
    // …but nothing nested aliases back to the source.
    expect(option.materials[0].id).not.toBe('m-1');
    expect(option.sections?.[0].id).not.toBe('s-1');
  });

  it('persists it', async () => {
    const option = await useStore.getState().addQuoteOptionToJob('opt-1');

    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(option.id);
  });

  it('refuses a quote with no job — an option needs siblings to mean anything', async () => {
    useStore.setState({ documents: [doc({ jobId: undefined })] } as any);

    await expect(useStore.getState().addQuoteOptionToJob('opt-1'))
      .rejects.toThrow(/not attached to a job/i);
    expect(saved).toHaveLength(0);
  });

  it('refuses an id that is not there', async () => {
    await expect(useStore.getState().addQuoteOptionToJob('nope'))
      .rejects.toThrow(/not found/i);
  });

  it('leaves the source document untouched', async () => {
    const before = JSON.stringify(useStore.getState().documents.find((d) => d.id === 'opt-1'));

    await useStore.getState().addQuoteOptionToJob('opt-1');

    expect(JSON.stringify(useStore.getState().documents.find((d) => d.id === 'opt-1'))).toBe(before);
  });
});

describe('supersedeOtherQuotesOnJob', () => {
  it('cancels the job’s other quotes', async () => {
    useStore.setState({ documents: [doc(), doc({ id: 'opt-2' }), doc({ id: 'opt-3' })] } as any);

    const ids = await useStore.getState().supersedeOtherQuotesOnJob('opt-1');

    expect(ids.sort()).toEqual(['opt-2', 'opt-3']);
    const stages = Object.fromEntries(
      useStore.getState().documents.map((d) => [d.id, d.stage]),
    );
    expect(stages['opt-2']).toBe('cancelled');
    expect(stages['opt-3']).toBe('cancelled');
    expect(stages['opt-1']).toBe('quote_sent');
  });

  it('leaves an invoice on the job alone', async () => {
    useStore.setState({
      documents: [doc(), doc({ id: 'inv-1', type: 'invoice', stage: 'invoice_sent' })],
    } as any);

    const ids = await useStore.getState().supersedeOtherQuotesOnJob('opt-1');

    expect(ids).toEqual([]);
    expect(useStore.getState().documents.find((d) => d.id === 'inv-1')?.stage).toBe('invoice_sent');
  });

  it('leaves a quote with a deposit on it alone', async () => {
    useStore.setState({
      documents: [doc(), doc({ id: 'opt-2', depositPaid: 500 })],
    } as any);

    const ids = await useStore.getState().supersedeOtherQuotesOnJob('opt-1');

    expect(ids).toEqual([]);
  });

  it('does nothing when the job has only one quote', async () => {
    const ids = await useStore.getState().supersedeOtherQuotesOnJob('opt-1');

    expect(ids).toEqual([]);
    expect(saved).toHaveLength(0);
  });

  it('is a no-op for an id that is not there', async () => {
    await expect(useStore.getState().supersedeOtherQuotesOnJob('nope')).resolves.toEqual([]);
  });

  it('is idempotent — a second run finds nothing left to cancel', async () => {
    useStore.setState({ documents: [doc(), doc({ id: 'opt-2' })] } as any);

    await useStore.getState().supersedeOtherQuotesOnJob('opt-1');
    const second = await useStore.getState().supersedeOtherQuotesOnJob('opt-1');

    expect(second).toEqual([]);
  });
});

describe('the whole option lifecycle', () => {
  /** Every live quote on the job, in id order. */
  const liveOn = (jobId: string) => useStore.getState().documents
    .filter((d) => d.jobId === jobId && d.type === 'quote' && d.stage !== 'cancelled')
    .map((d) => d.id)
    .sort();

  it('walks one quote → two options → three → accept one → the rest off the table', async () => {
    const store = () => useStore.getState();

    // One quote. Not an option set.
    expect(liveOn('job-1')).toEqual(['opt-1']);

    // Add a second, then a third — each off the original.
    const second = await store().addQuoteOptionToJob('opt-1');
    const third = await store().addQuoteOptionToJob('opt-1');
    expect(liveOn('job-1')).toHaveLength(3);
    expect(second.id).not.toBe(third.id);
    expect(second.stage).toBe('draft');
    expect(third.stage).toBe('draft');

    // The customer picks the middle one.
    const superseded = await store().supersedeOtherQuotesOnJob(second.id);

    expect(superseded.sort()).toEqual(['opt-1', third.id].sort());
    expect(liveOn('job-1')).toEqual([second.id]);
  });

  it('leaves a third option alone when it has money on it', async () => {
    const store = () => useStore.getState();
    const second = await store().addQuoteOptionToJob('opt-1');
    const third = await store().addQuoteOptionToJob('opt-1');
    // A deposit landed against the third — a human committed to it.
    useStore.setState({
      documents: useStore.getState().documents.map((d) => (
        d.id === third.id ? { ...d, depositPaid: 250 } : d
      )),
    } as any);

    const superseded = await store().supersedeOtherQuotesOnJob(second.id);

    expect(superseded).toEqual(['opt-1']);
    expect(liveOn('job-1')).toEqual([second.id, third.id].sort());
  });

  it('can add an option off a REJECTED quote — a cheaper alternative is the point', async () => {
    useStore.setState({ documents: [doc({ stage: 'quote_rejected' })] } as any);

    const option = await useStore.getState().addQuoteOptionToJob('opt-1');

    expect(option.stage).toBe('draft');
    expect(option.jobId).toBe('job-1');
  });

  it('never supersedes across jobs, however many options each carries', async () => {
    useStore.setState({
      documents: [
        doc({ id: 'a1', jobId: 'job-1' }),
        doc({ id: 'a2', jobId: 'job-1' }),
        doc({ id: 'b1', jobId: 'job-2' }),
        doc({ id: 'b2', jobId: 'job-2' }),
      ],
    } as any);

    await useStore.getState().supersedeOtherQuotesOnJob('a1');

    expect(liveOn('job-1')).toEqual(['a1']);
    expect(liveOn('job-2')).toEqual(['b1', 'b2']);
  });

  it('leaves the job’s invoice alone when an option wins', async () => {
    useStore.setState({
      documents: [
        doc({ id: 'opt-1' }),
        doc({ id: 'opt-2' }),
        doc({ id: 'inv-1', type: 'invoice', stage: 'invoice_sent' }),
      ],
    } as any);

    const superseded = await useStore.getState().supersedeOtherQuotesOnJob('opt-1');

    expect(superseded).toEqual(['opt-2']);
    expect(useStore.getState().documents.find((d) => d.id === 'inv-1')?.stage)
      .toBe('invoice_sent');
  });
});
