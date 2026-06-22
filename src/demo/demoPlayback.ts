/**
 * Marketing demo playback harness.
 *
 * Replays a scripted conversation + a real priced quote through the REAL
 * AssistantScreen (same MessageBubble / ProposalCard / inline JobScopeCard the
 * app uses) so the capture tool records the genuine UI — nothing is recreated.
 *
 * DOUBLE-GATED so it can never reach real users:
 *   1. build-time:  EXPO_PUBLIC_DEMO_CAPTURE must be '1' (capture builds only).
 *   2. runtime:     window.__QM_DEMO__ must be present (injected by the capture
 *                   script). On native, and in any normal build, this hook is a
 *                   no-op and seeds nothing.
 *
 * The payload is authored offline by marketing-video/driver/generateQuote.ts.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useStore } from '../store/useStore';
import { quoteToDocument } from '../types/documentAdapter';
import { previewDocumentPDF } from '../utils/pdfGenerator';
import type { ChatMessage, WorkingStatus } from '../types/assistant';
import type { BusinessSettings, Quote } from '../types';
import type { DemoEvent, DemoPayload, DemoWorkingPhase } from './demoTypes';

/**
 * The authoritative gate for ALL capture-only behaviour (this harness AND the
 * auth/onboarding bypass in App.tsx / RootNavigator). Requires BOTH:
 *   - a capture-capable build (EXPO_PUBLIC_DEMO_CAPTURE=1), AND
 *   - an injected runtime payload (window.__QM_DEMO__).
 *
 * The runtime payload is the real safety boundary: only the capture tool's
 * addInitScript ever sets it, so even if the build flag leaked into a normal
 * bundle (e.g. a stale Metro cache), nothing activates for real users.
 */
export function isDemoCaptureActive(): boolean {
  return (
    process.env.EXPO_PUBLIC_DEMO_CAPTURE === '1' &&
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    !!(window as any).__QM_DEMO__
  );
}

let idSeq = 0;
const nextId = (): string => `demo-msg-${++idSeq}`;
const nowIso = (): string => new Date().toISOString();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function userMessage(text: string): ChatMessage {
  return { id: nextId(), role: 'user', text, createdAt: nowIso() };
}

function workingStatus(p: DemoWorkingPhase, done: boolean): WorkingStatus {
  return {
    phase: p.phase,
    status: p.status,
    detail: p.detail,
    done,
    summary: done ? 'Quote ready' : undefined,
  };
}

/** Revive JSON-serialized Date fields so JobScopeCard's date math works. */
function reviveQuote(q: Quote): Quote {
  return {
    ...q,
    createdAt: new Date(q.createdAt as unknown as string),
    updatedAt: new Date(q.updatedAt as unknown as string),
  };
}

async function typeOut(
  convoId: string,
  messageId: string,
  full: string,
  msPerChar: number,
  isCancelled: () => boolean,
): Promise<void> {
  const { updateMessage } = useStore.getState();
  // Step a few characters at a time to keep the look of streaming without a
  // store write per character.
  const step = 2;
  for (let i = 0; i <= full.length; i += step) {
    if (isCancelled()) return;
    updateMessage(convoId, messageId, { text: full.slice(0, i) });
    await sleep(msPerChar * step);
  }
  updateMessage(convoId, messageId, { text: full });
}

// --- PDF preview capture (web demo only) -----------------------------------
// The real "Preview PDF" button calls window.open() and writes the generated
// PDF HTML into a NEW browser window — which the Playwright recorder can't see.
// Redirect that popup into a full-viewport in-page iframe so the preview is
// captured inside the phone frame, scaled to fit the column.
// The PDF HTML is fluid (no fixed page width), so rendering it narrow makes it
// reflow into a tall, phone-readable column we can slowly scroll. Set per run
// from the previewPdf event; window.open reads it when it builds the iframe.
let pdfPageW = 0;

