// @vitest-environment jsdom
/**
 * Mate's apply paths for stating the price, on the unified Document path the
 * store takes first:
 *   - propose_set_total lands the customer-facing figure to the cent and hands
 *     the real total + what moved back for the "[context]" line;
 *   - a lump-sum line lands as the inline editor's work item, in the
 *     document's GST basis, with no pipeline and no plan gate;
 *   - a lump sum's price update keeps the lump-sum shape and never reaches the
 *     supplier book;
 *   - every line edit recalculates the stored totals (they used to go stale —
 *     saveDocument recalculates nothing);
 *   - labour hours / rate on a SECTIONED document actually move the money;
 *   - the contact picker saves the pick once and re-points the quote.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) },
}));
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: vi.fn(async () => {}),
  deactivateKeepAwake: vi.fn(async () => {}),
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: {} } }));
vi.mock('expo-haptics', () => ({ impactAsync: vi.fn(), notificationAsync: vi.fn(), selectionAsync: vi.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
vi.mock('expo-file-system', () => ({ documentDirectory: '/tmp/', cacheDirectory: '/tmp/', writeAsStringAsync: vi.fn(), readAsStringAsync: vi.fn(), getInfoAsync: vi.fn(), EncodingType: { UTF8: 'utf8', Base64: 'base64' } }));
vi.mock('expo-print', () => ({ printToFileAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ shareAsync: vi.fn(), isAvailableAsync: vi.fn(async () => false) }));
vi.mock('expo-store-review', () => ({ requestReview: vi.fn(), hasAction: vi.fn(async () => false), isAvailableAsync: vi.fn(async () => false) }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn(), openAuthSessionAsync: vi.fn(), maybeCompleteAuthSession: vi.fn() }));
vi.mock('expo-auth-session', () => ({ makeRedirectUri: vi.fn(() => 'redirect://'), useAuthRequest: vi.fn(), AuthRequest: class {}, ResponseType: {} }));
vi.mock('expo-crypto', () => ({ digestStringAsync: vi.fn(async () => 'hash'), CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, randomUUID: vi.fn(() => 'uuid') }));
vi.mock('expo-av', () => ({ Audio: { Sound: class {}, setAudioModeAsync: vi.fn() } }));
vi.mock('expo-image-manipulator', () => ({ manipulateAsync: vi.fn(), SaveFormat: {} }));
vi.mock('expo-mail-composer', () => ({ composeAsync: vi.fn(), isAvailableAsync: vi.fn(async () => false) }));

const contactsMock = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(async () => ({ status: 'undetermined', canAskAgain: true })),
  requestPermissionsAsync: vi.fn(async () => ({ status: 'granted', canAskAgain: true })),
  getContactsAsync: vi.fn(async () => ({ data: [] })),
  presentContactPickerAsync: vi.fn(async () => null as any),
  Fields: { FirstName: 'firstName', LastName: 'lastName', Emails: 'emails', PhoneNumbers: 'phoneNumbers', Addresses: 'addresses', Company: 'company', UrlAddresses: 'urlAddresses' },
}));
vi.mock('expo-contacts', () => contactsMock);

const platform = vi.hoisted(() => ({ OS: 'ios' as string }));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, Platform: { ...actual.Platform, get OS() { return platform.OS; } } };
});

const remember = vi.hoisted(() => ({ rememberMaterialPrice: vi.fn(async () => true) }));
vi.mock('../services/priceMemory', () => ({ rememberMaterialPrice: remember.rememberMaterialPrice }));

import { useStore } from './useStore';
import { DISCOUNT_NAME } from '../utils/setTotal';
import type { Document } from '../types/document';
import type { Contact, Material, QuoteSection } from '../types';

const DOC_ID = 'inv-004';
const base = { id: 'p1', toolUseId: 't1', createdAt: '2026-09-03T00:00:00Z' };

function gear(extra: Partial<Material> = {}): Material {
  return {
    id: 'm1',
    name: 'Switchboard enclosure 24-pole',
    quantity: 1,
    unit: 'each',
    price: 549,
    totalPrice: 549,
    manualPriceOverride: false,
    pricingSource: 'scraper',
    ...extra,
  } as Material;
}

function section(id: string, hours: number, multiplier = 1): QuoteSection {
  return { id, name: `Section ${id}`, multiplier, laborHours: hours, laborHoursTotal: hours * multiplier, laborRate: 90, laborUnit: 'hours', laborTotal: hours * multiplier * 90, sortOrder: 0 };
}

/** INV-004: $549 gear, $702 labour in three sections, 30% markup, no GST → $1,415.70. */
function inv004(over: Partial<Document> = {}): Document {
  return {
    id: DOC_ID,
    type: 'invoice',
    stage: 'invoice_draft',
    number: 'INV-004',
    customerName: 'Sue and Peter Williamson',
    job: { id: 'job-1', name: 'Switchboard install' },
    materials: [gear()],
    sections: [section('a', 4.5), section('b', 0.2, 10), section('c', 1.3)],
    payments: [],
    paymentLinks: [],
    laborRate: 90,
    laborHours: 7.8,
    laborExtraHours: 0,
    laborTotal: 702,
    markup: 30,
    laborMarkup: 0,
    materialsSubtotal: 549,
    markupAmount: 164.7,
    subtotal: 1251,
    gst: 0,
    total: 1415.7,
    pricesIncludeGst: false,
    gstRegistered: false,
    ...over,
  } as unknown as Document;
}

