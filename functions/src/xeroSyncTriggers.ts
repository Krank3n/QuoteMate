/**
 * Auto-push trigger: when a unified document transitions into
 * `quote_accepted`, push it to Xero as a Xero Quote (status ACCEPTED). Also
 * fires when the user explicitly retries an errored sync (xeroSyncStatus
 * leaves 'error' while still in quote_accepted).
 *
 * Idempotency: the push helper writes back xeroQuoteId / xeroSyncStatus /
 * xeroSyncedAt onto the same document. Those writes re-fire this trigger,
 * but neither condition below matches (stage didn't transition, syncStatus
 * didn't leave 'error') so the second pass exits cleanly.
 *
 * Trigger overlap: shares the users/{userId}/documents path with
 * onDocumentWriteSyncJob (jobHandlers.ts). Different field surface — Xero
 * fields here vs jobId/aggregate fields there — so they don't fight, but
 * each Xero write costs one extra aggregate recompute. Cheap, expected.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';

import {
  buildXeroAuthHeaders,
  pushQuoteToXeroCore,
  persistQuoteSyncSuccess,
  persistQuoteSyncError,
} from './xeroSync';

const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID || '';
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET || process.env.XERO_SECRET || '';

/**
 * Server-side token fetch (mirror of the one in index.ts so this module
 * stays import-cycle-free). Returns null when the user isn't connected or
 * a refresh fails.
 */
async function getXeroTokensForUser(
  userId: string,
): Promise<{ accessToken: string; tenantId: string; syncEnabled: boolean } | null> {
  const firestore = admin.firestore();
  const connRef = firestore.doc(`users/${userId}/settings/xeroConnection`);
  const connDoc = await connRef.get();
  if (!connDoc.exists) return null;

  const data = connDoc.data() || {};
  const { accessToken, refreshToken, tokenExpiresAt, tenantId } = data;
  const syncEnabled = data.syncEnabled !== false; // default true

  if (!accessToken || !refreshToken || !tenantId) return null;

  if (tokenExpiresAt && tokenExpiresAt > Date.now() + 60_000) {
    return { accessToken, tenantId, syncEnabled };
  }

  // Refresh
  try {
    const tokenResponse = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });
    if (!tokenResponse.ok) {
      await connRef.update({ syncEnabled: false, disconnectedReason: 'token_refresh_failed' });
      return null;
    }
    const tokenData: any = await tokenResponse.json();
    const newAccessToken = tokenData.access_token;
    const expiresIn = tokenData.expires_in || 1800;
    const updateData: any = {
      accessToken: newAccessToken,
      tokenExpiresAt: Date.now() + expiresIn * 1000,
    };
    if (tokenData.refresh_token) updateData.refreshToken = tokenData.refresh_token;
    await connRef.update(updateData);
    return { accessToken: newAccessToken, tenantId, syncEnabled };
  } catch {
    return null;
  }
}

/**
 * Decide whether this write should trigger an auto-push. Returns true on:
 *  - first transition into quote_accepted (happy path)
 *  - retry: xeroSyncStatus left 'error' while stage is quote_accepted
 *
 * Self-write loops (we wrote xeroQuoteId / set status='synced') don't match
 * either condition because before.stage already equalled after.stage and
 * before.xeroSyncStatus was 'syncing' (or absent), not 'error'.
 */
function shouldFire(before: any, after: any): { fire: boolean; reason: string } {
  if (!after) return { fire: false, reason: 'doc-deleted' };
  if (after.type !== 'quote') return { fire: false, reason: 'not-a-quote' };
  if (after.stage !== 'quote_accepted') return { fire: false, reason: 'not-accepted' };

  const wasAccepted = before?.stage === 'quote_accepted';
  if (!wasAccepted) {
    return { fire: true, reason: 'transition-into-accepted' };
  }

  const beforeStatus = before?.xeroSyncStatus;
  const afterStatus = after?.xeroSyncStatus;
  if (beforeStatus === 'error' && afterStatus !== 'error') {
    return { fire: true, reason: 'error-retry' };
  }

  return { fire: false, reason: 'no-relevant-transition' };
}

export const onDocumentAcceptedSyncXero = functions.firestore
  .document('users/{userId}/documents/{docId}')
  .onWrite(async (change, ctx) => {
    const userId = ctx.params.userId as string;
    const docId = ctx.params.docId as string;

    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;

    const decision = shouldFire(before, after);
    if (!decision.fire) return;

    const tokens = await getXeroTokensForUser(userId);
    if (!tokens) {
      functions.logger.info('xero_auto_push_skipped', {
        userId,
        docId,
        reason: 'no-connection',
      });
      return;
    }
    if (!tokens.syncEnabled) {
      functions.logger.info('xero_auto_push_skipped', {
        userId,
        docId,
        reason: 'sync-disabled',
      });
      return;
    }

    // Mark syncing so the UI can show a spinner and a concurrent retry
    // doesn't double-fire.
    try {
      await admin
        .firestore()
        .doc(`users/${userId}/documents/${docId}`)
        .update({ xeroSyncStatus: 'syncing', xeroSyncError: admin.firestore.FieldValue.delete() });
    } catch (err: any) {
      functions.logger.warn('xero_auto_push_mark_syncing_failed', {
        userId,
        docId,
        error: err?.message,
      });
    }

    try {
      const headers = buildXeroAuthHeaders(tokens.accessToken, tokens.tenantId);
      const result = await pushQuoteToXeroCore(headers, { ...after, id: docId });

      if (!result.ok) {
        await persistQuoteSyncError(userId, docId, result.details || result.error);
        functions.logger.error('xero_auto_push_failed', {
          userId,
          docId,
          reason: decision.reason,
          error: result.error,
        });
        return;
      }

      await persistQuoteSyncSuccess(userId, docId, result);
      functions.logger.info('xero_auto_push_success', {
        userId,
        docId,
        reason: decision.reason,
        xeroQuoteId: result.xeroQuoteId,
      });
    } catch (err: any) {
      await persistQuoteSyncError(userId, docId, err?.message || 'Unknown error');
      functions.logger.error('xero_auto_push_threw', {
        userId,
        docId,
        error: err?.message,
      });
    }
  });
