// Service Report write-up compose — authenticated proxy to the Gemini text
// model, mirroring assistantChat.ts (cors + verifyAuth + GEMINI_API_KEY guard
// + generateContent fetch). The client posts the tradie's rough notes; we
// build a strictly-factual rewrite prompt (facts may be redistributed between
// the three fields but never invented), forward it with the master key kept
// off the device, and return the three cleaned write-up fields plus two
// suggestion lists (suggestedEquipment / suggestedChecklist) extracted from
// the notes for the tradie to review — nothing is added automatically.
//
// Kept as its own onRequest (not folded into assistantChat) because it is a
// one-shot rewrite with no tool loop and no per-turn quota: a service report
// is a separate document type from a Mate chat turn.
//
// NOT registered in index.ts here — the Wiring phase exports it.

import * as functions from 'firebase-functions/v1';
import fetch from 'node-fetch';
import cors from 'cors';
import { verifyAuth, checkRateLimit, RateLimitConfig } from './assistantToken';
import {
  buildComposePrompt,
  sanitizeComposed,
  ComposeNotes,
  ComposeContext,
} from './composeServiceReport.helpers';

const corsHandler = cors({ origin: true });

// Same text-capable flash model the Mate text chat uses.
const CHAT_MODEL = 'gemini-3.7-flash';

// One-shot rewrite — a modest ceiling is plenty and bounds abuse.
const COMPOSE_RATE: RateLimitConfig = { maxRequests: 20, windowMs: 60_000 };

function hasAnyNote(notes: ComposeNotes | undefined | null): notes is ComposeNotes {
  if (!notes || typeof notes !== 'object') return false;
  return (
    !!(notes.natureOfProblem && String(notes.natureOfProblem).trim()) ||
    !!(notes.workCarriedOut && String(notes.workCarriedOut).trim()) ||
    !!(notes.recommendedWork && String(notes.recommendedWork).trim())
  );
}

export const composeServiceReport = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

      const decoded = await verifyAuth(req, res);
      if (!decoded) return;
      const ok = await checkRateLimit(`report-compose:${decoded.uid}`, COMPOSE_RATE, res);
      if (!ok) return;

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) { res.status(500).json({ error: 'Mate is offline (no API key).' }); return; }

      const notes = (req.body?.notes || {}) as ComposeNotes;
      const context = (req.body?.context || undefined) as ComposeContext | undefined;
      if (!hasAnyNote(notes)) {
        res.status(400).json({ error: 'notes required.' });
        return;
      }

      const prompt = buildComposePrompt(notes, context);
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${apiKey}`;
      let geminiRes: Awaited<ReturnType<typeof fetch>>;
      try {
        geminiRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (err: any) {
        res.status(502).json({ error: 'Mate is offline — try again in a moment.', detail: err?.message });
        return;
      }

      const text = await geminiRes.text();
      if (!geminiRes.ok) {
        // eslint-disable-next-line no-console
        console.warn('[composeServiceReport] gemini error', geminiRes.status, text.slice(0, 300));
        res.status(502).json({ error: 'Mate hit a snag — try again in a moment.' });
        return;
      }

      let parsed: any;
      try { parsed = JSON.parse(text); } catch {
        res.status(502).json({ error: 'Mate returned an unreadable reply.' });
        return;
      }

      const parts = parsed?.candidates?.[0]?.content?.parts || [];
      const rawText = parts
        .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
        .join('')
        .trim();

      const composed = sanitizeComposed(rawText, notes);
      res.status(200).json(composed);
    });
  });