const stored = () => useStore.getState().documents.find((d) => d.id === DOC_ID)!;

beforeEach(() => {
  vi.clearAllMocks();
  platform.OS = 'ios';
  useStore.setState({
    documents: [inv004()],
    invoices: [],
    quotes: [],
    contacts: [],
    currentQuote: null,
    businessSettings: { businessName: 'Leo Wright Electrical', defaultLaborRate: 90, defaultMarkup: 30, pricesIncludeGst: false, gstRegistered: false },
    subscriptionStatus: { plan: 'pro' },
    getEffectivePlan: () => 'pro',
    saveContact: vi.fn(async (c: Contact) => {
      useStore.setState((s) => ({ contacts: [...s.contacts.filter((x) => x.id !== c.id), c] }) as any);
    }),
    saveDocument: vi.fn(async (d: Document) => {
      useStore.setState((s) => ({ documents: s.documents.map((x) => (x.id === d.id ? d : x)) }) as any);
    }),
  } as any);
});

describe('propose_set_total', () => {
  it('lands INV-004 on $1,232 through labour and reports the total and what moved', async () => {
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_set_total', quoteId: DOC_ID, targetTotal: 1232 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appliedTotal).toBe(1232);
    expect(result.moved).toBe('off the labour');
    expect(result.navigate).toEqual({ kind: 'job_preview', quoteId: DOC_ID });
    const doc = stored();
    expect(doc.total).toBe(1232);
    expect(doc.laborTotal).toBe(518.3);
    expect(doc.materialsSubtotal).toBe(549);
    expect(doc.laborExtraHours).toBeLessThan(0);
    expect(doc.sections!.map((s) => s.laborTotal)).toEqual([405, 180, 117]);
  });

  it('refuses a total under the materials and changes nothing', async () => {
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_set_total', quoteId: DOC_ID, targetTotal: 400 });
    expect(!result.ok && result.error).toContain('under the materials');
    expect(stored().total).toBe(1415.7);
  });

  it('refuses on a paid or part-paid invoice — the balance would not follow', async () => {
    for (const stage of ['paid', 'partially_paid']) {
      useStore.setState({ documents: [inv004({ stage } as any)] } as any);
      const result = await useStore.getState().applyProposal({ ...base, type: 'propose_set_total', quoteId: DOC_ID, targetTotal: 1232 });
      expect(!result.ok && result.error, stage).toContain('money paid against it');
      expect(stored().total).toBe(1415.7);
      const lump = await useStore.getState().applyProposal({ ...base, type: 'propose_add_line_item', quoteId: DOC_ID, searchTerm: 'Callout', qty: 1, unit: 'each', kind: 'work', price: 180 });
      expect(lump.ok, stage).toBe(false);
    }
  });

  it('a legacy invoice at status "partial", and any document with money recorded, are refused too', async () => {
    const partial = { ...inv004(), status: 'partial', payments: [{ id: 'p', kind: 'manual', amount: 700 }], createdAt: new Date(), updatedAt: new Date(), issueDate: new Date(), dueDate: new Date() } as any;
    const saveInvoice = vi.fn(async () => {});
    useStore.setState({ documents: [], invoices: [partial], saveInvoice } as any);
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_set_total', quoteId: DOC_ID, targetTotal: 5000 });
    expect(!result.ok && result.error).toContain('money paid against it');
    expect(saveInvoice).not.toHaveBeenCalled();
    // A deposit against an accepted quote is money recorded, whatever the stage says.
    useStore.setState({ documents: [inv004({ type: 'quote', stage: 'quote_accepted', payments: [{ id: 'd', kind: 'deposit', amount: 300 }] } as any)], invoices: [] } as any);
    const deposit = await useStore.getState().applyProposal({ ...base, type: 'propose_set_total', quoteId: DOC_ID, targetTotal: 1232 });
    expect(!deposit.ok && deposit.error).toContain('money paid against it');
  });

  it('every other tool that moves money refuses a paid invoice too — a paid $1,415.70 must not read $7,202 marked paid', async () => {
    useStore.setState({ documents: [inv004({ stage: 'paid' } as any)] } as any);
    const attempts = [
      useStore.getState().applyProposal({ ...base, type: 'propose_delete_line_item', quoteId: DOC_ID, materialId: 'm1' }),
      useStore.getState().applyProposal({ ...base, type: 'propose_update_line_item', quoteId: DOC_ID, materialId: 'm1', price: 5000 }),
      useStore.getState().applyProposal({ ...base, type: 'propose_update_line_item', quoteId: DOC_ID, materialId: 'm1', quantity: 3 }),
      useStore.getState().applyProposal({ ...base, type: 'propose_update_quote_rates', quoteId: DOC_ID, laborHours: 40 }),
      useStore.getState().applyProposal({ ...base, type: 'propose_add_line_item', quoteId: DOC_ID, searchTerm: '90x45 treated pine', qty: 4, unit: 'each' }),
    ];
    for (const result of await Promise.all(attempts)) {
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain('money paid against it');
    }
    expect(stored().total).toBe(1415.7);
    expect(stored().materials).toHaveLength(1);
    // A rename moves no money and is still allowed.
    const rename = await useStore.getState().applyProposal({ ...base, type: 'propose_update_line_item', quoteId: DOC_ID, materialId: 'm1', name: 'Switchboard enclosure, 24 pole' });
    expect(rename.ok).toBe(true);
    expect(stored().total).toBe(1415.7);
  });

  it('reports the discount line it fell back to, and moves it rather than stacking a second', async () => {
    useStore.setState({ documents: [inv004({ sections: [], laborHours: 0, laborTotal: 0, subtotal: 549, total: 713.7 })] } as any);
    const first = await useStore.getState().applyProposal({ ...base, type: 'propose_set_total', quoteId: DOC_ID, targetTotal: 650 });
    expect(first.ok && first.moved).toBe(`a new "${DISCOUNT_NAME}" line at -$63.70`);
    const second = await useStore.getState().applyProposal({ ...base, type: 'propose_set_total', quoteId: DOC_ID, targetTotal: 700 });
    expect(second.ok && second.moved).toBe(`the "${DISCOUNT_NAME}" line at -$13.70`);
    expect(stored().total).toBe(700);
    expect(stored().materials.filter((m) => m.kind === 'work')).toHaveLength(1);
  });

  it('a legacy quote with a lump-sum section missing its figure is planned and saved as finite money, not NaN', async () => {
    const quote = {
      ...inv004(),
      sections: [{ id: 'l', name: 'Fixed', multiplier: 1, laborHours: 0, laborHoursTotal: 0, laborRate: 0, laborUnit: 'hours', sortOrder: 0, pricing: 'lumpSum' }],
      createdAt: new Date(), updatedAt: new Date(), status: 'draft',
    } as any;
    const saveQuote = vi.fn(async () => {});
    useStore.setState({ documents: [], quotes: [quote], saveQuote } as any);
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_set_total', quoteId: DOC_ID, targetTotal: 1500 });
    expect(result.ok && result.appliedTotal).toBe(1500);
    const stored = (saveQuote.mock.calls[0] as any)[0];
    expect(stored.total).toBe(1500);
    expect(Number.isFinite(stored.laborTotal)).toBe(true);
  });

  it('works on a legacy quote that is not in the documents cache yet', async () => {
    const quote = { ...inv004(), createdAt: new Date(), updatedAt: new Date(), status: 'draft' } as any;
    const saveQuote = vi.fn(async () => {});
    useStore.setState({ documents: [], quotes: [quote], saveQuote } as any);
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_set_total', quoteId: DOC_ID, targetTotal: 1232 });
    expect(result.ok && result.appliedTotal).toBe(1232);
    expect(saveQuote).toHaveBeenCalledTimes(1);
    expect((saveQuote.mock.calls[0] as any)[0].total).toBe(1232);
  });
});

