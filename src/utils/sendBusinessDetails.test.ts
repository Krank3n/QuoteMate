import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory AsyncStorage — the dismissal memory is the only impure bit here.
const store = new Map<string, string>();
let storageThrows = false;
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => {
      if (storageThrows) throw new Error('storage full');
      return store.has(k) ? store.get(k)! : null;
    }),
    setItem: vi.fn(async (k: string, v: string) => {
      if (storageThrows) throw new Error('storage full');
      store.set(k, v);
    }),
  },
}));

import {
  buildSendDetailsPrompt,
  missingBusinessDetailsForSend,
  readDismissedSendDetails,
  rememberDismissedSendDetails,
  shouldAskForSendDetails,
} from './sendBusinessDetails';

const COMPLETE = {
  businessName: "Smith's Plumbing",
  abn: '51 824 753 556',
  phone: '0400 000 000',
  email: 'sam@smithsplumbing.com.au',
};

beforeEach(() => {
  store.clear();
  storageThrows = false;
});

describe('missingBusinessDetailsForSend', () => {
  it('asks for nothing when the business is fully filled in', () => {
    expect(missingBusinessDetailsForSend(COMPLETE, 'invoice')).toEqual([]);
    expect(missingBusinessDetailsForSend(COMPLETE, 'quote')).toEqual([]);
  });

  it('wants an ABN on an invoice but never on a quote', () => {
    const noAbn = { ...COMPLETE, abn: undefined };
    expect(missingBusinessDetailsForSend(noAbn, 'invoice')).toEqual(['abn']);
    expect(missingBusinessDetailsForSend(noAbn, 'quote')).toEqual([]);
  });

  it('treats a blank or whitespace ABN as missing', () => {
    expect(missingBusinessDetailsForSend({ ...COMPLETE, abn: '   ' }, 'invoice')).toEqual(['abn']);
  });

  it('accepts either a phone or an email as a way to reply', () => {
    expect(missingBusinessDetailsForSend({ ...COMPLETE, phone: '' }, 'quote')).toEqual([]);
    expect(missingBusinessDetailsForSend({ ...COMPLETE, email: '' }, 'quote')).toEqual([]);
  });

  it('flags contact only when BOTH the phone and the email are gone', () => {
    const noContact = { ...COMPLETE, phone: '', email: '  ' };
    expect(missingBusinessDetailsForSend(noContact, 'quote')).toEqual(['contact']);
  });

  it('reports every gap at once, business name first', () => {
    expect(missingBusinessDetailsForSend({}, 'invoice')).toEqual([
      'businessName',
      'abn',
      'contact',
    ]);
  });

  it('survives a null business — a send before anything was saved', () => {
    expect(missingBusinessDetailsForSend(null, 'quote')).toEqual(['businessName', 'contact']);
    expect(missingBusinessDetailsForSend(undefined, 'invoice')).toEqual([
      'businessName',
      'abn',
      'contact',
    ]);
  });

  it('only wants a name and a contact from an onboarding that kept its defaults', () => {
    // The short onboarding writes the business name, the trade and the signed-in
    // email — so a first quote asks for nothing, and a first invoice asks for
    // exactly one thing: the ABN.
    const fresh = { businessName: 'Jo Fencing', email: 'jo@example.com' };
    expect(missingBusinessDetailsForSend(fresh, 'quote')).toEqual([]);
    expect(missingBusinessDetailsForSend(fresh, 'invoice')).toEqual(['abn']);
  });
});

describe('buildSendDetailsPrompt', () => {
  it('says nothing when nothing is missing', () => {
    expect(buildSendDetailsPrompt([], 'invoice')).toBeNull();
  });

  it('names the single missing thing in the title', () => {
    expect(buildSendDetailsPrompt(['abn'], 'invoice')?.title).toBe('Add your ABN?');
    expect(buildSendDetailsPrompt(['contact'], 'quote')?.title).toBe('Add your contact details?');
  });

  it('falls back to a general title when more than one thing is missing', () => {
    expect(buildSendDetailsPrompt(['abn', 'contact'], 'invoice')?.title).toBe(
      'Add your business details?',
    );
  });

  it('explains the ABN in terms of the money, without overstating who withholds', () => {
    const message = buildSendDetailsPrompt(['abn'], 'invoice')!.message;
    expect(message).toContain('tax invoice');
    expect(message).toContain('business customer');
    // Withholding is a duty on business payers, not on a homeowner paying a
    // tradie. Naming a rate at every customer would be wrong for most of them.
    expect(message).not.toContain('47%');
  });

  it('names the document type in the copy', () => {
    expect(buildSendDetailsPrompt(['contact'], 'quote')!.message).toContain('quote');
    expect(buildSendDetailsPrompt(['contact'], 'invoice')!.message).toContain('invoice');
  });

  it('keeps a signature describing exactly which gaps were reported', () => {
    expect(buildSendDetailsPrompt(['abn'], 'invoice')!.signature).toBe('abn');
    expect(buildSendDetailsPrompt(['abn', 'contact'], 'invoice')!.signature).toBe('abn,contact');
  });

  it('never uses the word tradies would dismiss the app over', () => {
    // Copy rule: the letters A and I, as a word, appear in no user-facing string.
    for (const missing of [['abn'], ['contact'], ['businessName'], ['abn', 'contact']] as const) {
      const prompt = buildSendDetailsPrompt([...missing], 'invoice')!;
      expect(`${prompt.title} ${prompt.message}`).not.toMatch(/\bAI\b/);
    }
  });
});

describe('shouldAskForSendDetails', () => {
  it('does not interrupt a send with nothing to report', () => {
    expect(shouldAskForSendDetails(null, null)).toBe(false);
  });

  it('asks the first time a gap turns up', () => {
    const prompt = buildSendDetailsPrompt(['abn'], 'invoice');
    expect(shouldAskForSendDetails(prompt, null)).toBe(true);
  });

  it('stays quiet about a gap the tradie already chose to send past', () => {
    const prompt = buildSendDetailsPrompt(['abn'], 'invoice');
    expect(shouldAskForSendDetails(prompt, 'abn')).toBe(false);
  });

  it('speaks up again when the gap grows', () => {
    // Waved away "no ABN"; now the phone number has gone missing as well.
    const wider = buildSendDetailsPrompt(['abn', 'contact'], 'invoice');
    expect(shouldAskForSendDetails(wider, 'abn')).toBe(true);
  });
});

describe('the dismissal memory', () => {
  it('round-trips the signature', async () => {
    await rememberDismissedSendDetails('abn');
    await expect(readDismissedSendDetails()).resolves.toBe('abn');
  });

  it('reads null before anything has been dismissed', async () => {
    await expect(readDismissedSendDetails()).resolves.toBeNull();
  });

  it('never lets a storage failure break a send', async () => {
    storageThrows = true;
    await expect(rememberDismissedSendDetails('abn')).resolves.toBeUndefined();
    await expect(readDismissedSendDetails()).resolves.toBeNull();
  });
});
