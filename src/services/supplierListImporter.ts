/**
 * Supplier List Importer
 *
 * Reads one or more supplier price list photos (or a single PDF) on the
 * client, compresses/base64-encodes them, and asks the vision model
 * (via Firebase Functions) to extract every line item.
 *
 * The result is handed to the review modal in AddMaterialScreen, where the
 * user picks which rows to persist via bulkSaveFavorites().
 */

import { Platform } from 'react-native';
import { compressImage } from './photoService';
import { extractSupplierPriceList as extractViaFunction } from './llmService';
import { generateId } from '../utils/generateId';
import { bulkSaveFavorites } from './materialFavorites';
import { getSupplierGroupByName, loadGroups, saveGroup } from './supplierGroupService';
import type { FavoriteProductMapping, Material, SupplierGroup } from '../types';

// Lazy-import FileSystem — only available on native
let FileSystem: typeof import('expo-file-system') | null = null;
if (Platform.OS !== 'web') {
  FileSystem = require('expo-file-system');
}

export type ExtractionMode = 'priceList' | 'invoice';

export interface ExtractedItem {
  name: string;
  price: number;
  unit: string;
  qty?: number;
  coveragePerUnit?: number;
  coverageUnit?: 'm²' | 'm³' | 'm';
  keywords: string[];
  confidence: 'high' | 'medium' | 'low';
  rawLine?: string;
}

export interface ExtractedSupplierContact {
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
}

export interface ExtractResult {
  supplierName: string;
  supplierContact?: ExtractedSupplierContact;
  items: ExtractedItem[];
}

function normaliseContact(raw: any): ExtractedSupplierContact | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const clean = (v: any): string | undefined => {
    if (v === null || v === undefined) return undefined;
    const s = v.toString().trim();
    return s ? s : undefined;
  };
  const contact: ExtractedSupplierContact = {
    contactPerson: clean(raw.contactPerson),
    phone: clean(raw.phone),
    email: clean(raw.email),
    address: clean(raw.address),
    website: clean(raw.website),
  };
  // Drop the object entirely if no field survived.
  const hasAny = Object.values(contact).some(v => !!v);
  return hasAny ? contact : undefined;
}

const MAX_IMAGES = 10;
const MAX_PDF_BYTES_BASE64 = 14_000_000; // ~10 MB raw

function normaliseItem(raw: any): ExtractedItem {
  const price = typeof raw?.price === 'number' ? raw.price : parseFloat(raw?.price) || 0;
  const confidenceRaw = (raw?.confidence || '').toString().toLowerCase();
  const confidence: 'high' | 'medium' | 'low' =
    confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
      ? confidenceRaw
      : 'medium';
  let qty: number | undefined;
  if (raw?.qty !== undefined && raw?.qty !== null) {
    const parsedQty = typeof raw.qty === 'number' ? raw.qty : parseFloat(raw.qty);
    if (Number.isFinite(parsedQty) && parsedQty > 0) {
      qty = Math.min(9999, Math.max(1, Math.round(parsedQty)));
    }
  }
  return {
    name: (raw?.name || '').toString().trim(),
    price,
    unit: (raw?.unit || 'each').toString().trim(),
    qty,
    coveragePerUnit:
      typeof raw?.coveragePerUnit === 'number' && raw.coveragePerUnit > 0
        ? raw.coveragePerUnit
        : undefined,
    coverageUnit:
      raw?.coverageUnit === 'm²' || raw?.coverageUnit === 'm³' || raw?.coverageUnit === 'm'
        ? raw.coverageUnit
        : undefined,
    keywords: Array.isArray(raw?.keywords)
      ? raw.keywords.map((k: any) => k.toString().toLowerCase()).filter(Boolean)
      : [],
    confidence,
    rawLine: raw?.rawLine ? raw.rawLine.toString() : undefined,
  };
}

async function readBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    // Convert blob URL or data URL to base64 via fetch
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // strip "data:<mime>;base64," prefix if present
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  if (!FileSystem) throw new Error('FileSystem unavailable');
  return await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

/**
 * Extract a supplier price list (or invoice) from one or more photos.
 */
export async function extractFromPhotos(
  uris: string[],
  supplierName?: string,
  mode: ExtractionMode = 'priceList',
): Promise<ExtractResult> {
  if (!Array.isArray(uris) || uris.length === 0) {
    throw new Error('No photos provided');
  }
  if (uris.length > MAX_IMAGES) {
    throw new Error(`Maximum ${MAX_IMAGES} photos per import`);
  }

  const imageBase64: string[] = [];
  for (const uri of uris) {
    const compressed = await compressImage(uri);
    const b64 = await readBase64(compressed);
    imageBase64.push(b64);
  }

  const result = await extractViaFunction({
    imageBase64,
    supplierName,
    mode,
  });

  return {
    supplierName: result.supplierName || supplierName || '',
    supplierContact: normaliseContact(result.supplierContact),
    items: (result.items || []).map(normaliseItem).filter(i => i.name && i.price > 0),
  };
}