describe('propose_add_line_item — lump sum', () => {
  it('lands a work item exactly as the inline editor mints one, and recalculates the total', async () => {
    const result = await useStore.getState().applyProposal({
      ...base,
      type: 'propose_add_line_item',
      quoteId: DOC_ID,
      searchTerm: 'Callout',
      qty: 1,
      unit: 'each',
      kind: 'work',
      price: 180,
      scope: 'Travel and attendance.',
    });
    expect(result.ok && result.appliedTotal).toBe(1595.7);
    const line = stored().materials.find((m) => m.name === 'Callout')!;
    expect(line).toMatchObject({
      kind: 'work',
      scope: 'Travel and attendance.',
      quantity: 1,
      unit: 'each',
      price: 180,
      totalPrice: 180,
      manualPriceOverride: true,
      pricingSource: 'manual',
      origin: 'manual',
    });
    expect(line.searchTerm).toBeUndefined();
    // No markup on a lump sum: 549 × 30% is still the whole markup.
    expect(stored().markupAmount).toBe(164.7);
    expect(stored().total).toBe(1595.7);
  });

  it('converts a figure said inc GST onto an ex-GST document, and leaves an unsaid basis alone', async () => {
    useStore.setState({
      documents: [inv004({ gstRegistered: true, pricesIncludeGst: false })],
      businessSettings: { businessName: 'x', defaultLaborRate: 90, defaultMarkup: 30, pricesIncludeGst: false, gstRegistered: true },
    } as any);
    await useStore.getState().applyProposal({ ...base, type: 'propose_add_line_item', quoteId: DOC_ID, searchTerm: 'Disposal', qty: 1, unit: 'each', kind: 'work', price: 110, pricesIncludeGst: true });
    expect(stored().materials.find((m) => m.name === 'Disposal')!.price).toBe(100);
    await useStore.getState().applyProposal({ ...base, type: 'propose_add_line_item', quoteId: DOC_ID, searchTerm: 'Skip', qty: 1, unit: 'each', kind: 'work', price: 110 });
    expect(stored().materials.find((m) => m.name === 'Skip')!.price).toBe(110);
  });

  it('is not gated on the plan — no pipeline runs for a lump sum', async () => {
    useStore.setState({ getEffectivePlan: () => 'free' } as any);
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_add_line_item', quoteId: DOC_ID, searchTerm: 'Callout', qty: 1, unit: 'each', kind: 'work', price: 180 });
    expect(result.ok).toBe(true);
  });
});

