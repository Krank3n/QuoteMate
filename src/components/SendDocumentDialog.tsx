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
 *   2. The Path B pay-link opt-in no longer sits above Email in the sheet —
 *      tapping it without Square connected abandoned the send entirely. It
 *      now asks AFTER the doc is out the door, aimed at the next one.
 *
 * SendDocumentButton itself wraps this dialog — nothing changes for callers.
 */

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Alert, Share } from 'react-native';
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
  ensureCanDeliver,
  attachTrialPayLink,
  shouldOfferTrialPayLink,
} from '../utils/quoteDeliveryGuard';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { AlertModal } from './AlertModal';
import { DocumentEmailPreviewModal } from './DocumentEmailPreviewModal';
import { SendGateModal } from './SendGateModal';
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
  const [payLinkAttached, setPayLinkAttached] = useState(false);
  const [isAttachingPayLink, setIsAttachingPayLink] = useState(false);
  const [payLinkOfferVisible, setPayLinkOfferVisible] = useState(false);
  const [isPreparingSms, setIsPreparingSms] = useState(false);
  // Set by the preview modal on a successful send; gates the post-send
  // pay-link ask so we only pitch payments to someone who just delivered,
  // and stops us re-writing the doc once it has left.
  const emailSentRef = useRef(false);
  // The doc whose body `emailBody` currently holds. Guards against reseeding
  // over the tradie's own edits when the preview is reopened in one session.
  const seededDocIdRef = useRef<string | null>(null);

  const docType = isInvoice ? 'invoice' : 'quote';

  // Path B opt-in: offer trial users a Pay Now link once this doc has gone
  // out, so the next one can carry a card button. Free users are gated
  // instead; Pro/linked docs need nothing.
  const offerPayLink =
    shouldOfferTrialPayLink(getEffectivePlan(), doc) && !payLinkAttached;

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
   * Free-tier delivery gate. Returns true when the caller can proceed.
   * On `connect_square` failure, opens the two-option SendGateModal so the
   * user has already-invested-time pushing them toward Square or Pro. On
   * `mint_link_failed`, falls back to a plain alert — that's a transient
   * Square API error, not an entitlement issue. Pro / trial users always
   * pass without a network round-trip.
   */
  const passesDeliveryGate = async (settledQuote: Quote): Promise<boolean> => {
    // Takes the settled quote rather than reading `activeQuote`: callers settle
    // inside the same invocation, so the state that would update it has not
    // re-rendered this closure yet. On the free tier this gate mints a Square
    // payment link for the quote's amount, so a stale figure here bills the
    // customer the wrong money.
    const gate = await ensureCanDeliver(
      isInvoice ? { kind: 'invoice', doc: invoice } : { kind: 'quote', doc: settledQuote }
    );
    if (gate.ok) return true;
    setActionSheetVisible(false);
    if (gate.reason === 'connect_square') {
      trackEvent('send_gate_shown', { doc_type: isInvoice ? 'invoice' : 'quote' });
      setSendGateVisible(true);
    } else {
      Alert.alert('Square link unavailable', gate.message, [
        { text: 'OK', onPress: onDismiss },
      ]);
    }
    return false;
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

  // Mirror external `visible` → the send flow. A doc with an address on file
  // skips the sheet entirely (email is the dominant path); without one, the
  // sheet is still the right place to start.
  useEffect(() => {
    if (!visible) {
      setActionSheetVisible(false);
      setEmailPreviewVisible(false);
      setPayLinkOfferVisible(false);
      // Drop the settled figures with the flow that settled them. The next
      // open re-derives them from whatever the doc looks like by then.
      setSettled(null);
      emailSentRef.current = false;
      seededDocIdRef.current = null;
      return;
    }
    const plan = getEffectivePlan();
    trackEvent('send_sheet_opened', {
      doc_type: docType,
      has_customer_email: hasCustomerEmail(doc),
      plan,
    });
    // Free plan keeps the sheet: its delivery gate does a Square round-trip
    // (and may mint a payment link) before anything can go out, so routing
    // straight through would leave the tradie tapping Send and watching an
    // unchanged screen. On the sheet, that wait happens with the UI already up.
    if (plan !== 'free' && hasCustomerEmail(doc)) void handleEmailOption();
    else setActionSheetVisible(true);
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
    // Ask about payments only once the doc is actually out the door — the
    // ask used to sit in front of the send and cost us the send itself.
    if (emailSentRef.current && offerPayLink) {
      trackEvent('pay_link_optin_shown', { doc_type: docType });
      setPayLinkOfferVisible(true);
      return;
    }
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
    if (isPreparingSms) return;
    const rawPhone = isInvoice ? (invoice.customerPhone || '') : (quote.customerPhone || '');
    const phone = cleanSmsRecipient(rawPhone);
    if (!phone) {
      Alert.alert('No phone on file', 'Add a phone number to the customer to send an SMS.');
      return;
    }
    const settledNow = await settleTotals();
    if (!settledNow) return;
    if (!(await passesDeliveryGate(settledNow.quote))) return;
    trackEvent('send_method_chosen', { method: 'sms', doc_type: docType });

    // A quote SMS must carry the quote itself, not merely announce a total.
    // Minting also snapshots the current terms server-side for the public
    // review page. Keep the sheet visible with progress copy while it runs.
    let quoteUrl: string | undefined;
    if (!isInvoice) {
      setIsPreparingSms(true);
      try {
        quoteUrl = await generateAcceptanceLink(doc.id);
      } catch {
        Alert.alert(
          'Could not create quote link',
          'Check your connection and try again, or send the quote by email.',
        );
        return;
      } finally {
        setIsPreparingSms(false);
      }
    }

    setActionSheetVisible(false);
    const customerName = isInvoice ? invoice.customerName : settledNow.quote.customerName;
    const jobName = isInvoice ? invoice.job.name : settledNow.quote.job.name;
    const total = isInvoice ? invoice.total : settledNow.quote.total;
    const businessName = businessSettings?.businessName || 'us';
    const invoicePayLine = invoice.squarePaymentLinkUrl
      ? `\n\nView and pay online:\n${invoice.squarePaymentLinkUrl}`
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
                await recordSend('sms', settledNow.doc);
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
                await recordSend('sms', settledNow.doc);
                onDismiss();
              },
            },
          ],
          { cancelable: false },
        );
        return;
      }
      await recordSend('sms', settledNow.doc);
      onDismiss();
    } catch {
      // Keep the send sheet available for a retry or another delivery method.
      setActionSheetVisible(true);
      Alert.alert('Could not open SMS', 'Check the customer phone number and try again.');
    }
  };

  const handleShareFromDialog = async () => {
    const settledNow = await settleTotals();
    if (!settledNow) return;
    if (!(await passesDeliveryGate(settledNow.quote))) return;
    setActionSheetVisible(false);
    trackEvent('send_method_chosen', { method: 'share', doc_type: docType });
    try {
      const message = isInvoice
        ? `Invoice for ${invoice.customerName}\n${invoice.job.name}\nTotal: ${formatCurrency(invoice.total)}\nDue: ${format(new Date(invoice.dueDate), 'dd MMM yyyy')}`
        : `Quote for ${settledNow.quote.customerName}\n${settledNow.quote.job.name}\nTotal: ${formatCurrency(settledNow.quote.total)}`;
      const result = await Share.share({ message, title: isInvoice ? 'Share Invoice' : 'Share Quote' });
      if (result.action === Share.sharedAction) {
        await recordSend('share', settledNow.doc);
      }
    } catch {
      Alert.alert('Error', `Could not share ${isInvoice ? 'invoice' : 'quote'}`);
    }
    onDismiss();
  };

  const handleExportFromDialog = async () => {
    const settledNow = await settleTotals();
    if (!settledNow) return;
    if (!(await passesDeliveryGate(settledNow.quote))) return;
    setActionSheetVisible(false);
    trackEvent('send_method_chosen', { method: 'export_pdf', doc_type: docType });
    try {
      await exportDocumentPDF(settledNow.doc, businessSettings, 'export', { isPro });
      await recordSend('export_pdf', settledNow.doc);
    } catch {
      Alert.alert('Error', 'Failed to export PDF. Please try again.');
    }
    onDismiss();
  };

  /**
   * Trial opt-in, taken AFTER the doc has gone out: wire up Square so the
   * next one can carry a Pay Now button. Not connected yet → route to
   * SquareIntegrationScreen (square_connected fires there on OAuth success);
   * already connected → the link lands on this doc too, so the customer can
   * still pay from its online page.
   */
  const handleAddPayLink = async () => {
    if (isAttachingPayLink) return;
    setIsAttachingPayLink(true);
    try {
      // Settled, not the screen's copy: this mints a Square link for a real
      // amount — the deposit, or the full quote total — so a stale figure here
      // puts a Pay Now button on the customer's page for the wrong money.
      const result = await attachTrialPayLink(
        isInvoice ? { kind: 'invoice', doc: invoice } : { kind: 'quote', doc: activeQuote }
      );
      trackEvent('pay_link_optin_tapped', {
        doc_type: docType,
        outcome: result.status,
      });
      setPayLinkOfferVisible(false);
      if (result.status === 'connect_required') {
        onDismiss();
        navigation.navigate('SquareIntegration' as never);
      } else if (result.status === 'attached') {
        setPayLinkAttached(true);
        Alert.alert(
          'Pay Now button added',
          `Your customer can pay this ${isInvoice ? 'invoice' : 'quote'} by card from its online page.`,
          [{ text: 'OK', onPress: onDismiss }],
        );
      } else {
        Alert.alert("Couldn't add the pay link", result.message, [{ text: 'OK', onPress: onDismiss }]);
      }
    } finally {
      setIsAttachingPayLink(false);
    }
  };

  const dismissPayLinkOffer = () => {
    setPayLinkOfferVisible(false);
    onDismiss();
  };

  // Email leads unless there's no address to use — a phone-only customer
  // (CustomerDetails only ever required email OR phone) was being offered
  // Email at the top of the sheet with nothing behind it. Same four rows
  // either way; see orderSendOptions.
  const channelRows: Record<SendChannel, ActionSheetOption> = {
    email: { icon: 'email-outline', label: 'Email', onPress: handleEmailOption },
    sms: { icon: 'message-text', label: isPreparingSms ? 'Preparing SMS…' : 'SMS', onPress: handleSendSMS },
  };
  const sendOptions: ActionSheetOption[] = [
    ...orderSendOptions({
      hasEmail: hasCustomerEmail(doc),
      hasPhone: !!cleanSmsRecipient(doc.customerPhone || ''),
    }).map((channel) => channelRows[channel]),
    { icon: 'share-variant', label: 'Share', onPress: handleShareFromDialog },
    { icon: 'file-pdf-box', label: 'Export PDF', onPress: handleExportFromDialog },
  ];

  return (
    <>
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

      {/* Post-send Path B ask. Deliberately after delivery: in front of it,
          this row cost sends outright when Square wasn't connected. */}
      <AlertModal
        visible={payLinkOfferVisible}
        onDismiss={dismissPayLinkOffer}
        type="info"
        icon="credit-card-fast-outline"
        title="Want a Pay Now button?"
        message={`Connect Square and your ${isInvoice ? 'invoices' : 'quotes'} go out with a Pay Now button — your customer can pay by card the moment it lands.`}
        primaryButtonText="Set it up"
        primaryButtonAction={handleAddPayLink}
        primaryButtonLoading={isAttachingPayLink}
        secondaryButtonText="Not now"
        secondaryButtonAction={dismissPayLinkOffer}
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
