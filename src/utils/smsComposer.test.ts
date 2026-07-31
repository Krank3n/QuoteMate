import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const nativeSms = vi.hoisted(() => ({
  isAvailableAsync: vi.fn(async () => true),
  sendSMSAsync: vi.fn(async () => ({ result: 'sent' as const })),
}));
vi.mock('expo-sms', () => nativeSms);
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => {}) }));

import { cleanSmsRecipient, openSmsComposer } from './smsComposer';

describe('SMS composer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalises common display formatting without losing an international prefix', () => {
    expect(cleanSmsRecipient(' 0412 345 678 ')).toBe('0412345678');
    expect(cleanSmsRecipient('+61 (0) 412-345-678')).toBe('+610412345678');
  });

  it('passes readable text through native fields instead of a percent-encoded sms URL', async () => {
    const message = 'Hi Sam,\n\nYour quote is ready. Total: $770.00';

    await expect(openSmsComposer('0412 345 678', message)).resolves.toBe('sent');

    expect(nativeSms.sendSMSAsync).toHaveBeenCalledWith('0412345678', message);
    expect(nativeSms.sendSMSAsync.mock.calls[0][1]).not.toContain('%20');
  });

  it('returns cancellation without claiming the message was sent', async () => {
    nativeSms.sendSMSAsync.mockResolvedValueOnce({ result: 'cancelled' });
    await expect(openSmsComposer('0412345678', 'Hello')).resolves.toBe('cancelled');
  });

  it('fails clearly when the device has no SMS composer', async () => {
    nativeSms.isAvailableAsync.mockResolvedValueOnce(false);
    await expect(openSmsComposer('0412345678', 'Hello')).rejects.toThrow('not available');
    expect(nativeSms.sendSMSAsync).not.toHaveBeenCalled();
  });

  it('rejects an empty recipient before opening the native composer', async () => {
    await expect(openSmsComposer(' -- ', 'Hello')).rejects.toThrow('phone number');
    expect(nativeSms.sendSMSAsync).not.toHaveBeenCalled();
  });
});