describe('propose_update_line_item on a lump sum', () => {
  beforeEach(() => {
    useStore.setState({
      documents: [inv004({ materials: [gear(), { id: 'w1', name: 'Callout', kind: 'work', quantity: 1, unit: 'each', price: 180, totalPrice: 180, manualPriceOverride: true, pricingSource: 'manual' } as Material] })],
    } as any);
  });

  it('sets the line total, keeps quantity 1 whatever was passed, and never writes the supplier book', async () => {
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_update_line_item', quoteId: DOC_ID, materialId: 'w1', price: 220, quantity: 3 });
    expect(result.ok).toBe(true);
    const line = stored().materials.find((m) => m.id === 'w1')!;
    expect(line).toMatchObject({ kind: 'work', quantity: 1, price: 220, totalPrice: 220 });
    await new Promise((r) => setTimeout(r, 0));
    expect(remember.rememberMaterialPrice).not.toHaveBeenCalled();
  });

  it('a real material still reaches the book', async () => {
    await useStore.getState().applyProposal({ ...base, type: 'propose_update_line_item', quoteId: DOC_ID, materialId: 'm1', price: 500 });
    await vi.waitFor(() => expect(remember.rememberMaterialPrice).toHaveBeenCalledTimes(1));
  });
});

describe('stored totals follow every line edit on the Document path', () => {
  it('add, update and delete each leave total = materials + markup + labour', async () => {
    const add = await useStore.getState().applyProposal({ ...base, type: 'propose_add_line_item', quoteId: DOC_ID, searchTerm: 'Callout', qty: 1, unit: 'each', kind: 'work', price: 180 });
    expect(add.ok && add.appliedTotal).toBe(1595.7);
    expect(stored().total).toBe(1595.7);

    const update = await useStore.getState().applyProposal({ ...base, type: 'propose_update_line_item', quoteId: DOC_ID, materialId: 'm1', price: 600 });
    // 600 + 180 + 702 + 600 × 30% = 1662
    expect(update.ok && update.appliedTotal).toBe(1662);
    expect(stored().materialsSubtotal).toBe(780);
    expect(stored().markupAmount).toBe(180);
    expect(stored().total).toBe(1662);

    const del = await useStore.getState().applyProposal({ ...base, type: 'propose_delete_line_item', quoteId: DOC_ID, materialId: 'm1' });
    expect(del.ok && del.appliedTotal).toBe(882);
    expect(stored().total).toBe(882);
  });
});

