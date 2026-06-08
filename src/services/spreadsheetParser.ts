/**
 * Spreadsheet Parser
 *
 * Reads a user-supplied CSV / XLSX / XLS file and turns it into the same
 * `ExtractResult` shape that the photo + PDF importers produce, so the
 * downstream review modal and `persistImportToSupplierBook()` flow work
 * unchanged.
 *
 * Two-step pipeline so the UI can ask the user for help if needed:
 *   1. `parseSpreadsheet(uri)` → raw headers + rows (purely local, no LLM).
 *   2. `autoDetectMapping(headers)` → best-guess column mapping, or null.
 *      - If non-null, callers can immediately call `buildExtractFromMapping()`.
 *      - If null, callers show the column-mapping modal so the user maps
 *        their columns onto our schema, then call `buildExtractFromMapping()`.
 *
 * Spreadsheets rarely embed supplier contact info, so this importer never
 * produces an `ExtractedSupplierContact`. The supplier name is also left
 * empty — the review modal collects it.
 */

import * as XLSX from 'xlsx';
import Papa from 'papaparse';

import type { ExtractedItem, ExtractResult } from './supplierListImporter';

// All react-native / expo dependencies are loaded lazily inside the file-
// reading helpers so this module stays import-safe for Node-based tests
// (vitest can't transform react-native's Flow source).
function getPlatform(): { OS: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native').Platform;
  } catch {
    return { OS: 'node' };
  }
}

function getFileSystem(): typeof import('expo-file-system') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-file-system');
  } catch {
    return null;
  }
}

export interface ParsedSpreadsheet {
  headers: string[];
  /** Each row is { [header]: cellString }. Numbers/dates are stringified. */
  rows: Record<string, string>[];
  /** Original sheet names if the source was XLSX with multiple sheets. */
  sheetNames?: string[];
  /** Which sheet we actually used (XLSX only). */
  selectedSheet?: string;
  /** Source file extension we detected ('csv' | 'xlsx' | 'xls'). */
  kind: 'csv' | 'xlsx' | 'xls';
}

export interface ColumnMapping {
  name: string;
  price: string;
  unit?: string;
  qty?: string;
  coveragePerUnit?: string;
  coverageUnit?: string;
  keywords?: string;
}

const MAX_ROWS = 2000;

// ─── File reading ──────────────────────────────────────────────────────────

async function readText(uri: string): Promise<string> {
  if (getPlatform().OS === 'web') {
    const res = await fetch(uri);
    return await res.text();
  }
  const FileSystem = getFileSystem();
  if (!FileSystem) throw new Error('FileSystem unavailable');
  return await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

async function readBase64(uri: string): Promise<string> {
  if (getPlatform().OS === 'web') {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  const FileSystem = getFileSystem();
  if (!FileSystem) throw new Error('FileSystem unavailable');
  return await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

function inferKind(
  uri: string,
  fileName?: string,
  mimeType?: string,
): 'csv' | 'xlsx' | 'xls' {
  const lowered = (fileName || uri).toLowerCase();
  if (lowered.endsWith('.csv')) return 'csv';
  if (lowered.endsWith('.xlsx')) return 'xlsx';
  if (lowered.endsWith('.xls')) return 'xls';
  if (mimeType?.includes('csv')) return 'csv';
  if (mimeType?.includes('spreadsheetml')) return 'xlsx';
  if (mimeType?.includes('ms-excel')) return 'xls';
  // Reasonable default — xlsx covers both modern formats.
  return 'xlsx';
}

// ─── Parsing ──────────────────────────────────────────────────────────────

function pickHeaderRow(matrix: any[][]): number {
  // Heuristic: pick the first row in the top 5 where ≥2 cells are non-empty
  // short strings and no cell is purely numeric. Falls back to row 0.
  const limit = Math.min(5, matrix.length);
  for (let i = 0; i < limit; i++) {
    const row = matrix[i] || [];
    const cells = row.map(c => (c == null ? '' : String(c).trim())).filter(Boolean);
    if (cells.length < 2) continue;
    const allText = cells.every(c => c.length <= 60 && !/^-?\$?\d+(\.\d+)?$/.test(c));
    if (allText) return i;
  }
  return 0;
}

function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, idx) => {
    const base = (h || `Column ${idx + 1}`).toString().trim() || `Column ${idx + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base} (${n + 1})`;
  });
}

