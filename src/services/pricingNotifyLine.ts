/**
 * The one line under Mate's working card while a quote prices on the server:
 * "you can lock your phone, I'll let you know" (push permission granted), an
 * offer to be told (permission never asked), or — where no push is possible —
 * just the fact that the run keeps going.
 *
 * The push permission is otherwise only requested after a quote goes to a
 * real customer (see pushPermissionPrompt) because the OS prompt is one-shot
 * on iOS. Waiting for a price run is the other moment a tradie has a concrete
 * reason to want a notification — and here the tap IS the pre-prompt, so the
 * OS dialog is only ever shown to someone who just asked for it. This path
 * deliberately does not touch pushPermissionPrompt's "already asked" marker:
 * a decline here must not cost the send-time ask.
 *
 * Pure decision logic, with every device dependency injected.
 */

export type NotifyLineState = 'ready' | 'offer' | 'plain';

export const NOTIFY_LINE_COPY = {
  ready: "Lock your phone if you like — I'll let you know when it's ready.",
  offer: "Tell me when it's done",
  asking: 'Just a sec…',
  declined: "No worries — lock the phone if you like, it'll keep going.",
  plain: "Lock your phone if you like — it'll keep going.",
  plainWeb: "Safe to switch tabs — it'll keep going.",
} as const;

export interface NotifyLineIo {
  /** Web has no push; the run still survives a backgrounded tab. */
  isWeb: boolean;
  /** Whether the native notification module loaded (not Expo Go, not the simulator). */
  available(): boolean;
  hasPermission(): Promise<boolean>;
  canAskPermission(): Promise<boolean>;
  /** Registers for push, showing the OS prompt if needed. Null when refused. */
  register(): Promise<string | null>;
}

/**
 * Never hidden: the run genuinely survives the phone being locked, and a
 * tradie who declined pushes six months ago still deserves to know that.
 */
export async function resolveNotifyLineState(io: Omit<NotifyLineIo, 'register'>): Promise<NotifyLineState> {
  if (io.isWeb || !io.available()) return 'plain';
  if (await io.hasPermission()) return 'ready';
  if (await io.canAskPermission()) return 'offer';
  return 'plain';
}

/** The copy for a state that carries no action. */
export function plainLineCopy(isWeb: boolean): string {
  return isWeb ? NOTIFY_LINE_COPY.plainWeb : NOTIFY_LINE_COPY.plain;
}

/** The tap on "Tell me when it's done". */
export async function acceptNotifyOffer(io: Pick<NotifyLineIo, 'register'>): Promise<'ready' | 'declined'> {
  try {
    const token = await io.register();
    return token ? 'ready' : 'declined';
  } catch {
    return 'declined';
  }
}
