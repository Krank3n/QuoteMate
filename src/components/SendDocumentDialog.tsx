/**
 * SendDocumentDialog — purely controlled version of the send-flow UI.
 *
 * Extracted from SendDocumentButton so non-button surfaces (e.g. the
 * StickyJobActionBar on ViewJob) can drive the exact same UX, plus the
 * email preview modal.
 *
 * Jul 2026 send audit — sending is the activation event, and the tap-to-send
 * path was where finished quotes died. Two shape changes came out of it:
 *   1. A doc we already have an email address for goes STRAIGHT to the email
 *      preview. The sheet (SMS / Share / Export PDF) stays one tap away
 *      behind "More ways to send", and is still the entry point when there's
 *      no address on file.
 *   2. Nothing about payments sits in the send flow any more. The pay-link
 *      opt-in that used to sit above Email abandoned sends; moved after the
 *      send it was tapped 8 times in its life and every tap bounced to
 *      settings. The Pay Now link now just arrives: the server attaches it
 *      to email sends, and the non-email channels fetch it below.
 *
 * Sep 2026 — onboarding stopped asking for an ABN and contact details up
 * front, so this dialog asks for them instead, once, before a channel is
 * chosen: see utils/sendBusinessDetails.ts for what counts as missing and why.
 *
 * SendDocumentButton itself wraps this dialog — nothing changes for callers.
 */

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Alert, Platform, Share } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';

import { Quote, Invoice, BusinessSettings } from '../types';
import { Document, SendMethod } from '../types/document';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';
import { formatCurrency, updateQuoteCalculations } from '../utils/quoteCalculator';
import { exportDocumentPDF } from '../utils/pdfGenerator';
import { markDocumentSent } from '../utils/applyStageChange';
import { maybePromptForPushPermission } from '../services/pushPermissionPrompt';
import { useStore } from '../store/useStore';
import {
  attachPayLink,
  carriesPayableAmount,
  ensureCanDeliver,
  type DeliveryDoc,
} from '../utils/quoteDeliveryGuard';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { AlertModal } from './AlertModal';
import { DocumentEmailPreviewModal } from './DocumentEmailPreviewModal';
import { SendGateModal } from './SendGateModal';
import {
  buildSendDetailsPrompt,
  missingBusinessDetailsForSend,
  readDismissedSendDetails,
  rememberDismissedSendDetails,
  shouldAskForSendDetails,
  type SendDetailsPrompt,
} from '../utils/sendBusinessDetails';
import { trackEvent } from '../services/analyticsService';
import {
  buildEmailBodySource,
  getWarmedEmailBody,
  whenEmailDraftWarm,
} from '../utils/emailDraft';
import { hasCustomerEmail, orderSendOptions, type SendChannel } from '../utils/sendFlow';
import { cleanSmsRecipient, openSmsComposer } from '../utils/smsComposer';
import { generateAcceptanceLink } from '../services/quoteAcceptanceService';
import { hashTerms } from '../../shared/pdf/terms/defaultAuTradie';
import { isRecoveredDocId } from '../../shared/document/recovered';

/**
 * The figures a send is going out on. `changed` is true when the settling
 * recalculation moved the total off what the screen had been showing — the
 * signal that any email body drafted earlier now names a stale figure.
 */
interface SettledFigures {
  quote: Quote;
  doc: Document;
  changed: boolean;
}

interface SendDocumentDialogProps {
  visible: boolean;
  onDismiss: () => void;
  doc: Document;
  businessSettings: BusinessSettings | null;
  /**
   * Fired after a non-email send (SMS / Share / Export PDF) actually moves the
   * doc out of draft into its sent stage. Hosts use this to surface a
   * "Marked as sent" Snackbar with Undo. Not called on failure, nor when
   * markDocumentSent no-ops because the doc had already left draft.
   */
  onMarkedSent?: (doc: Document, method: SendMethod) => void;
}

