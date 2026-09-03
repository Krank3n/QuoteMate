/**
 * app_opened — the one event that says a tradie came back.
 *
 * Until this shipped the app recorded what people DID (drafted, sent, viewed
 * the paywall) but never that they showed up at all: day-1 retention was
 * inferred from quote timestamps, and the pushes whose whole job is to pull a
 * tradie back (customer viewed your quote, customer accepted, invoice paid)
 * had no read on whether a single one of them worked.
 *
 * One event per open, carrying what the event funnel folds on:
 *   source                 cold | foreground | push
 *   push_type              the push's `type` (quote_viewed, invoice_paid…)
 *                          when source is push
 *   hours_since_last_open  gap to the previous open on this device, null the
 *                          first time a device is ever opened
 *   already_active         true only when a push was tapped with the app
 *                          already in front (an iOS foreground banner, or a
 *                          tap that arrived after the grace window) — the
 *                          push still pulled them somewhere, so it is
 *                          attributed, but it did not open the app
 *
 * Attribution rides on a grace window rather than on ordering guarantees:
 * the OS hands over "the app became active" and "a notification was tapped"
 * as two independent callbacks, in either order, tens of milliseconds apart.
 * An open is held for PUSH_GRACE_MS; a tap inside the window claims it,
 * otherwise the open goes out as plain cold / foreground.
 *
 * "Foreground" means back from the background, not back from `inactive`:
 * iOS reports inactive for a phone call or a swipe into Control Centre, and
 * neither is a return visit. A cold open is counted once per process.
 *
 * Pure apart from the injected deps so the timing is testable with fake
 * timers; the singleton at the bottom wires it to analytics + AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { trackEvent } from './analyticsService';

export type AppOpenSource = 'cold' | 'foreground' | 'push';

// A type alias, not an interface: analytics props need an implicit index
// signature, which TypeScript grants object-literal types but not interfaces.
export type AppOpenProps = {
  source: AppOpenSource;
  push_type?: string;
  hours_since_last_open: number | null;
  already_active?: boolean;
};

export interface AppOpenTrackerDeps {
  track: (props: AppOpenProps) => void;
  loadLastOpenedAt: () => Promise<number | null>;
  saveLastOpenedAt: (ms: number) => Promise<void>;
  now?: () => number;
  graceMs?: number;
}

export interface AppOpenTracker {
  /** The app is in front: 'cold' once per process, 'foreground' on each return from background. */
  noteOpen(kind: 'cold' | 'foreground'): void;
  /**
   * A notification was tapped. `type` is the push data's `type`; `key`
   * identifies the response so the same tap seen twice (the live listener
   * and the launch-response lookup both report it) is counted once.
   */
  notePushTap(type: unknown, key?: string): void;
  /** Feed AppState changes; only background → active counts as an open. */
  handleAppStateChange(state: string): void;
}

/** How long an open waits for a notification tap to claim it. */
export const PUSH_GRACE_MS = 2000;

const HOUR_MS = 60 * 60 * 1000;

export const LAST_OPENED_AT_KEY = 'app_last_opened_at';

interface PendingOpen {
  kind: 'cold' | 'foreground';
  at: number;
  timer: ReturnType<typeof setTimeout>;
}

export function createAppOpenTracker(deps: AppOpenTrackerDeps): AppOpenTracker {
  const now = deps.now ?? Date.now;
  const graceMs = deps.graceMs ?? PUSH_GRACE_MS;

  let pending: PendingOpen | null = null;
  let wasBackgrounded = false;
  let coldOpenNoted = false;
  const seenTaps = new Set<string>();

  // The previous open, cached after the first read so back-to-back opens in
  // one process measure against each other rather than racing the storage
  // write. undefined = not loaded yet.
  let lastOpenedAt: Promise<number | null> | undefined;
  function previousOpen(): Promise<number | null> {
    if (!lastOpenedAt) {
      lastOpenedAt = deps.loadLastOpenedAt().catch(() => null);
    }
    return lastOpenedAt;
  }

  async function emit(at: number, props: Omit<AppOpenProps, 'hours_since_last_open'>): Promise<void> {
    const previous = await previousOpen();
    // Every emission moves the marker, before the write lands, so the next
    // open in this process sees this one.
    lastOpenedAt = Promise.resolve(at);
    const usable = typeof previous === 'number' && Number.isFinite(previous) && previous <= at;
    const hours = usable ? Math.round(((at - previous) / HOUR_MS) * 10) / 10 : null;
    // No undefined values: Firestore rejects them outright, and one bad key
    // would drop the whole event.
    const payload: AppOpenProps = { source: props.source, hours_since_last_open: hours };
    if (props.push_type !== undefined) payload.push_type = props.push_type;
    if (props.already_active) payload.already_active = true;
    try {
      deps.track(payload);
    } finally {
      await deps.saveLastOpenedAt(at).catch(() => {});
    }
  }

  function noteOpen(kind: 'cold' | 'foreground'): void {
    if (kind === 'cold') {
      if (coldOpenNoted) return;
      coldOpenNoted = true;
    }
    // An open already waiting to flush is this same open seen twice.
    if (pending) return;
    const at = now();
    void previousOpen(); // start the storage read now, so it's back by flush time
    const timer = setTimeout(() => {
      pending = null;
      void emit(at, { source: kind });
    }, graceMs);
    pending = { kind, at, timer };
  }

  function notePushTap(type: unknown, key?: string): void {
    if (key) {
      if (seenTaps.has(key)) return;
      seenTaps.add(key);
    }
    const pushType = typeof type === 'string' && type.trim() ? type.trim() : undefined;
    if (pending) {
      clearTimeout(pending.timer);
      const { at } = pending;
      pending = null;
      void emit(at, { source: 'push', push_type: pushType });
      return;
    }
    void emit(now(), { source: 'push', push_type: pushType, already_active: true });
  }

  function handleAppStateChange(state: string): void {
    if (state === 'background') {
      wasBackgrounded = true;
      return;
    }
    if (state === 'active' && wasBackgrounded) {
      wasBackgrounded = false;
      noteOpen('foreground');
    }
  }

  return { noteOpen, notePushTap, handleAppStateChange };
}

/**
 * A stable key for one notification response, so a tap reported by both the
 * live listener and the launch-response lookup is attributed once.
 */
export function pushTapKey(response: unknown): string | undefined {
  const r = response as
    | { actionIdentifier?: unknown; notification?: { request?: { identifier?: unknown } } }
    | null
    | undefined;
  const id = r?.notification?.request?.identifier;
  if (typeof id !== 'string' || !id) return undefined;
  const action = typeof r?.actionIdentifier === 'string' ? r.actionIdentifier : '';
  return `${action}:${id}`;
}

/** The push's `type` from a notification response's data payload, if any. */
export function pushTypeOf(response: unknown): unknown {
  const r = response as
    | { notification?: { request?: { content?: { data?: { type?: unknown } } } } }
    | null
    | undefined;
  return r?.notification?.request?.content?.data?.type;
}

async function loadLastOpenedAt(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(LAST_OPENED_AT_KEY);
  const ms = raw === null ? NaN : Number(raw);
  return Number.isFinite(ms) ? ms : null;
}

async function saveLastOpenedAt(ms: number): Promise<void> {
  await AsyncStorage.setItem(LAST_OPENED_AT_KEY, String(ms));
}

export const appOpenTracker: AppOpenTracker = createAppOpenTracker({
  track: (props) => trackEvent('app_opened', props),
  loadLastOpenedAt,
  saveLastOpenedAt,
});
