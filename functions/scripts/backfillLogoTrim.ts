/**
 * Backfill: trim whitespace margins off logos uploaded before auto-trim shipped.
 *
 * Auto-trim landed on 2026-08-02 (d6c6fa1) in the app's upload path, so every
 * logo uploaded before then — and any placed on an account directly, bypassing
 * the app — still carries its export canvas. The PDF header box sizes that
 * canvas rather than the artwork, so a wide wordmark on a 3:2 canvas prints at
 * a fraction of its intended size with a mystery gap underneath.
 *
 * Detection reuses computeContentBBox from the app (src/utils/logoTrimCore.ts)
 * so this produces byte-identical crops to what a fresh upload would, rather
 * than a second implementation that can drift.
 *
 *   npx ts-node scripts/backfillLogoTrim.ts            # dry run + contact sheet
 *   npx ts-node scripts/backfillLogoTrim.ts --apply    # writes to Storage
 *
 * Run from functions/. Needs Application Default Credentials.
 * Originals are copied to <path>.pre-trim-backup before anything is overwritten.
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { computeContentBBox } from '../../src/utils/logoTrimCore';

// Decoders live in the app's node_modules; functions doesn't depend on them and
// shouldn't grow a dependency for a one-off migration.
const { PNG } = require('../../node_modules/pngjs');
const jpeg = require('../../node_modules/jpeg-js');

/** Matches PAD_FRACTION in src/utils/logoTrim.ts. */
const PAD_FRACTION = 0.05;
/** Only rewrite when the artwork is under this share of the canvas height. */
const FILL_THRESHOLD = 0.7;
const OUT_DIR = '/tmp/logo-backfill';

const APPLY = process.argv.includes('--apply');

interface Decoded {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
  kind: 'png' | 'jpeg';
}

function decode(buf: Buffer): Decoded {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data, kind: 'png' };
  }
  const raw = jpeg.decode(buf, { formatAsRGBA: true, maxMemoryUsageInMB: 64 });
  return { width: raw.width, height: raw.height, data: raw.data, kind: 'jpeg' };
}

function crop(img: Decoded, x: number, y: number, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * img.width + x) * 4;
    Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length).copy(
      out, row * w * 4, src, src + w * 4,
    );
  }
  if (img.kind === 'png') {
    const png = new PNG({ width: w, height: h });
    out.copy(png.data);
    return PNG.sync.write(png);
  }
  return Buffer.from(jpeg.encode({ data: out, width: w, height: h }, 92).data);
}

/** users/<uid>/logo.png  ->  storage object path, from a download URL. */
function objectPathFromUrl(url: string): string {
  // A few legacy accounts hold the logo as an inline base64 data URI in
  // Firestore rather than a Storage object. Bail before the /o/ match, which
  // would otherwise happily find that substring inside the base64 payload and
  // hand back a garbage path.
  if (url.startsWith('data:')) throw new Error('inline data URI, not a Storage object');
  if (!url.startsWith('https://firebasestorage.googleapis.com/')) {
    throw new Error('not a Firebase Storage URL');
  }
  const m = url.match(/\/o\/([^?]+)/);
  if (!m) throw new Error('unrecognised storage URL');
  return decodeURIComponent(m[1]);
}

async function main() {
  if (!admin.apps.length) admin.initializeApp({ projectId: 'hansendev' });
  const db = admin.firestore();
  const bucket = admin.storage().bucket('hansendev.firebasestorage.app');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const users = await db.collection('users').select().get();
  const ids = users.docs.map((d) => d.id);

  type Target = { uid: string; field: 'logo' | 'credential'; credId?: string; url: string };
  const targets: Target[] = [];

  const CHUNK = 40;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const snaps = await Promise.all(
      ids.slice(i, i + CHUNK).map((id) =>
        db.collection('users').doc(id).collection('settings').doc('business').get(),
      ),
    );
    for (const s of snaps) {
      if (!s.exists) continue;
      const b: any = s.data() || {};
      const uid = s.ref.parent.parent!.id;
      if (b.logoUri) targets.push({ uid, field: 'logo', url: b.logoUri });
      for (const c of Array.isArray(b.credentials) ? b.credentials : []) {
        if (c?.logoUri) targets.push({ uid, field: 'credential', credId: c.id, url: c.logoUri });
      }
    }
  }

  console.log(`${targets.length} images referenced by ${ids.length} users\n`);

  let trimmed = 0;
  let skipped = 0;
  const report: string[] = [];

  for (const t of targets) {
    let objPath: string;
    try {
      objPath = objectPathFromUrl(t.url);
    } catch (e: any) {
      report.push(`SKIP  ${t.uid.slice(0, 12)} ${t.field.padEnd(10)} ${e.message}`);
      skipped++;
      continue;
    }

    let buf: Buffer;
    try {
      [buf] = await bucket.file(objPath).download();
    } catch (e: any) {
      report.push(`ERR   ${t.uid.slice(0, 12)} ${t.field}  download: ${e.code || e.message}`);
      skipped++;
      continue;
    }

    let img: Decoded;
    try {
      img = decode(buf);
    } catch (e: any) {
      report.push(`ERR   ${t.uid.slice(0, 12)} ${t.field}  decode: ${e.message}`);
      skipped++;
      continue;
    }

    const bbox = computeContentBBox(img.width, img.height, img.data as any);
    if (!bbox) {
      skipped++;
      continue;
    }

    const fill = bbox.height / img.height;
    if (fill > FILL_THRESHOLD) {
      skipped++;
      continue;
    }

    const pad = Math.round(Math.max(bbox.width, bbox.height) * PAD_FRACTION);
    const x = Math.max(0, bbox.x - pad);
    const y = Math.max(0, bbox.y - pad);
    const w = Math.min(img.width - x, bbox.width + pad * 2);
    const h = Math.min(img.height - y, bbox.height + pad * 2);
    if (w <= 0 || h <= 0) {
      skipped++;
      continue;
    }

    const cropped = crop(img, x, y, w, h);
    const base = `${t.uid.slice(0, 12)}_${t.field}${t.credId ? '_' + t.credId.slice(0, 8) : ''}`;
    fs.writeFileSync(path.join(OUT_DIR, `${base}.before.${img.kind === 'png' ? 'png' : 'jpg'}`), buf);
    fs.writeFileSync(path.join(OUT_DIR, `${base}.after.${img.kind === 'png' ? 'png' : 'jpg'}`), cropped);

    report.push(
      `TRIM  ${t.uid.slice(0, 12)} ${t.field.padEnd(10)} ` +
        `${img.width}x${img.height} -> ${w}x${h}   ` +
        `artwork was ${(fill * 100).toFixed(0)}% of height   ${objPath}`,
    );
    trimmed++;

    if (APPLY) {
      const file = bucket.file(objPath);
      const [meta] = await file.getMetadata();
      await file.copy(bucket.file(`${objPath}.pre-trim-backup`));
      await file.save(cropped, {
        contentType: meta.contentType || (img.kind === 'png' ? 'image/png' : 'image/jpeg'),
        metadata: { firebaseStorageDownloadTokens: (meta.metadata as any)?.firebaseStorageDownloadTokens },
        resumable: false,
      });
    }
  }

  console.log(report.join('\n'));
  console.log(
    `\n${APPLY ? 'APPLIED' : 'DRY RUN'} — ${trimmed} to trim, ${skipped} left alone.\n` +
      `before/after pairs written to ${OUT_DIR}` +
      (APPLY ? '\nOriginals kept at <path>.pre-trim-backup' : '\nRe-run with --apply to write.'),
  );
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