describe('a legacy quote (not yet mirrored into documents)', () => {
  it('delete-line recalculates and reports the total there too', async () => {
    const quote = { ...inv004(), materials: [gear(), gear({ id: 'm2', price: 100, totalPrice: 100 })], createdAt: new Date(), updatedAt: new Date(), status: 'draft' } as any;
    const saveQuote = vi.fn(async () => {});
    useStore.setState({ documents: [], quotes: [quote], saveQuote } as any);
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_delete_line_item', quoteId: DOC_ID, materialId: 'm2' });
    // 549 + 702 + 164.7
    expect(result.ok && result.appliedTotal).toBe(1415.7);
    expect((saveQuote.mock.calls[0] as any)[0].total).toBe(1415.7);
  });
});

describe('propose_update_quote_rates on a sectioned document', () => {
  it('labour hours move the money through extra hours instead of a display field', async () => {
    const two = await useStore.getState().applyProposal({ ...base, type: 'propose_update_quote_rates', quoteId: DOC_ID, laborHours: 2 });
    // 549 + 164.7 + 2 h × $90 = 893.7 (INV-004 read $1,415.70 after this call, twice)
    expect(two.ok && two.appliedTotal).toBe(893.7);
    expect(stored().laborTotal).toBe(180);
    expect(stored().laborExtraHours).toBeCloseTo(-5.8, 4);
    const eight = await useStore.getState().applyProposal({ ...base, type: 'propose_update_quote_rates', quoteId: DOC_ID, laborHours: 8 });
    expect(eight.ok && eight.appliedTotal).toBe(1433.7);
    expect(stored().laborTotal).toBe(720);
  });

  it('a new labour rate is written onto every hourly section', async () => {
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_update_quote_rates', quoteId: DOC_ID, laborRate: 100 });
    // 7.8 h × $100 = 780 labour → 549 + 164.7 + 780 = 1493.7
    expect(result.ok && result.appliedTotal).toBe(1493.7);
    expect(stored().sections!.map((s) => [s.laborRate, s.laborTotal])).toEqual([[100, 450], [100, 200], [100, 130]]);
  });

  it('a lump-sum section is left alone by a rate change', async () => {
    useStore.setState({
      documents: [inv004({ sections: [section('a', 4.5), { id: 'l', name: 'Fixed', multiplier: 1, laborHours: 0, laborHoursTotal: 0, laborRate: 0, laborUnit: 'hours', laborTotal: 300, sortOrder: 1, pricing: 'lumpSum' }] })],
    } as any);
    await useStore.getState().applyProposal({ ...base, type: 'propose_update_quote_rates', quoteId: DOC_ID, laborRate: 100 });
    expect(stored().sections!.find((s) => s.id === 'l')!.laborTotal).toBe(300);
    expect(stored().sections!.find((s) => s.id === 'a')!.laborTotal).toBe(450);
  });
});

