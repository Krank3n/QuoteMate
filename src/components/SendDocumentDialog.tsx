/**
 * SendDocumentDialog — purely controlled version of the send-flow UI.
 *
 * Extracted from SendDocumentButton so non-button surfaces (e.g. the
 * StickyJobActionBar on ViewJob) can drive the exact same UX: Action
 * Sheet with Email / SMS / Share / Export PDF, plus the AI email
 * preview modal once they pick Email.
 *
 * SendDocumentButton itself now wraps this dialog — nothing changes
 * visually for existing callers.
 */

import React, { useMemo, useState, useEffect } from 'react';
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
import { ensureCanDeliver } from '../utils/quoteDeliveryGuard';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { DocumentEmailPreviewModal } from './DocumentEmailPreviewModal';
import { SendGateModal } from './SendGateModal';
import { trackEvent } from '../services/analyticsService';
import {
  generateQuoteEmail,
  getDefaultEmailBody,
  generateInvoiceEmail,
  getDefaultInvoiceEmailBody,
} from '../services/llmService';

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

  const { subscriptionStatus, saveDraft, saveQuote, saveInvoice, createInvoiceFromQuote } = useStore();
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

  const defaultSubject = (() => {
    const businessName = businessSettings?.businessName || 'Your Business';
    const jobName = (isInvoice ? invoice.job.name : quote.job.name) || 'Job';
    return isInvoice
      ? `Invoice from ${businessName} - ${jobName}`
      : `Quotation from ${businessName} - ${jobName}`;
  })();

  // Mirror external `visible` → internal ActionSheet open. Tapping a
  // row in the sheet (Email) may swap us over to the email preview,
  // which is why we keep two sub-states instead of trusting `visible`
  // alone.
  useEffect(() => {
    if (visible) setActionSheetVisible(true);
    else {
      setActionSheetVisible(false);
      setEmailPreviewVisible(false);
    }
  }, [visible]);

  type EmailHandler = {
    draftBody: string | undefined;
    draftSubject: string | undefined;
    generate: () => Promise<string>;
    fallback: () => string;
    persistBody: (body: string) => void;
    persistSubject: (subject: string) => void;
  };

  const emailHandler: EmailHandler = isInvoice
    ? {
        draftBody: invoice.draftEmailBody,
        draftSubject: invoice.draftEmailSubject,
        generate: () => generateInvoiceEmail({
          jobName: invoice.job.name,
          jobDescription: invoice.job.description || '',
          materials: invoice.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
          laborHours: invoice.laborHours,
          total: invoice.total,
          businessName: businessSettings?.businessName || '',
          customerName: invoice.customerName,
          dueDate: new Date(invoice.dueDate).toISOString(),
          invoiceNumber: invoice.invoiceNumber,
        }),
        fallback: () => getDefaultInvoiceEmailBody(
          invoice.customerName,
          invoice.job.name,
          invoice.total,
          businessSettings?.businessName || 'Your Business',
          new Date(invoice.dueDate).toISOString(),
        ),
        persistBody: (body) => { saveInvoice({ ...invoice, draftEmailBody: body }); },
        persistSubject: (subject) => { saveInvoice({ ...invoice, draftEmailSubject: subject }); },
      }
    : {
        draftBody: quote.draftEmailBody,
        draftSubject: quote.draftEmailSubject,
        generate: () => generateQuoteEmail({
          jobName: quote.job.name,
          jobDescription: quote.job.description || '',
          materials: quote.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
          laborHours: quote.laborHours,
          total: quote.total,
          businessName: businessSettings?.businessName || '',
          customerName: quote.customerName,
        }),
        fallback: () => getDefaultEmailBody(
          quote.customerName,
          quote.job.name,
          quote.total,
          businessSettings?.businessName || 'Your Business',
        ),
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
    setEmailSubject(emailHandler.draftSubject || defaultSubject);
    if (emailHandler.draftBody) {
      setEmailBody(emailHandler.draftBody);
      setEmailPreviewVisible(true);
      return;
    }
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
    }
  };

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
    onDismiss();
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
    if (wasDraft) onMarkedSent?.(doc, method);
  };

  const handleSendSMS = async () => {
    if (!(await passesDeliveryGate())) return;
    setActionSheetVisible(false);
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
    try {
      await exportDocumentPDF(doc, businessSettings, 'export', { isPro });
      await recordSend('export_pdf');
    } catch {
      Alert.alert('Error', 'Failed to export PDF. Please try again.');
    }
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
          navigation.navigate('Paywall' as never);
        }}
      />
    </>
  );
}