function matrixToParsed(
  matrix: any[][],
  kind: 'csv' | 'xlsx' | 'xls',
  sheetNames?: string[],
  selectedSheet?: string,
): ParsedSpreadsheet {
  if (!matrix.length) {
    return { headers: [], rows: [], kind, sheetNames, selectedSheet };
  }
  const headerIdx = pickHeaderRow(matrix);
  const rawHeaders: string[] = (matrix[headerIdx] || []).map(c =>
    c == null ? '' : String(c).trim(),
  );
  const headers = dedupeHeaders(rawHeaders);
  const dataRows = matrix.slice(headerIdx + 1, headerIdx + 1 + MAX_ROWS);
  const rows: Record<string, string>[] = dataRows
    .map(row => {
      const obj: Record<string, string> = {};
      let hasValue = false;
      headers.forEach((h, i) => {
        const raw = row?.[i];
        const cell = raw == null ? '' : String(raw).trim();
        if (cell) hasValue = true;
        obj[h] = cell;
      });
      return hasValue ? obj : null;
    })
    .filter((r): r is Record<string, string> => r !== null);
  return { headers, rows, kind, sheetNames, selectedSheet };
}

export async function parseSpreadsheet(
  uri: string,
  fileName?: string,
  mimeType?: string,
): Promise<ParsedSpreadsheet> {
  const kind = inferKind(uri, fileName, mimeType);

  if (kind === 'csv') {
    const text = await readText(uri);
    // header:false → we get a raw matrix and apply our header-row heuristic.
    const result = Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: 'greedy',
    });
    const matrix = (result.data as any[]).filter(Array.isArray) as any[][];
    return matrixToParsed(matrix, kind);
  }

  // xlsx / xls
  const b64 = await readBase64(uri);
  const workbook = XLSX.read(b64, { type: 'base64' });
  if (!workbook.SheetNames.length) {
    return { headers: [], rows: [], kind, sheetNames: [] };
  }
  // Pick the first sheet with ≥1 non-empty row; fall back to first.
  const sheetNames = workbook.SheetNames;
  let chosen = sheetNames[0];
  for (const name of sheetNames) {
    const ws = workbook.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false });
    if (matrix.length) {
      chosen = name;
      const parsed = matrixToParsed(matrix as any[][], kind, sheetNames, name);
      return parsed;
    }
  }
  return matrixToParsed([], kind, sheetNames, chosen);
}

// ─── Auto-detection ────────────────────────────────────────────────────────

const NAME_PATTERNS = [
  /\bproduct( ?name)?\b/i,
  /\bitem( ?name| ?description)?\b/i,
  /\bdescription\b/i,
  /\bsku ?description\b/i,
  /\bmaterial\b/i,
  /^name$/i,
  /^title$/i,
];

const PRICE_PATTERNS = [
  /\bunit ?(price|cost|rate)\b/i,
  /\b(ex ?gst|excl)\b.*\bprice|cost|rate/i,
  /\bprice ?(ex|excl|net)?\b/i,
  /\bcost\b/i,
  /\brate\b/i,
  /\bsell\b/i,
  /\bamount\b/i,
];

const UNIT_PATTERNS = [/^unit$/i, /\buom\b/i, /\bunit ?of ?measure\b/i, /\bpack ?size\b/i];

const QTY_PATTERNS = [/^qty$/i, /^quantity$/i, /\bpack\b/i];

const COVERAGE_PATTERNS = [/coverage/i, /\barea\b/i, /m2 ?per|per ?m2|m² ?per|per ?m²/i];

const COVERAGE_UNIT_PATTERNS = [/coverage ?unit/i, /coverage ?type/i];

const KEYWORDS_PATTERNS = [/keywords?/i, /tags?/i];

function matchFirst(headers: string[], patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const hit = headers.find(h => p.test(h));
    if (hit) return hit;
  }
  return undefined;
}

