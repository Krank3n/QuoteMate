/**
 * generatePresenterClip — Veo 3 video generation, routed through Firebase
 * Functions so the GEMINI_API_KEY (and its Veo entitlement) stays server-side,
 * consistent with the rest of the app's model access.
 *
 * Used only by the marketing-video pipeline to render the "common human"
 * presenter clips (intro / answer / reaction). Not part of any user flow.
 *
 *   POST /generatePresenterClip   (Bearer <marketing-bot idToken>)
 *   { prompt, negativePrompt?, aspectRatio?, model?, seed? }
 *   -> { mimeType, dataBase64, model }            // the generated clip bytes
 *
 * Veo runs as a long-running operation (≈1–3 min), so the function polls within
 * its extended timeout and returns the clip inline (clips are a few MB).
 */
import * as functions from 'firebase-functions';
import fetch from 'node-fetch';
import cors from 'cors';
import { verifyAuth, checkRateLimit, RateLimitConfig } from './assistantToken';

const corsHandler = cors({ origin: true });

const DEFAULT_MODEL = 'veo-3.0-generate-001';
const GEN_RATE: RateLimitConfig = { maxRequests: 20, windowMs: 60_000 };
const POLL_INTERVAL_MS = 8_000;
const MAX_POLLS = 50; // ~7 min ceiling, under the 540s function timeout w/ margin

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const API = 'https://generativelanguage.googleapis.com/v1beta';

export const generatePresenterClip = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }
      const decoded = await verifyAuth(req, res);
      if (!decoded) return;
      const ok = await checkRateLimit(`veo:${decoded.uid}`, GEN_RATE, res);
      if (!ok) return;

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: 'No GEMINI_API_KEY configured.' });
        return;
      }

      const { prompt, negativePrompt, aspectRatio, model, seed } = req.body || {};
      if (typeof prompt !== 'string' || !prompt.trim()) {
        res.status(400).json({ error: 'prompt required.' });
        return;
      }
      const veoModel = typeof model === 'string' && model ? model : DEFAULT_MODEL;

      const parameters: Record<string, unknown> = {
        aspectRatio: aspectRatio || '9:16',
        personGeneration: 'allow_adult',
      };
      if (negativePrompt) parameters.negativePrompt = negativePrompt;
      if (typeof seed === 'number') parameters.seed = seed;

      try {
        // 1) Kick off the long-running generation.
        const startRes = await fetch(`${API}/models/${veoModel}:predictLongRunning?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instances: [{ prompt }], parameters }),
        });
        if (!startRes.ok) {
          res.status(502).json({ error: `Veo start failed: ${startRes.status} ${await startRes.text()}` });
          return;
        }
        const op = (await startRes.json()) as { name?: string };
        if (!op.name) {
          res.status(502).json({ error: 'Veo did not return an operation name.' });
          return;
        }

        // 2) Poll until the operation completes.
        let done: any = null;
        for (let i = 0; i < MAX_POLLS; i++) {
          await sleep(POLL_INTERVAL_MS);
          const pollRes = await fetch(`${API}/${op.name}?key=${apiKey}`);
          if (!pollRes.ok) continue;
          const status = (await pollRes.json()) as any;
          if (status.done) {
            if (status.error) {
              res.status(502).json({ error: `Veo failed: ${JSON.stringify(status.error)}` });
              return;
            }
            done = status;
            break;
          }
        }
        if (!done) {
          res.status(504).json({ error: 'Veo timed out before the clip was ready.' });
          return;
        }

        // 3) Pull the generated sample's file URI and fetch the bytes.
        const sample =
          done.response?.generateVideoResponse?.generatedSamples?.[0] ??
          done.response?.generatedSamples?.[0];
        const uri: string | undefined = sample?.video?.uri ?? sample?.video?.fileUri;
        if (!uri) {
          res.status(502).json({ error: 'Veo response had no video URI.', raw: done.response });
          return;
        }
        const fileRes = await fetch(uri.includes('key=') ? uri : `${uri}${uri.includes('?') ? '&' : '?'}key=${apiKey}`);
        if (!fileRes.ok) {
          res.status(502).json({ error: `Clip download failed: ${fileRes.status}` });
          return;
        }
        const buf = Buffer.from(await fileRes.arrayBuffer());
        res.json({
          mimeType: fileRes.headers.get('content-type') || 'video/mp4',
          dataBase64: buf.toString('base64'),
          model: veoModel,
        });
      } catch (e: any) {
        res.status(500).json({ error: `generatePresenterClip error: ${e?.message ?? e}` });
      }
    });
  });