/**
 * Extract a supplier price list (or invoice) from a single PDF file.
 */
export async function extractFromPdf(
  uri: string,
  supplierName?: string,
  mode: ExtractionMode = 'priceList',
): Promise<ExtractResult> {
  if (!uri) throw new Error('No PDF provided');

  const pdfBase64 = await readBase64(uri);
  if (pdfBase64.length > MAX_PDF_BYTES_BASE64) {
    throw new Error('PDF too large (max 10 MB)');
  }

  const result = await extractViaFunction({
    pdfBase64,
    supplierName,
    mode,
  });

  return {
    supplierName: result.supplierName || supplierName || '',
    supplierContact: normaliseContact(result.supplierContact),
    items: (result.items || []).map(normaliseItem).filter(i => i.name && i.price > 0),
  };
}

export interface ImportFavoriteRow {
  name: string;
  price: number;
  unit: string;
  coveragePerUnit?: number;
  coverageUnit?: 'm²' | 'm³' | 'm';
  keywords?: string[];
}

/**
 * Save a batch of imported items to the supplier book under a single supplier
 * name and (if a contact is supplied) merge contact details into that
 * supplier's SupplierGroup record. Used by both the supplier-list import
 * (price list mode) and invoice import flows.
 *
 * Returns the same kind of summary `useSupplierListImport.handleSaveImported`
 * already produces so callers can reuse their snackbar copy.
 */
export async function persistImportToSupplierBook(args: {
  supplierName: string;
  rows: ImportFavoriteRow[];
  contact?: ExtractedSupplierContact;
}): Promise<{
  itemCount: number;
  unchanged: number;
  contactFieldsApplied: number;
  itemNames: string[];
}> {
  const { supplierName, rows, contact } = args;
  const importBatchId = generateId();
  const nowIso = new Date().toISOString();

  const toSave: Array<Partial<FavoriteProductMapping> & { productName: string }> = rows.map(item => ({
    productName: item.name,
    store: supplierName || 'Supplier',
    unit: item.unit as Material['unit'],
    price: item.price,
    coveragePerUnit: item.coveragePerUnit,
    coverageUnit: item.coverageUnit,
    keywords: item.keywords,
    source: 'imported' as const,
    sourceRef: importBatchId,
    isPersonalRate: true,
    lastUpdatedAt: nowIso,
  }));

  const counts =
    toSave.length > 0
      ? await bulkSaveFavorites(toSave)
      : { created: 0, updated: 0, unchanged: 0 };

  let contactFieldsApplied = 0;
  if (contact && supplierName) {
    try {
      const existing = await getSupplierGroupByName(supplierName);
      const pickIfMissing = (current: string | undefined, incoming: string | undefined) => {
        if (current && current.trim()) return { value: current, applied: false };
        if (incoming && incoming.trim()) return { value: incoming.trim(), applied: true };
        return { value: current, applied: false };
      };

      const contactPerson = pickIfMissing(existing?.contactPerson, contact.contactPerson);
      const phone = pickIfMissing(existing?.phone, contact.phone);
      const email = pickIfMissing(existing?.email, contact.email);
      const address = pickIfMissing(existing?.address, contact.address);
      const website = pickIfMissing(existing?.searchUrl, contact.website);

      contactFieldsApplied =
        (contactPerson.applied ? 1 : 0) +
        (phone.applied ? 1 : 0) +
        (email.applied ? 1 : 0) +
        (address.applied ? 1 : 0) +
        (website.applied ? 1 : 0);

      if (contactFieldsApplied > 0) {
        const now = new Date().toISOString();
        const record: SupplierGroup = existing
          ? {
              ...existing,
              contactPerson: contactPerson.value || undefined,
              phone: phone.value || undefined,
              email: email.value || undefined,
              address: address.value || undefined,
              searchUrl: website.value || undefined,
              updatedAt: now,
            }
          : {
              id: generateId(),
              name: supplierName.trim(),
              contactPerson: contactPerson.value || undefined,
              phone: phone.value || undefined,
              email: email.value || undefined,
              address: address.value || undefined,
              searchUrl: website.value || undefined,
              sortOrder: (await loadGroups()).length,
              createdAt: now,
              updatedAt: now,
            };
        await saveGroup(record);
      }
    } catch {
      // Don't block — items are already saved.
    }
  }

  return {
    itemCount: counts.created + counts.updated,
    unchanged: counts.unchanged,
    contactFieldsApplied,
    itemNames: rows.map(r => r.name).slice(0, 3),
  };
}
