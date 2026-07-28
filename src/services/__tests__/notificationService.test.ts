/**
 * Regression tests for scheduleLocalNotification.
 *
 * Sentry issue sentry-7637087021: on iOS, scheduling a local notification when
 * the user hasn't granted notification permission makes UNUserNotificationCenter
 * reject with `UNErrorDomain Code=1 "Notifications are not allowed for this
 * application"`. The only call site fires it unawaited inside a `finally`, so the
 * rejection became an unhandled promise rejection.
 *
 * The fix checks permission before scheduling and wraps the whole thing in
 * try/catch so no native rejection can ever surface.
 *
 * notificationService loads expo-notifications / expo-device via CommonJS
 * `require()` (to stay safe under Expo Go, where the native module is absent).
 * vitest's `vi.mock` only intercepts `import`, not `require`, so we intercept the
 * `require` at the Node module loader and dynamic-import the service afterwards.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import Module from 'node:module';

const { getPermissionsAsync, scheduleNotificationAsync } = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
}));

const notificationsModule = {
  getPermissionsAsync,
  scheduleNotificationAsync,
  setNotificationHandler: vi.fn(),
};

const deviceModule = {};

// Intercept the service's `require('expo-notifications' | 'expo-device')`.
const originalLoad = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...a: unknown[]) => unknown })._load = function (
  this: unknown,
  request: string,
  ...rest: unknown[]
) {
  if (request === 'expo-notifications') return notificationsModule;
  if (request === 'expo-device') return deviceModule;
  return originalLoad.call(this, request, ...rest);
};

afterAll(() => {
  (Module as unknown as { _load: (...a: unknown[]) => unknown })._load = originalLoad;
});

// appOwnership must NOT be 'expo' so the native-module-available guard passes.
vi.mock('expo-constants', () => ({
  default: {
    appOwnership: 'standalone',
    expoConfig: { extra: { eas: { projectId: 'test-project' } } },
  },
}));

// Keep Firestore work out of these tests.
vi.mock('../firestoreService', () => ({
  firestoreService: {
    saveFcmToken: vi.fn(),
    removeFcmToken: vi.fn(),
  },
}));

// Dynamic import AFTER the require interceptor is installed (a static import
// would be hoisted above it and see the real, unparseable native module).
const { notificationService } = await import('../notificationService');

beforeEach(() => {
  getPermissionsAsync.mockReset();
  scheduleNotificationAsync.mockReset();
});

describe('scheduleLocalNotification', () => {
  it('is a no-op (and never throws) when permission is denied', async () => {
    getPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(
      notificationService.scheduleLocalNotification('title', 'body'),
    ).resolves.toBeUndefined();

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('never surfaces a native rejection — regression for sentry-7637087021', async () => {
    getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    scheduleNotificationAsync.mockRejectedValue(
      new Error(
        'Error Domain=UNErrorDomain Code=1 "Notifications are not allowed for this application"',
      ),
    );

    await expect(
      notificationService.scheduleLocalNotification('title', 'body'),
    ).resolves.toBeUndefined();
  });

  it('schedules an immediate notification when permission is granted', async () => {
    getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    scheduleNotificationAsync.mockResolvedValue('notification-id');

    await notificationService.scheduleLocalNotification('title', 'body', { foo: 'bar' });

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationAsync).toHaveBeenCalledWith({
      content: {
        title: 'title',
        body: 'body',
        data: { foo: 'bar' },
        sound: true,
      },
      trigger: null,
    });
  });
});
