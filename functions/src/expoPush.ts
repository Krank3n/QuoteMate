import fetch, { RequestInit } from 'node-fetch';

export const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;
const PERMANENT_TOKEN_ERROR = 'DeviceNotRegistered';

export interface StoredExpoPushToken {
  /** Firestore token-document id. */
  id: string;
  token: string;
}

export interface ExpoPushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushResponse {
  data?: ExpoPushTicket | ExpoPushTicket[];
}

export interface ExpoPushError {
  recipientIds: string[];
  code: string;
  message: string;
}

export interface ExpoPushResult {
  acceptedCount: number;
  failedCount: number;
  /** Malformed Expo tokens and tokens Expo reports as unregistered. */
  tokenDocumentIdsToDelete: string[];
  errors: ExpoPushError[];
}

type FetchLike = (url: string, init: RequestInit) => ReturnType<typeof fetch>;

export interface ExpoPushOptions {
  fetchImpl?: FetchLike;
  accessToken?: string;
}

/** Expo currently emits ExpoPushToken[...] and legacy ExponentPushToken[...]. */
export function isExpoPushToken(token: unknown): token is string {
  return typeof token === 'string'
    && /^(?:Expo|Exponent)PushToken\[[^\]\s]+\]$/.test(token);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/**
 * Send stored Expo tokens through Expo's push gateway.
 *
 * The app stores Expo-format tokens in the legacy-named `fcmTokens`
 * collection. These tokens must never be passed to Firebase Admin Messaging.
 */
export async function sendExpoPushNotifications(
  recipients: StoredExpoPushToken[],
  payload: ExpoPushPayload,
  options: ExpoPushOptions = {}
): Promise<ExpoPushResult> {
  const tokenDocumentIdsToDelete: string[] = [];
  const tokenToDocumentIds = new Map<string, string[]>();

  for (const recipient of recipients) {
    if (!isExpoPushToken(recipient.token)) {
      tokenDocumentIdsToDelete.push(recipient.id);
      continue;
    }

    const ids = tokenToDocumentIds.get(recipient.token) || [];
    ids.push(recipient.id);
    tokenToDocumentIds.set(recipient.token, ids);
  }

  const uniqueRecipients = Array.from(tokenToDocumentIds.entries()).map(([token, ids]) => ({ token, ids }));
  const errors: ExpoPushError[] = [];
  let acceptedCount = 0;
  let failedCount = 0;
  const fetchImpl = options.fetchImpl || fetch;
  const accessToken = options.accessToken ?? process.env.EXPO_ACCESS_TOKEN;

  for (const batch of chunks(uniqueRecipients, EXPO_BATCH_SIZE)) {
    const messages = batch.map(({ token }) => ({
      to: token,
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      sound: 'default' as const,
      priority: 'high' as const,
      channelId: 'quote-responses',
    }));

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetchImpl(EXPO_PUSH_SEND_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 500);
      throw new Error(`Expo push gateway returned HTTP ${response.status}: ${responseBody}`);
    }

    const responseBody = await response.json() as ExpoPushResponse;
    const tickets = Array.isArray(responseBody.data)
      ? responseBody.data
      : responseBody.data
        ? [responseBody.data]
        : [];

    if (tickets.length !== batch.length) {
      throw new Error(`Expo push gateway returned ${tickets.length} tickets for ${batch.length} messages`);
    }

    tickets.forEach((ticket, index) => {
      const recipient = batch[index];
      if (ticket.status === 'ok') {
        acceptedCount++;
        return;
      }

      failedCount++;
      const code = ticket.details?.error || 'UnknownExpoPushError';
      errors.push({
        recipientIds: recipient.ids,
        code,
        message: ticket.message || 'Expo rejected the push notification',
      });
      if (code === PERMANENT_TOKEN_ERROR) {
        tokenDocumentIdsToDelete.push(...recipient.ids);
      }
    });
  }

  return {
    acceptedCount,
    failedCount,
    tokenDocumentIdsToDelete: Array.from(new Set(tokenDocumentIdsToDelete)),
    errors,
  };
}
