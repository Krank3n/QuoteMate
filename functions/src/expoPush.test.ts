import { Response } from 'node-fetch';
import { describe, expect, it, vi } from 'vitest';
import {
  EXPO_PUSH_SEND_URL,
  ExpoPushOptions,
  isExpoPushToken,
  sendExpoPushNotifications,
} from './expoPush';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function asFetch(mock: ReturnType<typeof vi.fn>): NonNullable<ExpoPushOptions['fetchImpl']> {
  return mock as unknown as NonNullable<ExpoPushOptions['fetchImpl']>;
}

describe('Expo push transport', () => {
  it('recognises current and legacy Expo token formats but rejects FCM tokens', () => {
    expect(isExpoPushToken('ExpoPushToken[abc-123]')).toBe(true);
    expect(isExpoPushToken('ExponentPushToken[abc-123]')).toBe(true);
    expect(isExpoPushToken('fcm-registration-token')).toBe(false);
    expect(isExpoPushToken(undefined)).toBe(false);
  });

  it('posts the existing tokens and notification payload to Expo', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ status: 'ok', id: 'ticket-1' }] }));

    const result = await sendExpoPushNotifications(
      [{ id: 'ios-device', token: 'ExpoPushToken[token-1]' }],
      { title: 'Quote accepted', body: 'Nice one', data: { quoteId: 'q1' } },
      { fetchImpl: asFetch(fetchMock), accessToken: '' }
    );

    expect(result).toEqual({
      acceptedCount: 1,
      failedCount: 0,
      tokenDocumentIdsToDelete: [],
      errors: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(EXPO_PUSH_SEND_URL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual([{
      to: 'ExpoPushToken[token-1]',
      title: 'Quote accepted',
      body: 'Nice one',
      data: { quoteId: 'q1' },
      sound: 'default',
      priority: 'high',
      channelId: 'quote-responses',
    }]);
  });

  it('does not send malformed tokens and marks their documents for deletion', async () => {
    const fetchMock = vi.fn();

    const result = await sendExpoPushNotifications(
      [{ id: 'bad-device', token: 'not-an-expo-token' }],
      { title: 'Title', body: 'Body' },
      { fetchImpl: asFetch(fetchMock), accessToken: '' }
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.acceptedCount).toBe(0);
    expect(result.tokenDocumentIdsToDelete).toEqual(['bad-device']);
  });

  it('cleans up every document for a token Expo reports as unregistered', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      data: [{
        status: 'error',
        message: 'The device is no longer registered',
        details: { error: 'DeviceNotRegistered' },
      }],
    }));

    const result = await sendExpoPushNotifications(
      [
        { id: 'device-a', token: 'ExpoPushToken[same-token]' },
        { id: 'device-b', token: 'ExpoPushToken[same-token]' },
      ],
      { title: 'Title', body: 'Body' },
      { fetchImpl: asFetch(fetchMock), accessToken: '' }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.acceptedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.tokenDocumentIdsToDelete).toEqual(['device-a', 'device-b']);
    expect(result.errors[0].code).toBe('DeviceNotRegistered');
  });

  it('chunks Expo requests at the 100-message gateway limit', async () => {
    const batchSizes: number[] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body?: unknown }) => {
      const messages = JSON.parse(String(init.body)) as unknown[];
      batchSizes.push(messages.length);
      return jsonResponse({ data: messages.map((_, index) => ({ status: 'ok', id: `ticket-${index}` })) });
    });
    const recipients = Array.from({ length: 205 }, (_, index) => ({
      id: `device-${index}`,
      token: `ExpoPushToken[token-${index}]`,
    }));

    const result = await sendExpoPushNotifications(
      recipients,
      { title: 'Title', body: 'Body' },
      { fetchImpl: asFetch(fetchMock), accessToken: '' }
    );

    expect(batchSizes).toEqual([100, 100, 5]);
    expect(result.acceptedCount).toBe(205);
  });

  it('surfaces gateway failures instead of silently reporting success', async () => {
    const fetchMock = vi.fn(async () => new Response('service unavailable', { status: 503 }));

    await expect(sendExpoPushNotifications(
      [{ id: 'device', token: 'ExpoPushToken[token]' }],
      { title: 'Title', body: 'Body' },
      { fetchImpl: asFetch(fetchMock), accessToken: '' }
    )).rejects.toThrow('Expo push gateway returned HTTP 503');
  });
});
