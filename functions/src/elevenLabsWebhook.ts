// ElevenLabs post-call webhook — the authoritative record of what a voice
// session actually cost.
//
// The client reports its own duration when a session ends, which is fine as a
// fast path and useless as a source of truth: it can be wrong (a killed app
// never reports at all) and it can lie. This is ElevenLabs telling us what
// they billed, so it wins wherever the two disagree.
//
// Deliberately narrow: the payload carries a full transcript and we take none
// of it. Mate's conversations are already logged separately, and a second copy
// of a tradie's customer names sitting in a different collection is exposure
// with no reader.

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { verifyElevenLabsWebhookSignature } from './elevenLabsWebhookSignature';
import { settleVoiceSecondsUpdate, MAX_SESSION_SECONDS, Plan } from './assistantQuota.helpers';
import { todayKey } from './assistantCosts';
import { EL_VOICE_MODEL_LABEL } from './assistantVoiceToken';
import { PRICING } from './assistantCosts';

/** Standard (non-burst) connection rate, from the pricing table. */
const EL_PLATFORM_USD_PER_MINUTE = PRICING[EL_VOICE_MODEL_LABEL]?.perMinuteUsd ?? 0.08;

const db = () => admin.firestore();

/** Firestore field keys can't contain a slash. Mirrors assistantCosts. */
const sanitiseKey = (model: string) => model.replace(/[.#$/[\]]/g, '_');

export const elevenLabsPostCallWebhook = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const secret = process.env.ELEVENLABS_WEBHOOK_SECRET || '';
    // rawBody is the exact received bytes. JSON.stringify(req.body) would
    // re-serialise and change whitespace/key order, and every signature would
    // fail for reasons nobody could see.
    const rawBody = (req as any).rawBody?.toString('utf8') ?? '';
    const verdict = verifyElevenLabsWebhookSignature({
      header: (req.headers['elevenlabs-signature'] as string) || undefined,
      rawBody,
      secret,
    });
    if (!verdict.ok) {
      // eslint-disable-next-line no-console
      console.warn('[elevenLabsWebhook] rejected:', verdict.reason);
      res.status(401).send('invalid signature');
      return;
    }

    let event: any;
    try { event = JSON.parse(rawBody); } catch { res.status(400).send('bad json'); return; }

    // Audio and call-failure events carry nothing we bill on.
    if (event?.type !== 'post_call_transcription') { res.status(200).send('ignored'); return; }

    const data = event.data || {};
    const conversationId = String(data.conversation_id || '');
    const durationSeconds = Math.max(0, Math.round(Number(data.metadata?.call_duration_secs) || 0));

    // COST UNITS. metadata.cost is in ElevenLabs CREDITS, not dollars — it is
    // simply charging.call_charge + charging.llm_charge. Reading it as dollars
    // recorded $83 for a 47-second call that actually cost $0.068, a ~1200x
    // over-report that looked entirely plausible in a database.
    //
    // charging.llm_price IS in dollars, and the platform side we can compute
    // exactly from duration because we know the per-minute rate. So: their
    // authoritative LLM figure, plus our own arithmetic for the connection
    // time. No credit-to-dollar conversion anywhere, because that rate is
    // undocumented and would drift silently.
    const llmUsd = Number(data.metadata?.charging?.llm_price ?? 0);
    const platformUsd = (durationSeconds / 60) * EL_PLATFORM_USD_PER_MINUTE;
    const reportedCostUsd = platformUsd + llmUsd;

    if (!conversationId) { res.status(200).send('no conversation id'); return; }

    const sessionRef = db().doc(`voiceSessions/${conversationId}`);
    try {
      await db().runTransaction(async (tx) => {
        const snap = await tx.get(sessionRef);
        const session = snap.data();
        // No mapping row means we never minted this — a session for another
        // workspace, or one predating the mapping. Nothing to attribute.
        if (!session?.uid) return;
        if (session.settledBy === 'webhook') return; // already authoritative

        const uid: string = session.uid;
        const plan: Plan = (session.plan as Plan) || 'free';
        const actualSeconds = Math.min(durationSeconds, MAX_SESSION_SECONDS[plan]);
        const usageRef = db().doc(`users/${uid}/assistantUsage/${todayKey()}`);
        const usageSnap = await tx.get(usageRef);

        // The client may already have settled against its own guess. Correct
        // the difference rather than charging the whole thing twice.
        const alreadyCounted = Number(session.settledSeconds ?? 0);
        const holdSeconds = session.settledAt ? alreadyCounted : Number(session.heldSeconds ?? 0);
        const update = settleVoiceSecondsUpdate(usageSnap.data(), {
          plan, holdSeconds, actualSeconds,
        });

        const costMicros = Math.round(reportedCostUsd * 1_000_000);
        const alreadyCostMicros = Number(session.costMicros ?? 0);
        const costDelta = costMicros - alreadyCostMicros;
        const inc = admin.firestore.FieldValue.increment;

        const patch: Record<string, unknown> = {
          voiceDurationSeconds: inc(actualSeconds - alreadyCounted),
          costMicros: inc(costDelta),
          [`models.${sanitiseKey(EL_VOICE_MODEL_LABEL)}.voiceCostMicros`]: inc(costDelta),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (update) patch.voiceSeconds = update.voiceSeconds;
        // A session the client never reported was never counted at all.
        if (!session.settledAt) patch.voiceSessions = inc(1);

        tx.set(usageRef, patch, { merge: true });
        tx.set(db().doc(`assistantCostsDaily/${todayKey()}`), {
          voiceDurationSeconds: inc(actualSeconds - alreadyCounted),
          costMicros: inc(costDelta),
          [`activeUsers.${uid}`]: true,
          date: todayKey(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(sessionRef, {
          settledAt: session.settledAt ?? admin.firestore.FieldValue.serverTimestamp(),
          settledBy: 'webhook',
          settledSeconds: actualSeconds,
          costMicros,
          // Kept so a drift between what we thought and what we were billed is
          // visible without re-querying ElevenLabs.
          clientReportedSeconds: session.settledAt ? alreadyCounted : null,
        }, { merge: true });
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[elevenLabsWebhook] settle failed', conversationId, err?.message);
      // 500 so ElevenLabs retries — a dropped delivery is a cost record lost.
      res.status(500).send('settle failed');
      return;
    }

    res.status(200).send('ok');
  });
