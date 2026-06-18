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

// Node `fs` fallback — only resolves under Node/vitest, never in the RN bundle.
// Lets the unit tests run a real supplier spreadsheet end-to-end through
// parseSpreadsheet() exactly as the app would on a device.
function getNodeFs(): typeof import('fs') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('fs');
  } catch {
    return null;
  }
}

function stripFileUri(uri: string): string {
  return uri.replace(/^file:\/\//, '');
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
  /**
   * Product name. Usually a single header, but supplier sheets often split the
   * identity across columns (e.g. Style/Range + Colour) with no single "name"
   * column — in that case we compose them, in order, with " — ".
   */
  name: string | string[];
  price: string;
  unit?: string;
  qty?: string;
  coveragePerUnit?: string;
  coverageUnit?: string;
  keywords?: string;
  /** One or more dimension columns (Length/Width/Thickness) joined with " × ". */
  dimensions?: string | string[];
  /** Supplier/product code → FavoriteProductMapping.itemNumber. */
  itemNumber?: string;
  /** Descriptive attribute columns (warranty, country, rating…) kept as notes. */
  notes?: string | string[];
}

export type MappingConfidence = 'high' | 'medium' | 'low';

const MAX_ROWS = 2000;

// ─── File reading ──────────────────────────────────────────────────────────

async function readText(uri: string): Promise<string> {
  if (getPlatform().OS === 'web') {
    const res = await fetch(uri);
    return await res.text();
  }
  const FileSystem = getFileSystem();
  if (FileSystem) {
    return await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  }
  const fs = getNodeFs();
  if (fs) return fs.readFileSync(stripFileUri(uri), 'utf8');
  throw new Error('FileSystem unavailable');
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
  if (FileSystem) {
    return await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }
  const fs = getNodeFs();
  if (fs) return fs.readFileSync(stripFileUri(uri)).toString('base64');
  throw new Error('FileSystem unavailable');
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

// Collapse internal whitespace/newlines so multi-word headers that real
// supplier exports wrap across lines — "Supplier\nCode", "m²\nper pack",
// "Length\nmm" — still match patterns written with single spaces.
function norm(h: string): string {
  return (h || '').replace(/\s+/g, ' ').trim();
}

// An explicit, single-column product name/description.
const NAME_PRIMARY_PATTERNS = [
  /\b(product|item|sku)\s?(name|description)\b/i,
  /\bdescription\b/i,
  /^name$/i,
  /^title$/i,
  /\bmaterial\b/i,
];

// Identity components — when there's no single name column, these combine to
// describe the product (e.g. a flooring line split into Style/Range + Colour).
const NAME_COMPONENT_PATTERNS = [
  /\bstyle\b/i,
  /\brange\b/i,
  /\bcollection\b/i,
  /\bdesign\b/i,
  /\bd[eé]cor\b/i,
  /\bpattern\b/i,
  /\bcolou?r\b/i,
  /\bspecies\b/i,
  /\bmodel\b/i,
];

// Loose fallback — clearly a name, but NOT a bare type/category column.
const NAME_LOOSE_PATTERNS = [/\bitem\b/i, /\bproduct\b/i, /\btitle\b/i, /\bname\b/i];

const PRICE_PATTERNS = [
  /\bunit\s?(price|cost|rate)\b/i,
  /\b(buy|trade|net|sell)\s?(price|cost|rate)\b/i,
  /\bprice\s?(ex|excl|net)?\b/i,
  /\bcost\b/i,
  /\brate\b/i,
  /\bsell\b/i,
  /\bamount\b/i,
];

const UNIT_PATTERNS = [/^unit$/i, /\buom\b/i, /\bunit\s?of\s?measure\b/i];

// Ordered most-specific → loosest. "Qty per pack" must win over "m² per pack";
// the bare \bpack\b that used to live here is gone because it grabbed coverage.
const QTY_PATTERNS = [
  /^qty$/i,
  /^quantity$/i,
  /\bqty\b/i,
  /\bquantity\b/i,
  /\bpack\s?qty\b/i,
  /\bunits?\s?per\b/i,
];

// Coverage one purchased unit covers. Explicit "per pack/unit/m²" forms win
// over a bare "area" column, which on real sheets is frequently blank.
const COVERAGE_PATTERNS = [
  /coverage/i,
  /m²?\s?per\s?(pack|unit|sheet|box|roll|carton)/i,
  /(pack|unit|sheet|box|roll)\s?(size|coverage)/i,
  /per\s?m²?\b/i,
  /\barea\b/i,
];

const COVERAGE_UNIT_PATTERNS = [/coverage\s?unit/i, /coverage\s?type/i];

const KEYWORDS_PATTERNS = [/keywords?/i, /tags?/i, /\btype\b/i, /\bcategory\b/i];

const DIMENSION_PATTERNS = [
  /\blength\b/i,
  /\bwidth\b/i,
  /\bthickness\b/i,
  /\b(depth|height)\b/i,
  /\bdimensions?\b/i,
];

const ITEM_NUMBER_PATTERNS = [
  /\b(supplier|product|item|part)\s?(code|no\.?|number|#)\b/i,
  /\bsku\b/i,
  /\bcode\b/i,
];

// Generic descriptive attributes worth keeping as free-text notes. These apply
// across trades (warranty, country of origin, ratings/grades), not just flooring.
const NOTES_PATTERNS = [
  /warrant/i,
  /\bcountry\b/i,
  /\borigin\b/i,
  /\brating\b/i,
  /\bgrade\b/i,
  /\bslip\b/i,
  /\bclass\b/i,
];

type Rows = Record<string, string>[] | undefined;

/** True when the column has at least one non-empty value (or we have no rows). */
function hasValues(header: string, rows: Rows): boolean {
  if (!rows || rows.length === 0) return true;
  return rows.some(r => (r[header] ?? '').toString().trim() !== '');
}

/**
 * Find the header best matching `patterns`, preferring columns that actually
 * carry values. First pass requires non-empty values so we skip blank columns
 * (the classic "Raw area" trap); second pass relaxes that so we still return
 * something header-only when every candidate column is empty.
 */
function matchFirst(headers: string[], patterns: RegExp[], rows: Rows): string | undefined {
  for (const p of patterns) {
    const hit = headers.find(h => p.test(norm(h)) && hasValues(h, rows));
    if (hit) return hit;
  }
  for (const p of patterns) {
    const hit = headers.find(h => p.test(norm(h)));
    if (hit) return hit;
  }
  return undefined;
}

function isTypeColumn(header: string): boolean {
  return /\btype\b|\bcategor/i.test(norm(header));
}

function detectName(headers: string[], rows: Rows): string | string[] | undefined {
  // 1. An explicit name/description column.
  const primary = matchFirst(headers, NAME_PRIMARY_PATTERNS, rows);
  if (primary) return primary;
  // 2. Compose identity from components (e.g. Style/Range + Colour).
  const components = headers.filter(
    h => NAME_COMPONENT_PATTERNS.some(p => p.test(norm(h))) && hasValues(h, rows),
  );
  if (components.length >= 2) return components;
  if (components.length === 1) return components[0];
  // 3. A loose name column that isn't merely a type/category.
  const loose = headers.find(
    h => NAME_LOOSE_PATTERNS.some(p => p.test(norm(h))) && !isTypeColumn(h) && hasValues(h, rows),
  );
  if (loose) return loose;
  // 4. Last resort — anything name-ish, even a type column.
  return headers.find(h => NAME_LOOSE_PATTERNS.some(p => p.test(norm(h))));
}

export function autoDetectMapping(headers: string[], rows?: Rows): ColumnMapping | null {
  const name = detectName(headers, rows);
  const price = matchFirst(headers, PRICE_PATTERNS, rows);
  if (!name || !price) return null;

  const dims = headers.filter(
    h => DIMENSION_PATTERNS.some(p => p.test(norm(h))) && hasValues(h, rows),
  );
  const notes = headers.filter(
    h => NOTES_PATTERNS.some(p => p.test(norm(h))) && hasValues(h, rows),
  );

  return {
    name,
    price,
    unit: matchFirst(headers, UNIT_PATTERNS, rows),
    qty: matchFirst(headers, QTY_PATTERNS, rows),
    coveragePerUnit: matchFirst(headers, COVERAGE_PATTERNS, rows),
    coverageUnit: matchFirst(headers, COVERAGE_UNIT_PATTERNS, rows),
    keywords: matchFirst(headers, KEYWORDS_PATTERNS, rows),
    dimensions: dims.length ? (dims.length === 1 ? dims[0] : dims) : undefined,
    itemNumber: matchFirst(headers, ITEM_NUMBER_PATTERNS, rows),
    notes: notes.length ? notes : undefined,
  };
}

/**
 * Judge how trustworthy an auto-detected mapping is, so the import flow can
 * decide whether to import silently or open the column mapper for confirmation.
 * Low confidence (no real unit signal, empty name) → always confirm with the
 * user instead of silently importing a wrong mapping.
 */
export function assessMapping(mapping: ColumnMapping, rows?: Rows): {
  confidence: MappingConfidence;
  warnings: string[];
} {
  const warnings: string[] = [];
  let confidence: MappingConfidence = 'high';
  const demote = (to: MappingConfidence) => {
    const rank = { high: 3, medium: 2, low: 1 } as const;
    if (rank[to] < rank[confidence]) confidence = to;
  };

  if (Array.isArray(mapping.name)) {
    warnings.push('Product name was combined from multiple columns.');
    demote('medium');
  }

  if (!mapping.unit) {
    const priceHasUnit =
      !!rows &&
      rows.some(r => /(?:\/|\bper\b)\s*[a-z²³]/i.test((r[mapping.price] ?? '').toString()));
    if (priceHasUnit) {
      warnings.push('Unit was read from the price (e.g. "/m²").');
      demote('medium');
    } else {
      warnings.push('No unit column found — items default to "each".');
      demote('low');
    }
  }

  const nameHeaders = Array.isArray(mapping.name) ? mapping.name : [mapping.name];
  const nameEmpty =
    !!rows && rows.length > 0 && !rows.some(r => nameHeaders.some(h => (r[h] ?? '').trim()));
  if (nameEmpty) {
    warnings.push('The chosen name column looks empty.');
    demote('low');
  }

  return { confidence, warnings };
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

// Real price lists often fold the unit into the price cell — "$28.50/m²",
// "$448.13/m", "12.30 per lm". Pull that suffix out so we can recover the unit
// when the sheet has no dedicated unit column.
function parsePriceWithUnit(raw: string | undefined): { price: number; unitFromPrice?: string } {
  if (!raw) return { price: 0 };
  const s = raw.toString();
  const price = parsePrice(s);
  // Trailing (?![a-z]) rather than \b: superscript ² / ³ are non-word chars, so
  // a \b after "m²" fails and the engine backtracks to a bare "m". The lookahead
  // lets "m²"/"m³" match in full while still rejecting "m" inside "metre".
  const m = s.match(
    /(?:\/|\bper\b)\s*(m²|m2|m³|m3|lin\.?\s?m|lm|sq\.?\s?m|sqm|metre|meter|m|each|ea|pack|box|roll|carton|kg|l|litre)(?![a-z])/i,
  );
  return { price, unitFromPrice: m ? normaliseUnit(m[1]) : undefined };
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

/** Join one or more columns' values for a row, dropping blanks. */
function composeFromColumns(
  row: Record<string, string>,
  cols: string | string[] | undefined,
  sep: string,
): string {
  if (!cols) return '';
  const list = Array.isArray(cols) ? cols : [cols];
  return list
    .map(c => (row[c] ?? '').toString().trim())
    .filter(Boolean)
    .join(sep);
}

function parseCoverageNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  // Strip any unit text ("2.8 m²", "5/box") down to the leading number.
  const n = parseFloat(raw.toString().replace(/[^0-9.]/g, ' ').trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function buildExtractFromMapping(
  parsed: ParsedSpreadsheet,
  mapping: ColumnMapping,
  opts: BuildOptions = {},
): ExtractResult {
  const items: ExtractedItem[] = [];
  const coverageHeader = !Array.isArray(mapping.coveragePerUnit)
    ? norm(mapping.coveragePerUnit || '')
    : '';

  for (const row of parsed.rows) {
    const name = composeFromColumns(row, mapping.name, ' — ');
    const { price, unitFromPrice } = parsePriceWithUnit(row[mapping.price]);
    if (!name || price <= 0) continue;

    // Unit precedence: a real unit column → the unit folded into the price
    // ("/m²") → "each". A unit column that only yields the default doesn't beat
    // a concrete price suffix.
    let unit = 'each';
    if (mapping.unit) {
      const u = normaliseUnit(row[mapping.unit]);
      if (u && u !== 'each') unit = u;
      else if (unitFromPrice) unit = unitFromPrice;
    } else if (unitFromPrice) {
      unit = unitFromPrice;
    }

    const coveragePerUnit =
      mapping.coveragePerUnit && typeof mapping.coveragePerUnit === 'string'
        ? parseCoverageNumber(row[mapping.coveragePerUnit])
        : undefined;

    let coverageUnit = mapping.coverageUnit
      ? parseCoverageUnit(row[mapping.coverageUnit])
      : undefined;
    if (!coverageUnit && coveragePerUnit !== undefined) {
      // Infer from the coverage header ("m² per pack"), else the line's unit.
      if (/m³|m3/.test(coverageHeader)) coverageUnit = 'm³';
      else if (/m²|m2/.test(coverageHeader)) coverageUnit = 'm²';
      else if (/\bm\b|lin|lm|metre|meter/i.test(coverageHeader)) coverageUnit = 'm';
      else if (unit === 'm²' || unit === 'm³' || unit === 'm') coverageUnit = unit;
    }

    const dimensions = composeFromColumns(row, mapping.dimensions, ' × ') || undefined;
    const itemNumber = mapping.itemNumber
      ? (row[mapping.itemNumber] || '').toString().trim() || undefined
      : undefined;
    const notes = mapping.notes
      ? (Array.isArray(mapping.notes) ? mapping.notes : [mapping.notes])
          .map(c => {
            const v = (row[c] ?? '').toString().trim();
            return v ? `${norm(c)}: ${v}` : '';
          })
          .filter(Boolean)
          .join('; ') || undefined
      : undefined;

    items.push({
      name,
      price,
      unit,
      qty: mapping.qty ? parseQty(row[mapping.qty]) : undefined,
      coveragePerUnit,
      coverageUnit,
      keywords: mapping.keywords ? parseKeywords(row[mapping.keywords]) : [],
      dimensions,
      itemNumber,
      notes,
      confidence: 'high',
    });
  }
  return {
    supplierName: opts.supplierName || '',
    supplierContact: undefined,
    items,
  };
}
