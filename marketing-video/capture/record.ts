/**
 * [2] App-capture recorder.
 *
 * Serves the gated demo web build, injects out/<slug>.demo.json as
 * window.__QM_DEMO__ before the app boots, lets the harness replay the chat,
 * and records the Mate screen at phone aspect to out/<slug>.app.webm (+ .mp4
 * if ffmpeg is present) plus a poster frame.
 *
 *   tsx capture/record.ts <slug>
 *
 * Prereqs:
 *   - A demo web build:  (from repo root) — isolated dir so it never shadows
 *     the normal dist-web, and it's auth-bypassed so it must NEVER be deployed:
 *       EXPO_PUBLIC_DEMO_CAPTURE=1 npx expo export -p web --output-dir dist-web-demo
 *   - playwright + chromium installed (npm install && npx playwright install chromium)
 *
 * Env:
 *   CAPTURE_DIR  static dir to serve (default ../../dist-web-demo)
 *   CAPTURE_PORT default 8090
 *   PHONE_W / PHONE_H  viewport (default 414 x 896), DSF default 2
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, 'out');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

/** Tiny static server with SPA fallback to index.html. */
function serve(dir: string, port: number): Promise<() => void> {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = join(dir, url);
    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
    if (!existsSync(filePath)) filePath = join(dir, 'index.html'); // SPA fallback
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((ok) => server.listen(port, () => ok(() => server.close())));
}

function ffmpeg(args: string[]): Promise<boolean> {
  return new Promise((ok) => {
    const p = spawn('ffmpeg', args, { stdio: 'ignore' });
    p.on('error', () => ok(false));
    p.on('close', (code) => ok(code === 0));
  });
}

async function main() {
  const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!slug) throw new Error('usage: record.ts <slug>');

  const dir = resolve(process.env.CAPTURE_DIR ?? join(ROOT, '..', 'dist-web-demo'));
  const port = Number(process.env.CAPTURE_PORT ?? 8090);
  const W = Number(process.env.PHONE_W ?? 414);
  const H = Number(process.env.PHONE_H ?? 896);

  if (!existsSync(join(dir, 'index.html'))) {
    throw new Error(
      `No web build at ${dir}/index.html.\n` +
        `Build it first:  EXPO_PUBLIC_DEMO_CAPTURE=1 npx expo export -p web --output-dir dist-web-demo`,
    );
  }
  const payload = JSON.parse(readFileSync(join(OUT, `${slug}.demo.json`), 'utf8'));

  const stop = await serve(dir, port);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: Number(process.env.PHONE_DSF ?? 2),
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  });
  // Inject the payload BEFORE any app code runs.
  await context.addInitScript((p: unknown) => {
    (window as any).__QM_DEMO__ = p;
  }, payload);

  const page = await context.newPage();
  console.log(`[${slug}] loading http://localhost:${port}/ (serving ${dir})`);
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 60_000 });

  // Wait for the harness to start, then keep the latest message in view until done.
  await page.waitForFunction(() => (window as any).__QM_DEMO_READY__ === true, { timeout: 30_000 });
  console.log(`[${slug}] harness started — recording replay…`);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await page.evaluate(() => {
      // Best-effort: push every scrollable container (and the window) to the bottom.
      const els = Array.from(document.querySelectorAll<HTMLElement>('*'));
      for (const el of els) {
        if (el.scrollHeight > el.clientHeight + 40) el.scrollTop = el.scrollHeight;
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
    const done = await page.evaluate(() => (window as any).__QM_DEMO_DONE__ === true);
    if (done) break;
    await page.waitForTimeout(250);
  }
  // Let the quote card settle, grab a poster, then close so Playwright flushes the video.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `${slug}-poster.png`) });

  const videoObj = page.video();
  await context.close();
  await browser.close();
  stop();

  if (videoObj) {
    const webm = await videoObj.path();
    const mp4 = join(OUT, `${slug}.app.mp4`);
    const ok = await ffmpeg(['-y', '-i', webm, '-movflags', '+faststart', '-pix_fmt', 'yuv420p', mp4]);
    console.log(`[${slug}] → ${webm}`);
    console.log(`[${slug}] → ${ok ? mp4 : '(ffmpeg not found — webm only)'}`);
    console.log(`[${slug}] → ${join(OUT, `${slug}-poster.png`)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
