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
import { format } from 'date-fns';

import { Quote, Invoice, BusinessSettings } from '../types';
import { Document } from '../types/document';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';
import { formatCurrency } from '../utils/quoteCalculator';
import { exportDocumentPDF } from '../utils/pdfGenerator';
import { useStore } from '../store/useStore';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { DocumentEmailPreviewModal } from './DocumentEmailPreviewModal';
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
}

export function SendDocumentDialog({
  visible,
  onDismiss,
  doc,
  businessSettings,
}: SendDocumentDialogProps) {
  const isInvoice = doc.type === 'invoice';
  const quote: Quote = useMemo(() => documentToQuote(doc), [doc]);
  const invoice: Invoice = useMemo(() => documentToInvoice(doc), [doc]);

  const { subscriptionStatus, saveDraft, saveInvoice } = useStore();
  const isTrialActive = !!(
    subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired
  );
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [emailPreviewVisible, setEmailPreviewVisible] = useState(false);
  const [emailBody, setEmailBody] = useState('');
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);

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
    generate: () => Promise<string>;
    fallback: () => string;
    persistBody: (body: string) => void;
  };

  const emailHandler: EmailHandler = isInvoice
    ? {
        draftBody: invoice.draftEmailBody,
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
      }
    : {
        draftBody: quote.draftEmailBody,
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
      };

  const closeAll = () => {
    setActionSheetVisible(false);
    setEmailPreviewVisible(false);
    onDismiss();
  };

  const handleEmailOption = async () => {
    setActionSheetVisible(false);
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
    if (isInvoice) {
      if (emailBody && emailBody !== (invoice.draftEmailBody || '')) {
        saveInvoice({ ...invoice, draftEmailBody: emailBody });
      }
    } else {
      if (emailBody && emailBody !== (quote.draftEmailBody || '')) {
        saveDraft({ ...quote, draftEmailBody: emailBody });
      }
    }
    onDismiss();
  };

  const handleSendSMS = async () => {
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
    } catch {
      Alert.alert('Error', 'Could not open SMS');
    }
    onDismiss();
  };

  const handleShareFromDialog = async () => {
    setActionSheetVisible(false);
    try {
      const message = isInvoice
        ? `Invoice for ${invoice.customerName}\n${invoice.job.name}\nTotal: ${formatCurrency(invoice.total)}\nDue: ${format(new Date(invoice.dueDate), 'dd MMM yyyy')}`
        : `Quote for ${quote.customerName}\n${quote.job.name}\nTotal: ${formatCurrency(quote.total)}`;
      await Share.share({ message, title: isInvoice ? 'Share Invoice' : 'Share Quote' });
    } catch {
      Alert.alert('Error', `Could not share ${isInvoice ? 'invoice' : 'quote'}`);
    }
    onDismiss();
  };

  const handleExportFromDialog = async () => {
    setActionSheetVisible(false);
    try {
      await exportDocumentPDF(doc, businessSettings, 'export', { isPro });
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
        onRegenerate={handleRegenerateEmail}
        isPro={isPro}
        isRegenerating={isGeneratingEmail}
      />
    </>
  );
}