/**
 * Stack the PDF header (business name block above the quote-meta block) so the
 * bold template's large uppercase name can't overlap the right-aligned meta
 * (Quote #, Customer, Job Address) at the narrow phone-column render width.
 * Demo capture only — the real generated PDF is untouched.
 */
function patchPdfForNarrow(html: string): string {
  const css =
    '<style>' +
    '.header{flex-direction:column!important;align-items:stretch!important;gap:10px!important}' +
    '.header-meta{min-width:0!important;max-width:100%!important;text-align:left!important}' +
    '</style>';
  return html.includes('</head>') ? html.replace('</head>', `${css}</head>`) : `${css}${html}`;
}

function installPdfPopupCapture(): void {
  const w = globalThis as any;
  if (w.__QM_POPUP_PATCHED__ || typeof document === 'undefined') return;
  w.__QM_POPUP_PATCHED__ = true;
  w.open = (): any => {
    let iframe = document.getElementById('__qm_pdf_iframe__') as HTMLIFrameElement | null;
    if (!iframe) {
      const overlay = document.createElement('div');
      overlay.id = '__qm_pdf_overlay__';
      Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
        background: '#0F172A', zIndex: '2147483647', overflow: 'hidden',
      } as Partial<CSSStyleDeclaration>);
      const pageW = pdfPageW || window.innerWidth;
      const scale = window.innerWidth / pageW; // fill the phone width (zoom in if narrower)
      iframe = document.createElement('iframe');
      iframe.id = '__qm_pdf_iframe__';
      Object.assign(iframe.style, {
        border: '0', background: '#ffffff', display: 'block',
        width: `${pageW}px`,
        height: `${Math.ceil(window.innerHeight / scale)}px`,
        opacity: '0', // fade in once painted so there's no white load flash
        transition: 'opacity 280ms ease',
      } as Partial<CSSStyleDeclaration>);
      // `zoom` (not `transform: scale`) so the iframe's LAYOUT box shrinks to the
      // viewport too — otherwise the capture script's scroll-to-bottom loop would
      // treat the overlay as overflowing and scroll the page out of view.
      (iframe.style as any).zoom = String(scale);
      overlay.appendChild(iframe);
      document.body.appendChild(overlay);
    }
    const frame = iframe;
    return {
      document: {
        write: (html: string) => { frame.srcdoc = patchPdfForNarrow(html); },
        writeln: (html: string) => { frame.srcdoc = patchPdfForNarrow(html); },
        open: () => {},
        close: () => {},
      },
      focus: () => {},
      close: () => {},
      closed: false,
    };
  };
}

/** Brief opacity "tap" on an on-screen button so the press reads on camera. */
function flashButton(label: string): void {
  if (typeof document === 'undefined') return;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('*'));
  const leaf = nodes.find((n) => n.children.length === 0 && (n.textContent ?? '').trim() === label);
  const target = (leaf?.closest('[role="button"]') as HTMLElement) ?? leaf;
  if (!target) return;
  target.scrollIntoView?.({ block: 'center' });
  const prev = target.style.opacity;
  target.style.transition = 'opacity 120ms ease';
  target.style.opacity = '0.4';
  setTimeout(() => {
    target.style.opacity = prev || '1';
  }, 170);
}

function waitForIframeReady(iframe: HTMLIFrameElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const cdoc = iframe.contentDocument;
      const ready = !!cdoc && cdoc.readyState === 'complete' && (cdoc.body?.scrollHeight ?? 0) > 0;
      if (ready || Date.now() - start > timeoutMs) resolve();
      else setTimeout(tick, 100);
    };
    tick();
  });
}

async function animateScroll(win: Window, to: number, durMs: number, isCancelled: () => boolean): Promise<void> {
  if (!win || to <= 0 || durMs <= 0) return;
  const start = Date.now();
  const ease = (t: number): number => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t); // easeInOutQuad
  await new Promise<void>((resolve) => {
    const tick = () => {
      if (isCancelled()) return resolve();
      const t = Math.min(1, (Date.now() - start) / durMs);
      win.scrollTo(0, Math.round(ease(t) * to));
      if (t >= 1) resolve();
      else if (win.requestAnimationFrame) win.requestAnimationFrame(tick);
      else setTimeout(tick, 16);
    };
    tick();
  });
}

