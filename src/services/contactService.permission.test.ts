import { describe, it, expect, vi, beforeEach } from 'vitest';

const contactsMock = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(async () => ({ status: 'undetermined', canAskAgain: true })),
  requestPermissionsAsync: vi.fn(async () => ({ status: 'granted', canAskAgain: true })),
}));
vi.mock('expo-contacts', () => contactsMock);

import { requestPhoneContactsPermission } from './contactService';

// Asking for a permission the app already holds (or can no longer ask for)
// shows no dialog on Android, and React Native then never delivers the
// result — the request must only go out when it can change the answer.
describe('requestPhoneContactsPermission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not ask again when access is already granted', async () => {
    contactsMock.getPermissionsAsync.mockResolvedValueOnce({ status: 'granted', canAskAgain: true } as any);
    await expect(requestPhoneContactsPermission()).resolves.toEqual({ granted: true, canAskAgain: true });
    expect(contactsMock.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks when the answer is still open, and returns what the phone said', async () => {
    contactsMock.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied', canAskAgain: true } as any);
    await expect(requestPhoneContactsPermission()).resolves.toEqual({ granted: false, canAskAgain: true });
    expect(contactsMock.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not ask when the phone will not show the prompt any more', async () => {
    contactsMock.getPermissionsAsync.mockResolvedValueOnce({ status: 'denied', canAskAgain: false } as any);
    await expect(requestPhoneContactsPermission()).resolves.toEqual({ granted: false, canAskAgain: false });
    expect(contactsMock.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});
