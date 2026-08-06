/**
 * Import a supplier trade pricebook (CSV) into a user's material favourites.
 *
 * Tradies email their supplier's price list and expect it to show up as their
 * own rates. The in-app importer handles photos, PDFs and spreadsheets, but a
 * CSV that arrives by email has no path in — hence this.
 *
 * Writes exactly what the app writes, so imported rows are indistinguishable
 * from ones added in-app:
 *   users/<uid>/materialFavorites/<key>   FavoriteProductMapping + savedAt
 *   users/<uid>/supplierGroups/<id>       SupplierGroup
 * where key = name.toLowerCase().trim() with whitespace -> _ and / -> -,
 * matching getMaterialKey in src/services/materialFavorites.ts. Diverging
 * there would create rows the app can never match, update or delete.
 *
 * isPersonalRate marks these as the tradie's own trade rates so the quote
 * generator prefers them over scraped retail pricing — the entire point of
 * loading a pricebook.
 *
 *   npx ts-node scripts/importSupplierPricebook.ts <uid> <file.csv> "<Supplier name>"
 *   npx ts-node scripts/importSupplierPricebook.ts <uid> <file.csv> "<Supplier name>" --apply
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';

const APPLY = process.argv.includes('--apply');
const [uid, csvPath, supplierName] = process.argv.slice(2);

/** Excel writes ="0012" to stop leading zeros being eaten. Unwrap it. */
function unwrap(cell: string): string {
  const m = cell.match(/^="?(.*?)"?$/);
  return (m ? m[1] : cell).trim();
}

/** Minimal RFC4180 split — handles quoted commas and "" escapes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Matches getMaterialKey in src/services/materialFavorites.ts. */
function materialKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '_').replace(/\//g, '-');
}

interface Row {
  code: string;
  name: string;
  price: number;
  category?: string;
}

function parse(csv: string): { rows: Row[]; skipped: string[] } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  // The header row is wherever the price column is declared — these exports
  // carry a few account/date lines above it.
  const headerIdx = lines.findIndex((l) => /net price|price/i.test(l) && /description/i.test(l));
  if (headerIdx < 0) throw new Error('could not find a header row with description + price');

  const header = splitCsvLine(lines[headerIdx]).map((h) => unwrap(h).toLowerCase());
  // Try the candidate names in order of preference, each across every header.
  // Iterating headers first instead would let "product code" win the name
  // column on the alias "product", importing SKUs as product names.
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iCode = col('product code', 'code', 'item');
  const iName = col('description', 'product', 'name');
  const iPrice = col('net price', 'price');
  const iCat = col('category', 'group');
  if (iName < 0 || iPrice < 0) throw new Error('missing description or price column');

  const rows: Row[] = [];
  const skipped: string[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const cells = splitCsvLine(line).map(unwrap);
    const name = cells[iName] || '';
    const price = parseFloat((cells[iPrice] || '').replace(/[^0-9.]/g, ''));
    if (!name || !isFinite(price) || price <= 0) {
      if (name || cells.some(Boolean)) skipped.push(line.slice(0, 80));
      continue;
    }
    rows.push({
      code: iCode >= 0 ? cells[iCode] : '',
      name,
      price,
      category: iCat >= 0 ? cells[iCat] : undefined,
    });
  }
  return { rows, skipped };
}

async function main() {
  if (!uid || !csvPath || !supplierName) {
    console.error('usage: importSupplierPricebook.ts <uid> <file.csv> "<Supplier name>" [--apply]');
    process.exit(1);
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: 'hansendev' });
  const db = admin.firestore();

  const { rows, skipped } = parse(fs.readFileSync(csvPath, 'utf8'));

  // Collapse duplicate names — the doc key is derived from the name, so two
  // rows sharing one would silently overwrite each other. Keep the cheaper.
  const byKey = new Map<string, Row>();
  let duplicates = 0;
  for (const r of rows) {
    const k = materialKey(r.name);
    const prev = byKey.get(k);
    if (prev) {
      duplicates++;
      if (r.price >= prev.price) continue;
    }
    byKey.set(k, r);
  }

  const prices = rows.map((r) => r.price).sort((a, b) => a - b);
  console.log(`parsed        : ${rows.length} priced rows`);
  console.log(`unique keys   : ${byKey.size}${duplicates ? `  (${duplicates} duplicate names collapsed)` : ''}`);
  console.log(`skipped       : ${skipped.length}`);
  console.log(`price range   : $${prices[0]?.toFixed(2)} – $${prices[prices.length - 1]?.toFixed(2)}`);
  console.log(`median        : $${prices[Math.floor(prices.length / 2)]?.toFixed(2)}`);
  const cats = new Set(rows.map((r) => r.category).filter(Boolean));
  console.log(`categories    : ${cats.size}`);
  console.log(`\nsample:`);
  for (const r of rows.slice(0, 5)) {
    console.log(`  ${r.code.padEnd(10)} ${r.name.slice(0, 44).padEnd(46)} $${r.price.toFixed(2)}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply.`);
    return;
  }

  const now = new Date().toISOString();
  const batchId = `pricebook-${Date.now()}`;
  const groupId = `supplier-${materialKey(supplierName)}`;

  await db.collection('users').doc(uid).collection('supplierGroups').doc(groupId).set(
    {
      id: groupId,
      name: supplierName,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
      notes: `Trade pricebook imported ${now.slice(0, 10)} — ${byKey.size} items.`,
    },
    { merge: true },
  );

  let written = 0;
  const entries = [...byKey.entries()];
  const CHUNK = 400; // Firestore caps a batch at 500 writes.
  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = db.batch();
    for (const [key, r] of entries.slice(i, i + CHUNK)) {
      batch.set(
        db.collection('users').doc(uid).collection('materialFavorites').doc(key),
        {
          productName: r.name,
          store: supplierName,
          itemNumber: r.code || undefined,
          unit: 'each',
          price: r.price,
          isPersonalRate: true,
          source: 'imported',
          sourceRef: batchId,
          keywords: r.category ? [r.category.toLowerCase()] : undefined,
          lastUpdatedAt: now,
          savedAt: now,
        },
        { merge: true },
      );
      written++;
    }
    await batch.commit();
    process.stderr.write(`\rwritten ${written}/${entries.length}`);
  }

  console.log(`\n\nAPPLIED — ${written} items under supplier "${supplierName}" (${groupId}).`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
