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
import type { ChatMessage, WorkingStatus } from '../types/assistant';
import type { Quote } from '../types';
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

async function runDemo(payload: DemoPayload, isCancelled: () => boolean): Promise<void> {
  const opts = payload.options ?? {};
  const typingMsPerChar = opts.typingMsPerChar ?? 22;
  const between = opts.betweenMs ?? 600;

  // Seed the priced quote so the `reveal` event can render it inline.
  useStore.setState({ quotes: [reviveQuote(payload.quote)] });

  const w = globalThis as any;
  w.__QM_DEMO_READY__ = true;
  await sleep(opts.startDelayMs ?? 600);

  // Target the conversation the screen is actually rendering. The screen lazily
  // creates one on focus; wait for it rather than minting our own (which the
  // screen's stale-closure focus effect would then shadow with a fresh empty
  // one, leaving our messages in an orphaned conversation).
  for (let i = 0; i < 40 && !useStore.getState().currentConversationId; i++) await sleep(50);
  let convoId = useStore.getState().currentConversationId ?? useStore.getState().startConversation();

  for (const ev of payload.events as DemoEvent[]) {
    if (isCancelled()) return;
    await sleep(ev.delayMs ?? between);
    convoId = useStore.getState().currentConversationId ?? convoId;
    const { appendMessage, updateMessage } = useStore.getState();

    if (ev.kind === 'user') {
      appendMessage(convoId, userMessage(ev.text));
    } else if (ev.kind === 'assistant') {
      const id = nextId();
      appendMessage(convoId, { id, role: 'assistant', text: '', createdAt: nowIso() });
      await typeOut(convoId, id, ev.text, ev.typeMs ?? typingMsPerChar, isCancelled);
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
      appendMessage(convoId, {
        id: nextId(),
        role: 'assistant',
        text: ev.text ?? '',
        createdAt: nowIso(),
        inlineQuoteId: ev.quoteId,
      });
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