export function autoDetectMapping(headers: string[]): ColumnMapping | null {
  const name = matchFirst(headers, NAME_PATTERNS);
  const price = matchFirst(headers, PRICE_PATTERNS);
  if (!name || !price) return null;
  return {
    name,
    price,
    unit: matchFirst(headers, UNIT_PATTERNS),
    qty: matchFirst(headers, QTY_PATTERNS),
    coveragePerUnit: matchFirst(headers, COVERAGE_PATTERNS),
    coverageUnit: matchFirst(headers, COVERAGE_UNIT_PATTERNS),
    keywords: matchFirst(headers, KEYWORDS_PATTERNS),
  };
}

// ─── Unit + price normalisation ────────────────────────────────────────────

export function normaliseUnit(raw: string | undefined): string {
  if (!raw) return 'each';
  const s = raw.toString().trim().toLowerCase();
  if (!s) return 'each';
  if (['ea', 'each', 'pc', 'pcs', 'piece', 'unit', 'no', 'no.'].includes(s)) return 'each';
  if (['m', 'lm', 'mtr', 'metre', 'meter'].includes(s)) return 'm';
  if (['m2', 'm²', 'sqm', 'sq.m', 'sqmtr', 'square metre', 'square meter'].includes(s))
    return 'm²';
  if (['m3', 'm³', 'cbm', 'cu.m', 'cubic metre', 'cubic meter'].includes(s)) return 'm³';
  if (['l', 'lt', 'ltr', 'litre', 'liter'].includes(s)) return 'L';
  if (['kg', 'kilogram', 'kilo'].includes(s)) return 'kg';
  if (['box', 'bx', 'ctn', 'carton'].includes(s)) return 'box';
  if (['pack', 'pk', 'pkt', 'packet'].includes(s)) return 'pack';
  // Pass through anything else trimmed; review modal will accept manual edits.
  return raw.toString().trim();
}

function parsePrice(raw: string | undefined): number {
  if (!raw) return 0;
  // Strip currency symbols, commas, whitespace, trailing notes like "+gst".
  const cleaned = raw
    .toString()
    .replace(/[$£€,\s]/g, '')
    .replace(/\b(inc|incl|ex|excl|gst|nett?|each|ea)\b/gi, '')
    .trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseQty(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw.toString().replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(9999, Math.max(1, Math.round(n)));
}

function parseCoverageUnit(raw: string | undefined): 'm²' | 'm³' | 'm' | undefined {
  if (!raw) return undefined;
  const u = normaliseUnit(raw);
  if (u === 'm²' || u === 'm³' || u === 'm') return u;
  return undefined;
}

function parseKeywords(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .toString()
    .split(/[,;|]/)
    .map(k => k.trim().toLowerCase())
    .filter(Boolean);
}

// ─── Build ExtractResult ───────────────────────────────────────────────────

export interface BuildOptions {
  supplierName?: string;
}

export function buildExtractFromMapping(
  parsed: ParsedSpreadsheet,
  mapping: ColumnMapping,
  opts: BuildOptions = {},
): ExtractResult {
  const items: ExtractedItem[] = [];
  for (const row of parsed.rows) {
    const name = (row[mapping.name] || '').toString().trim();
    const price = parsePrice(row[mapping.price]);
    if (!name || price <= 0) continue;
    const item: ExtractedItem = {
      name,
      price,
      unit: normaliseUnit(mapping.unit ? row[mapping.unit] : undefined),
      qty: mapping.qty ? parseQty(row[mapping.qty]) : undefined,
      coveragePerUnit: mapping.coveragePerUnit
        ? (() => {
            const n = parseFloat((row[mapping.coveragePerUnit!] || '').toString());
            return Number.isFinite(n) && n > 0 ? n : undefined;
          })()
        : undefined,
      coverageUnit: mapping.coverageUnit
        ? parseCoverageUnit(row[mapping.coverageUnit])
        : undefined,
      keywords: mapping.keywords ? parseKeywords(row[mapping.keywords]) : [],
      confidence: 'high',
    };
    items.push(item);
  }
  return {
    supplierName: opts.supplierName || '',
    supplierContact: undefined,
    items,
  };
}