export function SendDocumentDialog({
  visible,
  onDismiss,
  doc,
  businessSettings,
  onMarkedSent,
}: SendDocumentDialogProps) {
  const navigation = useNavigation<any>();
  const isInvoice = doc.type === 'invoice';
  const quote: Quote = useMemo(() => documentToQuote(doc), [doc]);
  const invoice: Invoice = useMemo(() => documentToInvoice(doc), [doc]);

  // A quote is re-costed on its way to Firestore — saveQuote runs
  // updateQuoteCalculations, which derives labour from the sections when a
  // quote has them and from the top-level laborHours × laborRate when it
  // doesn't. The customer's acceptance link renders the SAVED quote, never
  // this screen's copy, so any figure composed from `quote.total` here can be
  // contradicted by the page the customer opens: a quote whose top-level
  // laborHours had fallen out of step with its sections went out as a
  // $6,389.02 SMS against a $7,819.02 quote page.
  //
  // So settle the figures through the same path the save runs BEFORE anything
  // customer-facing is composed, and quote from the settled record.
  const recalculatedQuote: Quote = useMemo(
    () => (isInvoice ? quote : updateQuoteCalculations(quote)),
    [isInvoice, quote],
  );
  // Two exemptions, for opposite reasons.
  //
  // Invoices: saveInvoice persists what it is given rather than re-costing it,
  // so an invoice's saved copy already matches this screen's — there is nothing
  // to settle.
  //
  // `recovered-` quotes: their stored total is the only real figure they carry
  // (the rest is placeholder lines that were never meant to add up to it), so
  // recomputing would move a historical record downwards in front of a
  // customer. See shared/document/recovered.ts.
  const totalMoved =
    !isInvoice
    && !isRecoveredDocId(doc.id)
    && Math.abs(recalculatedQuote.total - quote.total) >= 0.01;
  const [settled, setSettled] = useState<{ quote: Quote; doc: Document } | null>(null);
  // What every customer-facing surface in this dialog quotes from: the
  // screen's copy until the send flow settles the figures, the settled record
  // once it has.
  const activeQuote = settled?.quote ?? quote;
  const activeDoc = settled?.doc ?? doc;

  const { subscriptionStatus, saveDraft, saveQuote, saveInvoice, createInvoiceFromQuote, getEffectivePlan } = useStore();
  const isTrialActive = !!(
    subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired
  );
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [emailPreviewVisible, setEmailPreviewVisible] = useState(false);
  const [sendGateVisible, setSendGateVisible] = useState(false);
  const [emailBody, setEmailBody] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);
  // The non-email row being readied: its label shows progress while the
  // Pay Now link (and, for a quote SMS, the acceptance link) is fetched, so
  // a tap never looks ignored, and a second tap can't start it twice.
  const [preparing, setPreparing] = useState<'sms' | 'share' | 'export_pdf' | null>(null);
  // The business details this document still needs (ABN on an invoice, some
  // way for the customer to reply). Asked here, once, because this is the
  // moment they matter — onboarding no longer demands them up front.
  const [detailsPrompt, setDetailsPrompt] = useState<SendDetailsPrompt | null>(null);
  // Set by the preview modal on a successful send; stops us re-writing the
  // doc once it has left.
  const emailSentRef = useRef(false);
  // The doc whose body `emailBody` currently holds. Guards against reseeding
  // over the tradie's own edits when the preview is reopened in one session.
  const seededDocIdRef = useRef<string | null>(null);

  const docType = isInvoice ? 'invoice' : 'quote';

  /**
   * What the delivery guard sees. Takes the settled quote rather than
   * `activeQuote`: callers settle inside the same invocation, so the state
   * that would update it has not re-rendered this closure yet — and the
   * guard may mint a Square link for the quote's amount, so a stale figure
   * here bills the customer the wrong money.
   */
  const deliveryTarget = (settledQuote: Quote): DeliveryDoc =>
    isInvoice ? { kind: 'invoice', doc: invoice } : { kind: 'quote', doc: settledQuote };

  /** The doc as it leaves, carrying the Pay Now link fetched for it. */
  const withPayLink = (sendDoc: Document, url?: string): Document =>
    url ? { ...sendDoc, squarePaymentLinkUrl: url } : sendDoc;

  const defaultSubject = (() => {
    const businessName = businessSettings?.businessName || 'Your Business';
    const jobName = (isInvoice ? invoice.job.name : quote.job.name) || 'Job';
    return isInvoice
      ? `Invoice from ${businessName} - ${jobName}`
      : `Quotation from ${businessName} - ${jobName}`;
  })();

  type EmailHandler = {
    draftBody: string | undefined;
    draftSubject: string | undefined;
    generate: () => Promise<string>;
    fallback: () => string;
    persistBody: (body: string) => void;
    persistSubject: (subject: string) => void;
  };

  // generate/fallback come from the shared source so a body warmed on
  // JobPreview is exactly what this flow would have produced on tap.
  const bodySource = buildEmailBodySource(activeDoc, businessSettings);

  const emailHandler: EmailHandler = isInvoice
    ? {
        draftBody: invoice.draftEmailBody,
        draftSubject: invoice.draftEmailSubject,
        ...bodySource,
        persistBody: (body) => { saveInvoice({ ...invoice, draftEmailBody: body }); },
        persistSubject: (subject) => { saveInvoice({ ...invoice, draftEmailSubject: subject }); },
      }
    : {
        draftBody: activeQuote.draftEmailBody,
        draftSubject: activeQuote.draftEmailSubject,
        ...bodySource,
        persistBody: (body) => { saveDraft({ ...activeQuote, draftEmailBody: body }); },
        persistSubject: (subject) => { saveDraft({ ...activeQuote, draftEmailSubject: subject }); },
      };

  const closeAll = () => {
    setActionSheetVisible(false);
    setEmailPreviewVisible(false);
    onDismiss();
  };

  /**
   * Settle the figures every customer-facing surface here will quote from —
   * the SMS body, the share text, the email body and the exported PDF — so
   * none of them can name a total the saved quote (and therefore the
   * customer's acceptance link) disagrees with.
   *
   * A price never moves silently: when the recalculation lands somewhere
   * other than the number the tradie has been looking at, they confirm it
   * before anything goes out. Returns null when they back out.
   */
  const settleTotals = async (): Promise<SettledFigures | null> => {
    if (settled) return { ...settled, changed: true };
    if (!totalMoved) return { quote, doc, changed: false };

    trackEvent('send_total_recalculated', {
      doc_type: docType,
      shown_total: quote.total,
      settled_total: recalculatedQuote.total,
    });
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Total has changed',
        `This quote comes to ${formatCurrency(recalculatedQuote.total)}, not `
          + `${formatCurrency(quote.total)}. The figure on screen was out of date — `
          + 'have a look at the labour and sections before it goes to your customer.',
        [
          { text: 'Back to quote', style: 'cancel', onPress: () => resolve(false) },
          { text: `Send ${formatCurrency(recalculatedQuote.total)}`, onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    });
    if (!confirmed) {
      setActionSheetVisible(false);
      onDismiss();
      return null;
    }

    // Persist before composing so the saved quote — the one the acceptance
    // link renders — already holds the figure we are about to quote.
    await saveDraft(recalculatedQuote);
    // Carry the settled money across onto the Document rather than
    // re-projecting it, so nothing that only exists on the unified doc
    // (stage, payments, type) is lost on the way through.
    const settledDoc: Document = {
      ...doc,
      materials: recalculatedQuote.materials,
      sections: recalculatedQuote.sections,
      job: recalculatedQuote.job,
      materialsSubtotal: recalculatedQuote.materialsSubtotal,
      laborTotal: recalculatedQuote.laborTotal,
      subtotal: recalculatedQuote.subtotal,
      markupAmount: recalculatedQuote.markupAmount,
      gst: recalculatedQuote.gst,
      total: recalculatedQuote.total,
    };
    setSettled({ quote: recalculatedQuote, doc: settledDoc });
    return { quote: recalculatedQuote, doc: settledDoc, changed: true };
  };

  /**
   * Free-tier delivery gate. Resolves to the passed gate (which may carry a
   * link it minted) when the caller can proceed, null when it cannot. On
   * `connect_square` failure, opens the two-option SendGateModal so the
   * user has already-invested-time pushing them toward Square or Pro. On
   * `mint_link_failed`, falls back to a plain alert — that's a transient
   * Square API error, not an entitlement issue. Pro / trial users, and any
   * plain quote, pass without a network round-trip.
   */
  const runDeliveryGate = async (
    settledQuote: Quote,
  ): Promise<{ squarePaymentLinkUrl?: string } | null> => {
    const gate = await ensureCanDeliver(deliveryTarget(settledQuote));
    if (gate.ok) return gate;
    setActionSheetVisible(false);
    if (gate.reason === 'connect_square') {
      trackEvent('send_gate_shown', { doc_type: isInvoice ? 'invoice' : 'quote' });
      setSendGateVisible(true);
    } else {
      Alert.alert('Square link unavailable', gate.message, [
        { text: 'OK', onPress: onDismiss },
      ]);
    }
    return null;
  };

  /** The email path: the server attaches the Pay Now link on send. */
  const passesDeliveryGate = async (settledQuote: Quote): Promise<boolean> =>
    (await runDeliveryGate(settledQuote)) !== null;

  /**
   * The non-email paths compose the customer's copy on the phone, so the
   * link has to be in hand before anything is written. Best-effort: a send
   * goes ahead without one sooner than not at all. Null only when the gate
   * refused.
   */
  const payLinkForDelivery = async (settledQuote: Quote): Promise<{ url?: string } | null> => {
    const gate = await runDeliveryGate(settledQuote);
    if (!gate) return null;
    return { url: gate.squarePaymentLinkUrl ?? await attachPayLink(deliveryTarget(settledQuote)) };
  };

  const openPreviewWithBody = (body: string, prefilled: boolean, waitMs: number) => {
    setEmailBody(body);
    seededDocIdRef.current = doc.id;
    setEmailPreviewVisible(true);
    trackEvent('email_preview_opened', { doc_type: docType, prefilled, wait_ms: waitMs });
  };

  const handleEmailOption = async () => {
    const settledNow = await settleTotals();
    if (!settledNow) return;
    if (!(await passesDeliveryGate(settledNow.quote))) return;
    setActionSheetVisible(false);
    trackEvent('send_method_chosen', { method: 'email', doc_type: docType });

    // Every shortcut below reuses a body composed before the figures settled,
    // and a quote email names its total in the prose. Once the total has
    // moved, all of them are stale — the seeded copy, the persisted draft and
    // the warmed body alike — so none may be reused. Compose fresh against
    // the settled doc instead.
    const source = settledNow.changed
      ? buildEmailBodySource(settledNow.doc, businessSettings)
      : emailHandler;

    // Coming back from "More ways to send" — `emailBody` already holds this
    // session's copy, hand-edits and all. Reseeding from the (frozen) doc
    // prop here would silently throw those edits away and send the old text.
    if (!settledNow.changed && seededDocIdRef.current === doc.id) {
      setEmailPreviewVisible(true);
      trackEvent('email_preview_opened', { doc_type: docType, prefilled: true, wait_ms: 0 });
      return;
    }

    setEmailSubject(emailHandler.draftSubject || defaultSubject);

    // Body written on a previous open, or warmed on JobPreview: straight into
    // the preview, no wait at all.
    if (!settledNow.changed && emailHandler.draftBody) {
      openPreviewWithBody(emailHandler.draftBody, true, 0);
      return;
    }
    const warmed = settledNow.changed ? null : getWarmedEmailBody(doc);
    if (warmed) {
      openPreviewWithBody(warmed, true, 0);
      emailHandler.persistBody(warmed);
      return;
    }

    const startedAt = Date.now();
    setIsGeneratingEmail(true);
    setEmailPreviewVisible(true);
    try {
      // A warm-up already running for this doc is the common case when the
      // tradie sends straight off JobPreview — wait on it rather than paying
      // for a second generation of the same email.
      const warming = settledNow.changed ? null : whenEmailDraftWarm(doc);
      if (warming) await warming;
      const body = (settledNow.changed ? null : getWarmedEmailBody(doc))
        ?? (isPro ? await source.generate() : source.fallback());
      setEmailBody(body);
      seededDocIdRef.current = doc.id;
      emailHandler.persistBody(body);
    } catch {
      const fallback = source.fallback();
      setEmailBody(fallback);
      seededDocIdRef.current = doc.id;
      emailHandler.persistBody(fallback);
    } finally {
      setIsGeneratingEmail(false);
      // Logged once the body actually lands, so wait_ms is the wait the
      // tradie sat through rather than a scripted animation.
      trackEvent('email_preview_opened', {
        doc_type: docType,
        prefilled: false,
        wait_ms: Date.now() - startedAt,
      });
    }
  };

  /**
   * Start the send itself. A doc with an address on file skips the sheet
   * entirely (email is the dominant path); without one, the sheet is still
   * the right place to start.
   *
   * A free-plan doc with money on it keeps the sheet:
   * its delivery gate does a Square round-trip (and may mint a payment link)
   * before anything can go out, so routing straight through would leave the
   * tradie tapping Send and watching an unchanged screen. On the sheet, that
   * wait happens with the UI already up. A plain quote is never gated, so it
   * goes straight to the preview on every plan.
   */
  const openSendFlow = () => {
    const gated =
      getEffectivePlan() === 'free' && carriesPayableAmount(deliveryTarget(quote));
    if (!gated && hasCustomerEmail(doc)) void handleEmailOption();
    else setActionSheetVisible(true);
  };

  // Mirror external `visible` → the send flow.
  useEffect(() => {
    if (!visible) {
      setActionSheetVisible(false);
      setEmailPreviewVisible(false);
      setDetailsPrompt(null);
      // Drop the settled figures with the flow that settled them. The next
      // open re-derives them from whatever the doc looks like by then.
      setSettled(null);
      emailSentRef.current = false;
      seededDocIdRef.current = null;
      return;
    }
    trackEvent('send_sheet_opened', {
      doc_type: docType,
      has_customer_email: hasCustomerEmail(doc),
      plan: getEffectivePlan(),
    });

    // Before any channel is chosen, check the document carries what it has to
    // carry: an ABN if it's an invoice, and some way for the customer to
    // reply. Asked at most once per gap — reading that memory is the only
    // reason this is async, and a closed dialog mid-read must not reopen.
    let cancelled = false;
    const prompt = buildSendDetailsPrompt(
      missingBusinessDetailsForSend(businessSettings, docType),
      docType,
    );
    void (async () => {
      const dismissed = prompt ? await readDismissedSendDetails() : null;
      if (cancelled) return;
      if (prompt && shouldAskForSendDetails(prompt, dismissed)) {
        trackEvent('send_details_prompted', {
          doc_type: docType,
          missing: prompt.signature,
        });
        setDetailsPrompt(prompt);
        return;
      }
      openSendFlow();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleRegenerateEmail = async () => {
    setIsGeneratingEmail(true);
    try {
      const body = await emailHandler.generate();
      setEmailBody(body);
      emailHandler.persistBody(body);
    } catch {
      Alert.alert('Error', 'Could not regenerate email. Please try again.');
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleEmailPreviewDismiss = () => {
    setEmailPreviewVisible(false);
    // Only worth saving while the doc is still going out. After a send there
    // is nothing to preserve — the sent copy is already away — and this write
    // reconstructs the legacy quote from a doc snapshot stamped `draft`,
    // which merges straight back over the server's sent status.
    if (!emailSentRef.current) persistEmailEdits();
    onDismiss();
  };

  /** Swap the email preview for the full sheet (SMS / Share / Export PDF). */
  const handleMoreWaysToSend = () => {
    persistEmailEdits();
    setEmailPreviewVisible(false);
    setActionSheetVisible(true);
  };

  const persistEmailEdits = () => {
    // Persist body + subject together so a single write covers both edits
    // and they stay in sync on reopen.
    const trimmedSubject = emailSubject.trim();
    const subjectChanged = trimmedSubject !== (isInvoice ? invoice.draftEmailSubject : activeQuote.draftEmailSubject) && trimmedSubject !== '';
    if (isInvoice) {
      const bodyChanged = emailBody && emailBody !== (invoice.draftEmailBody || '');
      if (bodyChanged || subjectChanged) {
        saveInvoice({
          ...invoice,
          ...(bodyChanged ? { draftEmailBody: emailBody } : {}),
          ...(subjectChanged ? { draftEmailSubject: trimmedSubject } : {}),
        });
      }
    } else {
      const bodyChanged = emailBody && emailBody !== (activeQuote.draftEmailBody || '');
      if (bodyChanged || subjectChanged) {
        saveDraft({
          ...activeQuote,
          ...(bodyChanged ? { draftEmailBody: emailBody } : {}),
          ...(subjectChanged ? { draftEmailSubject: trimmedSubject } : {}),
        });
      }
    }
  };

  // Record a non-email delivery (SMS / Share / Export) against the doc so its
  // first-send audit is captured. Fully self-contained: a marking failure is
  // swallowed — it must never surface an error to the user mid-send.
  /**
   * `sendDoc` is passed in rather than read off `activeDoc`: the settle runs
   * inside the same handler invocation that later calls us, so the state it
   * set has not re-rendered this closure yet. The figures would still come out
   * right — saveQuote re-costs whatever it is handed — but only by accident,
   * and this write is the one that stamps the send.
   */
  const recordSend = async (method: SendMethod, sendDoc: Document) => {
    // Only a doc still in draft actually transitions here; anything already
    // sent/accepted no-ops inside markDocumentSent. Capture that up front so
    // we only notify the host on a real draft→sent move (and never on failure).
    const wasDraft = sendDoc.stage === 'draft';
    try {
      // Non-email sends do not pass through the email backend's snapshot
      // step. Preserve the exact terms in force when the document leaves so
      // later settings edits cannot rewrite what the customer accepted.
      const currentTerms = businessSettings?.termsAndConditions?.trim();
      const deliveredDoc = currentTerms && !sendDoc.termsSnapshot
        ? { ...sendDoc, termsSnapshot: currentTerms, termsVersionHash: hashTerms(currentTerms) }
        : sendDoc;
      await markDocumentSent(deliveredDoc, method, { saveQuote, saveInvoice, createInvoiceFromQuote });
    } catch {
      // Best-effort audit; ignore.
      return;
    }
    // No recipient on these channels, so they can never be a self-send.
    trackEvent('quote_send_succeeded', { doc_type: docType, method, to_self: false });
    // Offer push now that a real customer has the document. No-ops if the
    // tradie already granted or already declined once.
    void maybePromptForPushPermission().catch(() => {});
    if (wasDraft) onMarkedSent?.(sendDoc, method);
  };

  const handleSendSMS = async () => {
    if (preparing) return;
    const rawPhone = isInvoice ? (invoice.customerPhone || '') : (quote.customerPhone || '');
    const phone = cleanSmsRecipient(rawPhone);
    if (!phone) {
      Alert.alert('No phone on file', 'Add a phone number to the customer to send an SMS.');
      return;
    }
    const settledNow = await settleTotals();
    if (!settledNow) return;
    // Keep the sheet visible with progress copy while the links are fetched.
    setPreparing('sms');
    let delivery: { url?: string } | null;
    let quoteUrl: string | undefined;
    try {
      // On a quote the Pay Now link is the deposit link; the SMS carries the
      // acceptance page instead, whose Pay Deposit button serves the same
      // link, so only an invoice SMS puts the URL in the message itself.
      delivery = await payLinkForDelivery(settledNow.quote);
      if (!delivery) return;
      trackEvent('send_method_chosen', { method: 'sms', doc_type: docType });

      // A quote SMS must carry the quote itself, not merely announce a total.
      // Minting also snapshots the current terms server-side for the public
      // review page.
      if (!isInvoice) {
        try {
          quoteUrl = await generateAcceptanceLink(doc.id);
        } catch {
          Alert.alert(
            'Could not create quote link',
            'Check your connection and try again, or send the quote by email.',
          );
          return;
        }
      }
    } finally {
      setPreparing(null);
    }
    const sendDoc = withPayLink(settledNow.doc, delivery.url);

    setActionSheetVisible(false);
    const customerName = isInvoice ? invoice.customerName : settledNow.quote.customerName;
    const jobName = isInvoice ? invoice.job.name : settledNow.quote.job.name;
    const total = isInvoice ? invoice.total : settledNow.quote.total;
    const businessName = businessSettings?.businessName || 'us';
    const invoicePayLine = delivery.url
      ? `\n\nView and pay online:\n${delivery.url}`
      : '';
    // Deliberate line breaks make the composer easy to review and keep the
    // customer-facing text readable instead of one long encoded URI payload.
    const message = isInvoice
      ? `Hi ${customerName},\n\nYour invoice from ${businessName} for ${jobName} is ready.\n\nTotal: ${formatCurrency(total)}\nPayment due: ${format(new Date(invoice.dueDate), 'dd MMM yyyy')}${invoicePayLine}\n\nThank you!`
      : `Hi ${customerName},\n\nYour quote from ${businessName} for ${jobName} is ready.\n\nTotal: ${formatCurrency(total)}\n\nView and respond to your quote:\n${quoteUrl}\n\nPlease reply if you have any questions. Thank you!`;

    try {
      const result = await openSmsComposer(phone, message);
      if (result === 'cancelled') {
        setActionSheetVisible(true);
        return;
      }
      if (result === 'copied') {
        Alert.alert(
          'Message copied',
          `Phone: ${rawPhone}\n\nPaste the message into your SMS or messaging app, then confirm whether you sent it.`,
          [
            { text: 'Keep as draft', style: 'cancel', onPress: onDismiss },
            {
              text: 'Mark as sent',
              onPress: async () => {
                await recordSend('sms', sendDoc);
                onDismiss();
              },
            },
          ],
          { cancelable: false },
        );
        return;
      }
      if (result === 'unknown') {
        // Android does not tell apps whether the user pressed Send. Ask rather
        // than turning a cancelled composer into a false customer delivery.
        Alert.alert(
          'Was the SMS sent?',
          'Android cannot confirm whether the message was sent.',
          [
            { text: 'Not yet', style: 'cancel', onPress: () => setActionSheetVisible(true) },
            {
              text: 'Mark as sent',
              onPress: async () => {
                await recordSend('sms', sendDoc);
                onDismiss();
              },
            },
          ],
          { cancelable: false },
        );
        return;
      }
      await recordSend('sms', sendDoc);
      onDismiss();
    } catch {
      // Keep the send sheet available for a retry or another delivery method.
      setActionSheetVisible(true);
      Alert.alert('Could not open SMS', 'Check the customer phone number and try again.');
    }
  };

  const handleShareFromDialog = async () => {
    if (preparing) return;
    const settledNow = await settleTotals();
    if (!settledNow) return;
    setPreparing('share');
    let delivery: { url?: string } | null;
    try {
      delivery = await payLinkForDelivery(settledNow.quote);
    } finally {
      setPreparing(null);
    }
    if (!delivery) return;
    setActionSheetVisible(false);
    trackEvent('send_method_chosen', { method: 'share', doc_type: docType });
    try {
      // On a quote the link collects the deposit, and paying it accepts the
      // quote — the hosted page's "Accept & Pay Deposit" in one line.
      const payLine = delivery.url
        ? `\n${isInvoice ? 'Pay online' : 'Accept and pay deposit'}: ${delivery.url}`
        : '';
      const message = isInvoice
        ? `Invoice for ${invoice.customerName}\n${invoice.job.name}\nTotal: ${formatCurrency(invoice.total)}\nDue: ${format(new Date(invoice.dueDate), 'dd MMM yyyy')}${payLine}`
        : `Quote for ${settledNow.quote.customerName}\n${settledNow.quote.job.name}\nTotal: ${formatCurrency(settledNow.quote.total)}${payLine}`;
      const result = await Share.share({ message, title: isInvoice ? 'Share Invoice' : 'Share Quote' });
      if (result.action === Share.sharedAction) {
        await recordSend('share', withPayLink(settledNow.doc, delivery.url));
      }
    } catch {
      Alert.alert('Error', `Could not share ${isInvoice ? 'invoice' : 'quote'}`);
    }
    onDismiss();
  };

  const handleExportFromDialog = async () => {
    if (preparing) return;
    const settledNow = await settleTotals();
    if (!settledNow) return;
    setPreparing('export_pdf');
    let delivery: { url?: string } | null;
    try {
      delivery = await payLinkForDelivery(settledNow.quote);
    } finally {
      setPreparing(null);
    }
    if (!delivery) return;
    setActionSheetVisible(false);
    trackEvent('send_method_chosen', { method: 'export_pdf', doc_type: docType });
    try {
      // The PDF reads the Pay Now link off the doc it is handed.
      const exportDoc = withPayLink(settledNow.doc, delivery.url);
      await exportDocumentPDF(exportDoc, businessSettings, 'export', { isPro });
      await recordSend('export_pdf', exportDoc);
    } catch {
      Alert.alert('Error', 'Failed to export PDF. Please try again.');
    }
    onDismiss();
  };

  // Email leads unless there's no address to use — a phone-only customer
  // (CustomerDetails only ever required email OR phone) was being offered
  // Email at the top of the sheet with nothing behind it. Same four rows
  // either way; see orderSendOptions.
  //
  // canSms is deliberately stricter than "there's a phone number":
  //   - it needs an actual digit, so a stray "+" can't promote the row past
  //     handleSendSMS's own "No phone on file" bail-out;
  //   - and not on web, where openSmsComposer can only copy the message and
  //     say so through Alert.alert — a no-op in react-native-web, so the
  //     sheet would just vanish with nothing sent and nothing explained.
  const canSms =
    Platform.OS !== 'web' && /\d/.test(cleanSmsRecipient(doc.customerPhone || ''));
  const channelRows: Record<SendChannel, ActionSheetOption> = {
    email: { icon: 'email-outline', label: 'Email', onPress: handleEmailOption },
    sms: { icon: 'message-text', label: preparing === 'sms' ? 'Preparing SMS…' : 'SMS', onPress: handleSendSMS },
  };
  const sendOptions: ActionSheetOption[] = [
    ...orderSendOptions({ hasEmail: hasCustomerEmail(doc), canSms }).map(
      (channel) => channelRows[channel],
    ),
    { icon: 'share-variant', label: preparing === 'share' ? 'Preparing…' : 'Share', onPress: handleShareFromDialog },
    { icon: 'file-pdf-box', label: preparing === 'export_pdf' ? 'Preparing PDF…' : 'Export PDF', onPress: handleExportFromDialog },
  ];

  return (
    <>
      {/* Business details, asked at the one moment they matter: a document
          with the tradie's name on it is about to reach a customer. It never
          blocks the send — plenty of sole traders are mid-ABN-application —
          and "Send anyway" records the gap so it doesn't nag again. */}
      <AlertModal
        visible={detailsPrompt !== null}
        onDismiss={() => {
          setDetailsPrompt(null);
          onDismiss();
        }}
        type="info"
        icon="card-account-details-outline"
        title={detailsPrompt?.title || ''}
        message={detailsPrompt?.message || ''}
        primaryButtonText="Send anyway"
        primaryButtonAction={() => {
          const signature = detailsPrompt?.signature;
          trackEvent('send_details_resolved', { doc_type: docType, action: 'send_anyway' });
          if (signature) void rememberDismissedSendDetails(signature);
          setDetailsPrompt(null);
          openSendFlow();
        }}
        secondaryButtonText="Add details"
        secondaryButtonAction={() => {
          trackEvent('send_details_resolved', { doc_type: docType, action: 'add_details' });
          setDetailsPrompt(null);
          onDismiss();
          navigation.navigate('BusinessProfile' as never);
        }}
      />

      <ActionSheet
        visible={actionSheetVisible}
        onDismiss={closeAll}
        title={isInvoice ? 'Send Invoice' : 'Send Quote'}
        options={sendOptions}
        dismissOnSelect={false}
      />

      <DocumentEmailPreviewModal
        visible={emailPreviewVisible}
        onDismiss={handleEmailPreviewDismiss}
        doc={activeDoc}
        businessSettings={businessSettings}
        emailBody={emailBody}
        onEmailBodyChange={setEmailBody}
        subject={emailSubject}
        onSubjectChange={setEmailSubject}
        onRegenerate={handleRegenerateEmail}
        onMoreWaysToSend={handleMoreWaysToSend}
        onSent={() => { emailSentRef.current = true; }}
        isPro={isPro}
        isRegenerating={isGeneratingEmail}
      />

      <SendGateModal
        visible={sendGateVisible}
        onDismiss={() => {
          trackEvent('send_gate_abandoned', { doc_type: isInvoice ? 'invoice' : 'quote' });
          setSendGateVisible(false);
          onDismiss();
        }}
        onConnectSquare={() => {
          trackEvent('send_gate_resolved', { method: 'square_connected', doc_type: isInvoice ? 'invoice' : 'quote' });
          setSendGateVisible(false);
          onDismiss();
          navigation.navigate('SquareIntegration' as never);
        }}
        onUpgrade={() => {
          trackEvent('send_gate_resolved', { method: 'pro_upgrade', doc_type: isInvoice ? 'invoice' : 'quote' });
          setSendGateVisible(false);
          onDismiss();
          navigation.navigate('Paywall' as never, { source: 'send_gate' } as never);
        }}
      />
    </>
  );
}
