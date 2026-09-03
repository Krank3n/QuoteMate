// @vitest-environment jsdom
/**
 * Apple req 5.12 — the tradie must find out when a payment wasn't approved and
 * they had already closed the app.
 *
 * The failure this guards against is silent and expensive: a card that didn't
 * go through, a customer who has driven off, and a tradie who thinks they've
 * been paid. The armed notice is the only mechanism that survives the app being
 * killed, so the cases that matter most are the ones where nothing else runs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const notif = vi.hoisted(() => ({
  status: 'granted' as string,
  scheduled: [] as any[],
  cancelled: [] as string[],
  scheduleThrows: false,
  scheduleNotificationAsync: vi.fn(async (req: any) => {
    if (notif.scheduleThrows) throw new Error('nope');
    notif.scheduled.push(req);
    return `notice-${notif.scheduled.length}`;
  }),
  cancelScheduledNotificationAsync: vi.fn(async (id: string) => {
    notif.cancelled.push(id);
  }),
  getPermissionsAsync: vi.fn(async () => ({ status: notif.status })),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

vi.mock('expo-notifications', () => notif);

const appState = vi.hoisted(() => ({ current: 'active' as string }));
vi.mock('react-native', async () => {
  const actual = await vi.importActual<any>('react-native');
  return {
    ...actual,
    AppState: {
      ...actual.AppState,
      get currentState() {
        return appState.current;
      },
    },
  };
});

import {
  armUnseenOutcomeNotice,
  disarmUnseenOutcomeNotice,
  notifyUnapprovedOutcomeIfAway,
  unapprovedOutcomeMessage,
  unseenOutcomeMessage,
  UNSEEN_OUTCOME_DELAY_SECONDS,
} from '../tapToPayOutcomeNotice';

beforeEach(() => {
  notif.status = 'granted';
  notif.scheduled = [];
  notif.cancelled = [];
  notif.scheduleThrows = false;
  appState.current = 'active';
  vi.clearAllMocks();
});

describe('the armed fallback', () => {
  it('is scheduled ahead of the tap, so it survives the app being killed', async () => {
    const id = await armUnseenOutcomeNotice();
    expect(id).toBe('notice-1');
    expect(notif.scheduled[0].trigger).toEqual({
      type: 'timeInterval',
      seconds: UNSEEN_OUTCOME_DELAY_SECONDS,
    });
  });

  it('does not claim the payment failed — we do not know that it did', () => {
    const { title, body } = unseenOutcomeMessage();
    expect(`${title} ${body}`).not.toMatch(/declin|failed|rejected/i);
    // It must still prompt an action, or it is just anxiety.
    expect(body).toMatch(/check/i);
  });

  it('is cancelled on any outcome, not just a bad one', async () => {
    await disarmUnseenOutcomeNotice('notice-1');
    expect(notif.cancelled).toEqual(['notice-1']);
  });

  it('disarming a notice that was never armed is a no-op', async () => {
    await disarmUnseenOutcomeNotice(null);
    expect(notif.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('survives a notice that already fired', async () => {
    notif.cancelScheduledNotificationAsync.mockRejectedValueOnce(new Error('gone'));
    await expect(disarmUnseenOutcomeNotice('notice-1')).resolves.toBeUndefined();
  });

  it('arms nothing without notification permission, rather than throwing', async () => {
    notif.status = 'denied';
    await expect(armUnseenOutcomeNotice()).resolves.toBeNull();
    expect(notif.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('never lets a scheduling failure block taking a payment', async () => {
    notif.scheduleThrows = true;
    await expect(armUnseenOutcomeNotice()).resolves.toBeNull();
  });
});

describe('a known outcome while the tradie is away', () => {
  it('tells them a declined card took no money', async () => {
    appState.current = 'background';
    await expect(notifyUnapprovedOutcomeIfAway('declined')).resolves.toBe(true);
    expect(notif.scheduled[0].content.title).toBe('Card declined');
    expect(notif.scheduled[0].content.body).toMatch(/no money was taken/i);
    expect(notif.scheduled[0].trigger).toBeNull();
  });

  it('stays quiet in the foreground — the sheet already says it', async () => {
    appState.current = 'active';
    await expect(notifyUnapprovedOutcomeIfAway('declined')).resolves.toBe(false);
    expect(notif.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('never announces a cancellation — they chose it', async () => {
    appState.current = 'background';
    await expect(notifyUnapprovedOutcomeIfAway('cancelled')).resolves.toBe(false);
    expect(notif.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(unapprovedOutcomeMessage('cancelled')).toBeNull();
  });

  it.each(['declined', 'os_too_old', 'failed'] as const)(
    'has copy for %s that says no payment was taken',
    (kind) => {
      const msg = unapprovedOutcomeMessage(kind);
      expect(msg).not.toBeNull();
      expect(`${msg!.title} ${msg!.body}`).toMatch(/not taken|no money|declined/i);
    },
  );

  it('is silent without permission rather than throwing', async () => {
    appState.current = 'background';
    notif.status = 'denied';
    await expect(notifyUnapprovedOutcomeIfAway('declined')).resolves.toBe(false);
  });
});
