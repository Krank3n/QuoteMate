/**
 * What the end-of-wizard footer offers.
 *
 * JobPreview's footer used to split 50/50 between an outlined "Take
 * Payment / Take Deposit / Tap to Pay" and a contained Send on every
 * platform but iOS — so the last screen of quote #1 answered "you're
 * finished" with two equally-weighted moves, one of which (tapping a card
 * for a quote the customer has never seen) can't happen yet. Sending is
 * the activation event, so while the doc has never left draft, Send owns
 * the whole footer. Once it's out the door the payment slot comes back:
 * that's when taking a deposit is a real next move.
 *
 * iOS keeps its existing gating — takePayment stays hidden there until
 * Tap to Pay clears App Review.
 */
import type { PlatformOSType } from 'react-native';

import type { Document } from '../../types/document';

interface FooterAction {
  label: string;
}

export interface PreviewFooterActions {
  /** Outlined in-person capture slot. Null when Send owns the footer. */
  payment: FooterAction | null;
  /** Contained Send. Null only when there is no doc to send yet. */
  send: FooterAction | null;
}

/** A doc that has never been delivered to anyone. */
function neverSent(doc: Document): boolean {
  return doc.stage === 'draft' && !doc.sentAt;
}

export function resolvePreviewFooterActions({
  doc,
  platform,
}: {
  doc: Document | null;
  platform: PlatformOSType;
}): PreviewFooterActions {
  if (!doc) return { payment: null, send: null };

  const send: FooterAction = {
    label: doc.type === 'invoice' ? 'Send Invoice' : 'Send Quote',
  };

  if (platform === 'ios' || neverSent(doc)) return { payment: null, send };

  return {
    payment: {
      label:
        doc.type === 'invoice'
          ? 'Take Payment'
          : (doc.depositAmount ?? 0) > 0
            ? 'Take Deposit'
            : 'Tap to Pay',
    },
    send,
  };
}