/** Tap "Preview PDF", then slowly scroll the rendered document top→bottom. */
async function runPreviewPdf(
  quoteId: string,
  pageW: number,
  totalMs: number,
  onVisible: () => void,
  isCancelled: () => boolean,
): Promise<void> {
  if (typeof document === 'undefined') return;
  pdfPageW = pageW || window.innerWidth; // window.open reads this when it builds the iframe
  flashButton('Preview PDF');
  await sleep(450);
  if (isCancelled()) return;

  // Same code path the button runs; installPdfPopupCapture redirects it in-frame.
  try {
    const st = useStore.getState();
    const quote = st.quotes.find((q) => q.id === quoteId);
    const doc = st.documents.find((d) => d.id === quoteId) ?? (quote ? quoteToDocument(quote) : null);
    if (doc) await previewDocumentPDF(doc, st.businessSettings, { isPro: true });
  } catch (e) {
    console.error('[demo] preview pdf failed', e);
    return;
  }

  const iframe = document.getElementById('__qm_pdf_iframe__') as HTMLIFrameElement | null;
  if (!iframe) return;
  await waitForIframeReady(iframe, 4000);
  if (isCancelled()) return;
  await sleep(250); // let images/layout settle
  iframe.style.opacity = '1'; // fade the painted page in (no white flash)
  await sleep(350);

  // The page is on screen now — start its voiceover and time the section to it.
  onVisible();
  const tStart = Date.now();

  const cdoc = iframe.contentDocument;
  const cwin = iframe.contentWindow;
  if (cdoc && cwin) {
    const scale = window.innerWidth / pdfPageW;
    const innerViewport = window.innerHeight / scale;
    const contentH = Math.max(cdoc.documentElement.scrollHeight, cdoc.body?.scrollHeight ?? 0);
    const maxScroll = Math.max(0, contentH - innerViewport);
    // Gentle on-screen pan (~70 px/s).
    const displayed = maxScroll * scale;
    const durMs = Math.min(6500, Math.max(3000, (displayed / 70) * 1000));
    await animateScroll(cwin, maxScroll, durMs, isCancelled);
  }
  // Keep the PDF up until the spoken line has finished.
  await sleep(Math.max(0, totalMs - (Date.now() - tStart)));
}

