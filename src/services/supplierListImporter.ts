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

// Lazy-import FileSystem — only available on native
let FileSystem: typeof import('expo-file-system') | null = null;
if (Platform.OS !== 'web') {
  FileSystem = require('expo-file-system');
}

export interface ExtractedItem {
  name: string;
  price: number;
  unit: string;
  coveragePerUnit?: number;
  coverageUnit?: 'm²' | 'm³' | 'm';
  keywords: string[];
  confidence: 'high' | 'medium' | 'low';
  rawLine?: string;
}

export interface ExtractResult {
  supplierName: string;
  items: ExtractedItem[];
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
  return {
    name: (raw?.name || '').toString().trim(),
    price,
    unit: (raw?.unit || 'each').toString().trim(),
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
 * Extract a supplier price list from one or more photos.
 */
export async function extractFromPhotos(
  uris: string[],
  supplierName?: string,
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
  });

  return {
    supplierName: result.supplierName || supplierName || '',
    items: (result.items || []).map(normaliseItem).filter(i => i.name && i.price > 0),
  };
}

/**
 * Extract a supplier price list from a single PDF file.
 */
export async function extractFromPdf(
  uri: string,
  supplierName?: string,
): Promise<ExtractResult> {
  if (!uri) throw new Error('No PDF provided');

  const pdfBase64 = await readBase64(uri);
  if (pdfBase64.length > MAX_PDF_BYTES_BASE64) {
    throw new Error('PDF too large (max 10 MB)');
  }

  const result = await extractViaFunction({
    pdfBase64,
    supplierName,
  });

  return {
    supplierName: result.supplierName || supplierName || '',
    items: (result.items || []).map(normaliseItem).filter(i => i.name && i.price > 0),
  };
}
