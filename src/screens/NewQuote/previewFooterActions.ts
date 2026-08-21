/**
 * What the end-of-wizard footer offers.
 *
 * JobPreview's footer used to split 50/50 between an outlined "Take
 * Payment / Take Deposit / Tap to Pay" and a contained Send on every
 * platform but iOS — so the last screen of quote #1 answered "you're
 * finished" with two equally-weighted moves, one of which (tapping a card
 * for a quote the customer has never seen) can't happen yet. Sending is
 * the activation event, so while a QUOTE has never left draft, Send owns
 * the whole footer. Once it's out the door the payment slot comes back:
 * that's when taking a deposit is a real next move. Invoices keep the pair
 * throughout — see isUnsentQuote.
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

/**
 * A QUOTE that has never been delivered to anyone.
 *
 * Quotes only: an invoice is raised for work that's already done, so tapping
 * the customer's card at the door is a real move the moment it exists — and
 * convertDocumentToInvoice leaves the new invoice on stage 'draft', so
 * treating "draft" as "nobody's seen this" would strip in-person capture off
 * the very screen built for it.
 */
function isUnsentQuote(doc: Document): boolean {
  return doc.type === 'quote' && doc.stage === 'draft' && !doc.sentAt;
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

  if (platform === 'ios' || isUnsentQuote(doc)) return { payment: null, send };

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