async function runDemo(payload: DemoPayload, isCancelled: () => boolean): Promise<void> {
  const opts = payload.options ?? {};
  const typingMsPerChar = opts.typingMsPerChar ?? 22;
  const between = opts.betweenMs ?? 600;

  // Seed the priced quote so the `reveal` event can render it inline.
  useStore.setState({ quotes: [reviveQuote(payload.quote)] });

  // Seed a demo business so the previewed PDF carries a real header, and patch
  // window.open so the PDF preview renders in-frame (both capture-only).
  if (payload.business) {
    useStore.setState({
      businessSettings: {
        businessName: 'Your Business',
        defaultLaborRate: payload.quote.laborRate ?? 0,
        defaultMarkup: payload.quote.markup ?? 0,
        ...payload.business,
      } as BusinessSettings,
    });
  }
  installPdfPopupCapture();

  const w = globalThis as any;
  // Timeline of spoken events for the capture script. Wall-clock (Date.now) so
  // the Node-side recorder can convert to video-relative offsets — same machine,
  // same epoch clock, so the values are directly comparable.
  const timeline: Array<{ vo: string; t: number }> = [];
  w.__QM_TIMELINE__ = timeline;
  const markVo = (vo?: string) => {
    if (vo) timeline.push({ vo, t: Date.now() });
  };

  w.__QM_DEMO_READY__ = true;
  await sleep(opts.startDelayMs ?? 600);

  // Target the conversation the screen is actually rendering. The screen lazily
  // creates one on focus; wait for it rather than minting our own (which the
  // screen's stale-closure focus effect would then shadow with a fresh empty
  // one, leaving our messages in an orphaned conversation).
  for (let i = 0; i < 40 && !useStore.getState().currentConversationId; i++) await sleep(50);
  let convoId = useStore.getState().currentConversationId ?? useStore.getState().startConversation();

  let started = false;
  for (const ev of payload.events as DemoEvent[]) {
    if (isCancelled()) return;
    await sleep(ev.delayMs ?? between);
    convoId = useStore.getState().currentConversationId ?? convoId;
    const { appendMessage, updateMessage } = useStore.getState();

    // Mark when the first chat content appears so the compositor can trim the
    // variable-length empty boot lead-in precisely (not a fixed guess).
    if (!started && (ev.kind === 'user' || ev.kind === 'assistant' || ev.kind === 'reveal')) {
      timeline.push({ vo: '__start__', t: Date.now() });
      started = true;
    }

    if (ev.kind === 'user') {
      markVo(ev.vo); // human-side voiceover starts when the bubble appears
      appendMessage(convoId, userMessage(ev.text));
      // Linger so the spoken line can finish before the chat moves on.
      if (ev.holdMs) await sleep(ev.holdMs);
    } else if (ev.kind === 'assistant') {
      const id = nextId();
      const tStart = Date.now();
      markVo(ev.vo); // mark when the bubble appears = when the voiceover starts
      appendMessage(convoId, { id, role: 'assistant', text: '', createdAt: nowIso() });
      await typeOut(convoId, id, ev.text, ev.typeMs ?? typingMsPerChar, isCancelled);
      // holdMs is the total time the spoken line needs (from the voiceover's
      // start). The typewriter already consumed part of it, so only wait the
      // remainder — otherwise the bubble sits in dead air after Mate finishes.
      if (ev.holdMs) await sleep(Math.max(0, ev.holdMs - (Date.now() - tStart)));
    } else if (ev.kind === 'working') {
      const id = nextId();
      appendMessage(convoId, {
        id,
        role: 'assistant',
        text: '',
        createdAt: nowIso(),
        working: workingStatus(ev.phases[0], ev.phases[0].phase === 'done'),
      });
      for (const phase of ev.phases) {
        if (isCancelled()) return;
        updateMessage(convoId, id, { working: workingStatus(phase, phase.phase === 'done') });
        await sleep(phase.ms);
      }
    } else if (ev.kind === 'reveal') {
      markVo(ev.vo); // mark when the quote card appears = when its voiceover starts
      appendMessage(convoId, {
        id: nextId(),
        role: 'assistant',
        text: ev.text ?? '',
        createdAt: nowIso(),
        inlineQuoteId: ev.quoteId,
      });
      if (ev.holdMs) await sleep(ev.holdMs);
    } else if (ev.kind === 'previewPdf') {
      await runPreviewPdf(ev.quoteId, ev.pageW ?? 0, ev.holdMs ?? 2500, () => markVo(ev.vo), isCancelled);
    }
  }

  w.__QM_DEMO_DONE__ = true;
  if (typeof w.dispatchEvent === 'function') w.dispatchEvent(new Event('qm-demo-done'));
}

/**
 * Call once inside AssistantScreen. No-op unless this is a capture build AND a
 * payload was injected. Always calls the same hooks so it's safe to mount
 * unconditionally.
 */
export function useDemoPlayback(): void {
  useEffect(() => {
    if (!isDemoCaptureActive()) return;
    const w = globalThis as any;
    const payload = w.__QM_DEMO__ as DemoPayload | undefined;
    if (!payload || w.__QM_DEMO_STARTED__) return;
    w.__QM_DEMO_STARTED__ = true;

    let cancelled = false;
    runDemo(payload, () => cancelled).catch((e) => console.error('[demo] playback failed', e));
    return () => {
      cancelled = true;
    };
  }, []);
}