describe('propose_pick_contact', () => {
  const picked = { id: 'phone-1', firstName: 'Sue', lastName: 'Williamson', phoneNumbers: [{ number: '0428 753 564' }], emails: [{ email: 'sue@example.com' }] };

  it('saves the pick as a contact and re-points the quote at it', async () => {
    contactsMock.presentContactPickerAsync.mockResolvedValueOnce(picked);
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_pick_contact', quoteId: DOC_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pickedContact).toMatchObject({ name: 'Sue Williamson', phone: '0428 753 564', email: 'sue@example.com' });
    expect(result.navigate).toEqual({ kind: 'job_preview', quoteId: DOC_ID });
    expect(useStore.getState().contacts).toHaveLength(1);
    expect(stored()).toMatchObject({ customerName: 'Sue Williamson', customerPhone: '0428 753 564', contactId: result.pickedContact!.id });
    // iOS needs no permission for the picker — none was asked for.
    expect(contactsMock.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('links an already-saved contact with the same number instead of making a second one', async () => {
    const existing: Contact = { id: 'saved-1', name: 'Sue and Peter Williamson', phone: '+61 428 753 564', source: 'manual', createdAt: '', updatedAt: '' };
    useStore.setState({ contacts: [existing] } as any);
    contactsMock.presentContactPickerAsync.mockResolvedValueOnce(picked);
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_pick_contact', quoteId: DOC_ID });
    expect(result.ok && result.pickedContact?.id).toBe('saved-1');
    expect(useStore.getState().contacts).toHaveLength(1);
  });

  it('with no quote, hands the saved pick back for the draft', async () => {
    contactsMock.presentContactPickerAsync.mockResolvedValueOnce(picked);
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_pick_contact' });
    expect(result.ok && result.pickedContact?.name).toBe('Sue Williamson');
    expect(result.ok && result.navigate).toBeUndefined();
    expect(stored().customerName).toBe('Sue and Peter Williamson');
  });

  it('a phone-book entry with no number or email links the saved contact of the same name', async () => {
    const existing: Contact = { id: 'saved-2', name: 'Diane Bunk', source: 'manual', createdAt: '', updatedAt: '' };
    useStore.setState({ contacts: [existing] } as any);
    contactsMock.presentContactPickerAsync.mockResolvedValueOnce({ id: 'phone-2', firstName: 'Diane', lastName: 'Bunk' });
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_pick_contact' });
    expect(result.ok && result.pickedContact?.id).toBe('saved-2');
    expect(useStore.getState().contacts).toHaveLength(1);
  });

  it('a closed picker is a cancel, not a failure', async () => {
    contactsMock.presentContactPickerAsync.mockResolvedValueOnce(null);
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_pick_contact', quoteId: DOC_ID });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('CANCELLED');
    expect(useStore.getState().contacts).toHaveLength(0);
  });

  it('asks Android for READ_CONTACTS and says so plainly when it is off', async () => {
    platform.OS = 'android';
    contactsMock.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied', canAskAgain: false } as any);
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_pick_contact', quoteId: DOC_ID });
    expect(!result.ok && result.error).toContain('Contacts access is off');
    expect(!result.ok && result.code).toBe('CONTACTS_DENIED');
    expect(!result.ok && result.canAskAgain).toBe(false);
    expect(contactsMock.presentContactPickerAsync).not.toHaveBeenCalled();
  });

  it('a first Android denial says the phone will ask again, not to go to Settings', async () => {
    platform.OS = 'android';
    contactsMock.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied', canAskAgain: true } as any);
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_pick_contact', quoteId: DOC_ID });
    expect(!result.ok && result.code).toBe('CONTACTS_DENIED');
    expect(!result.ok && result.canAskAgain).toBe(true);
    expect(!result.ok && result.error).toContain("ask for contacts access again");
    expect(contactsMock.presentContactPickerAsync).not.toHaveBeenCalled();
  });

  it('on Android with access already granted it opens the picker without asking again', async () => {
    platform.OS = 'android';
    contactsMock.getPermissionsAsync.mockResolvedValueOnce({ status: 'granted', canAskAgain: true } as any);
    await useStore.getState().applyProposal({ ...base, type: 'propose_pick_contact', quoteId: DOC_ID });
    expect(contactsMock.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(contactsMock.presentContactPickerAsync).toHaveBeenCalledTimes(1);
  });

  it('a picker that throws is a plain failure with a usable line, and saves nothing', async () => {
    contactsMock.presentContactPickerAsync.mockImplementationOnce(() => {
      throw new Error("Cannot find native module 'ExpoContacts'");
    });
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_pick_contact', quoteId: DOC_ID });
    expect(!result.ok && result.error).toContain("Couldn't open the phone's contacts");
    expect(!result.ok && result.code).toBeUndefined();
    expect(useStore.getState().contacts).toHaveLength(0);
  });

  it('has no picker on the web', async () => {
    platform.OS = 'web';
    const result = await useStore.getState().applyProposal({ ...base, type: 'propose_pick_contact' });
    expect(!result.ok && result.error).toContain('web');
  });
});
