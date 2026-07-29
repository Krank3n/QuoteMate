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
import { Alert, Share, Linking, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';

import { Quote, Invoice, BusinessSettings } from '../types';
import { Document, SendMethod } from '../types/document';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';
import { formatCurrency } from '../utils/quoteCalculator';
import { exportDocumentPDF } from '../utils/pdfGenerator';
import { markDocumentSent } from '../utils/applyStageChange';
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
import { buildEmailBodySource } from '../utils/emailDraft';
import { hasCustomerEmail } from '../utils/sendFlow';

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
  // Set by the preview modal on a successful send; gates the post-send
  // pay-link ask so we only pitch payments to someone who just delivered.
  const emailSentRef = useRef(false);

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
  const bodySource = buildEmailBodySource(doc, businessSettings);

  const emailHandler: EmailHandler = isInvoice
    ? {
        draftBody: invoice.draftEmailBody,
        draftSubject: invoice.draftEmailSubject,
        ...bodySource,
        persistBody: (body) => { saveInvoice({ ...invoice, draftEmailBody: body }); },
        persistSubject: (subject) => { saveInvoice({ ...invoice, draftEmailSubject: subject }); },
      }
    : {
        draftBody: quote.draftEmailBody,
        draftSubject: quote.draftEmailSubject,
        ...bodySource,
        persistBody: (body) => { saveDraft({ ...quote, draftEmailBody: body }); },
        persistSubject: (subject) => { saveDraft({ ...quote, draftEmailSubject: subject }); },
      };

  const closeAll = () => {
    setActionSheetVisible(false);
    setEmailPreviewVisible(false);
    onDismiss();
  };

  /**
   * Free-tier delivery gate. Returns true when the caller can proceed.
   * On `connect_square` failure, opens the two-option SendGateModal so the
   * user has already-invested-time pushing them toward Square or Pro. On
   * `mint_link_failed`, falls back to a plain alert — that's a transient
   * Square API error, not an entitlement issue. Pro / trial users always
   * pass without a network round-trip.
   */
  const passesDeliveryGate = async (): Promise<boolean> => {
    const gate = await ensureCanDeliver(
      isInvoice ? { kind: 'invoice', doc: invoice } : { kind: 'quote', doc: quote }
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

  const handleEmailOption = async () => {
    if (!(await passesDeliveryGate())) return;
    setActionSheetVisible(false);
    trackEvent('send_method_chosen', { method: 'email', doc_type: docType });
    setEmailSubject(emailHandler.draftSubject || defaultSubject);
    // Warm body (pre-generated on JobPreview, or written on a previous open):
    // straight into the preview, no wait at all.
    if (emailHandler.draftBody) {
      setEmailBody(emailHandler.draftBody);
      setEmailPreviewVisible(true);
      trackEvent('email_preview_opened', { doc_type: docType, prefilled: true, wait_ms: 0 });
      return;
    }
    const startedAt = Date.now();
    setIsGeneratingEmail(true);
    setEmailPreviewVisible(true);
    try {
      const body = isPro ? await emailHandler.generate() : emailHandler.fallback();
      setEmailBody(body);
      emailHandler.persistBody(body);
    } catch {
      const fallback = emailHandler.fallback();
      setEmailBody(fallback);
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
      emailSentRef.current = false;
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
    persistEmailEdits();
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
    const subjectChanged = trimmedSubject !== (isInvoice ? invoice.draftEmailSubject : quote.draftEmailSubject) && trimmedSubject !== '';
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
      const bodyChanged = emailBody && emailBody !== (quote.draftEmailBody || '');
      if (bodyChanged || subjectChanged) {
        saveDraft({
          ...quote,
          ...(bodyChanged ? { draftEmailBody: emailBody } : {}),
          ...(subjectChanged ? { draftEmailSubject: trimmedSubject } : {}),
        });
      }
    }
  };

  // Record a non-email delivery (SMS / Share / Export) against the doc so its
  // first-send audit is captured. Fully self-contained: a marking failure is
  // swallowed — it must never surface an error to the user mid-send.
  const recordSend = async (method: SendMethod) => {
    // Only a doc still in draft actually transitions here; anything already
    // sent/accepted no-ops inside markDocumentSent. Capture that up front so
    // we only notify the host on a real draft→sent move (and never on failure).
    const wasDraft = doc.stage === 'draft';
    try {
      await markDocumentSent(doc, method, { saveQuote, saveInvoice, createInvoiceFromQuote });
    } catch {
      // Best-effort audit; ignore.
      return;
    }
    // No recipient on these channels, so they can never be a self-send.
    trackEvent('quote_send_succeeded', { doc_type: docType, method, to_self: false });
    if (wasDraft) onMarkedSent?.(doc, method);
  };

  const handleSendSMS = async () => {
    if (!(await passesDeliveryGate())) return;
    setActionSheetVisible(false);
    trackEvent('send_method_chosen', { method: 'sms', doc_type: docType });
    const message = isInvoice
      ? `Hi ${invoice.customerName}, your invoice from ${businessSettings?.businessName || 'us'} for ${invoice.job.name} is ready. Total: ${formatCurrency(invoice.total)}. Payment due: ${format(new Date(invoice.dueDate), 'dd MMM yyyy')}. Thank you!`
      : `Hi ${quote.customerName}, your quote from ${businessSettings?.businessName || 'us'} for ${quote.job.name} is ready. Total: ${formatCurrency(quote.total)}. Thank you for your business!`;
    const phone = isInvoice ? (invoice.customerPhone || '') : (quote.customerPhone || '');
    const url = Platform.OS === 'ios'
      ? `sms:${phone}&body=${encodeURIComponent(message)}`
      : `sms:${phone}?body=${encodeURIComponent(message)}`;
    try {
      await Linking.openURL(url);
      await recordSend('sms');
    } catch {
      Alert.alert('Error', 'Could not open SMS');
    }
    onDismiss();
  };

  const handleShareFromDialog = async () => {
    if (!(await passesDeliveryGate())) return;
    setActionSheetVisible(false);
    trackEvent('send_method_chosen', { method: 'share', doc_type: docType });
    try {
      const message = isInvoice
        ? `Invoice for ${invoice.customerName}\n${invoice.job.name}\nTotal: ${formatCurrency(invoice.total)}\nDue: ${format(new Date(invoice.dueDate), 'dd MMM yyyy')}`
        : `Quote for ${quote.customerName}\n${quote.job.name}\nTotal: ${formatCurrency(quote.total)}`;
      const result = await Share.share({ message, title: isInvoice ? 'Share Invoice' : 'Share Quote' });
      if (result.action === Share.sharedAction) {
        await recordSend('share');
      }
    } catch {
      Alert.alert('Error', `Could not share ${isInvoice ? 'invoice' : 'quote'}`);
    }
    onDismiss();
  };

  const handleExportFromDialog = async () => {
    if (!(await passesDeliveryGate())) return;
    setActionSheetVisible(false);
    trackEvent('send_method_chosen', { method: 'export_pdf', doc_type: docType });
    try {
      await exportDocumentPDF(doc, businessSettings, 'export', { isPro });
      await recordSend('export_pdf');
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
      const result = await attachTrialPayLink(
        isInvoice ? { kind: 'invoice', doc: invoice } : { kind: 'quote', doc: quote }
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

  const sendOptions: ActionSheetOption[] = [
    { icon: 'email-outline', label: 'Email', onPress: handleEmailOption },
    { icon: 'message-text', label: 'SMS', onPress: handleSendSMS },
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
        doc={doc}
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
