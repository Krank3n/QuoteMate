/**
 * SendDocumentButton Component
 * Unified send button replacing SendQuoteButton and SendInvoiceButton.
 * Branches on doc.type for type-specific email/SMS copy and which preview
 * modal opens. Same ActionSheet (Email / SMS / Share / Export PDF), same
 * visuals as the originals.
 */

import React, { useState } from 'react';
import { StyleSheet, Alert, Share, Linking, Platform } from 'react-native';
import { Button } from 'react-native-paper';
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

interface SendDocumentButtonProps {
  doc: Document;
  businessSettings: BusinessSettings | null;
  buttonMode?: 'contained' | 'outlined' | 'text';
  buttonLabel?: string;
  buttonIcon?: string;
  buttonStyle?: any;
}

export function SendDocumentButton({
  doc,
  businessSettings,
  buttonMode = 'contained',
  buttonLabel,
  buttonIcon = 'send',
  buttonStyle,
}: SendDocumentButtonProps) {
  const isInvoice = doc.type === 'invoice';
  const quote: Quote = documentToQuote(doc);
  const invoice: Invoice = documentToInvoice(doc);

  const resolvedLabel = buttonLabel ?? (isInvoice
    ? 'Send Invoice'
    : (quote.status === 'sent' ? 'Resend' : 'Send'));

  const { subscriptionStatus, saveDraft, saveInvoice } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [sendDialogVisible, setSendDialogVisible] = useState(false);
  const [emailPreviewVisible, setEmailPreviewVisible] = useState(false);
  const [emailBody, setEmailBody] = useState('');
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);

  const handleEmailQuote = async () => {
    setSendDialogVisible(false);
    if (quote.draftEmailBody) {
      setEmailBody(quote.draftEmailBody);
      setEmailPreviewVisible(true);
      return;
    }
    setIsGeneratingEmail(true);
    setEmailPreviewVisible(true);
    try {
      let body: string;
      if (isPro) {
        body = await generateQuoteEmail({
          jobName: quote.job.name,
          jobDescription: quote.job.description || '',
          materials: quote.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
          laborHours: quote.laborHours,
          total: quote.total,
          businessName: businessSettings?.businessName || '',
          customerName: quote.customerName,
        });
      } else {
        body = getDefaultEmailBody(
          quote.customerName,
          quote.job.name,
          quote.total,
          businessSettings?.businessName || 'Your Business',
        );
      }
      setEmailBody(body);
      saveDraft({ ...quote, draftEmailBody: body });
    } catch {
      const fallback = getDefaultEmailBody(
        quote.customerName,
        quote.job.name,
        quote.total,
        businessSettings?.businessName || 'Your Business',
      );
      setEmailBody(fallback);
      saveDraft({ ...quote, draftEmailBody: fallback });
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleEmailInvoice = async () => {
    setSendDialogVisible(false);
    if (invoice.draftEmailBody) {
      setEmailBody(invoice.draftEmailBody);
      setEmailPreviewVisible(true);
      return;
    }
    setIsGeneratingEmail(true);
    setEmailPreviewVisible(true);
    try {
      let body: string;
      if (isPro) {
        body = await generateInvoiceEmail({
          jobName: invoice.job.name,
          jobDescription: invoice.job.description || '',
          materials: invoice.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
          laborHours: invoice.laborHours,
          total: invoice.total,
          businessName: businessSettings?.businessName || '',
          customerName: invoice.customerName,
          dueDate: new Date(invoice.dueDate).toISOString(),
          invoiceNumber: invoice.invoiceNumber,
        });
      } else {
        body = getDefaultInvoiceEmailBody(
          invoice.customerName,
          invoice.job.name,
          invoice.total,
          businessSettings?.businessName || 'Your Business',
          new Date(invoice.dueDate).toISOString(),
        );
      }
      setEmailBody(body);
      saveInvoice({ ...invoice, draftEmailBody: body });
    } catch {
      const fallback = getDefaultInvoiceEmailBody(
        invoice.customerName,
        invoice.job.name,
        invoice.total,
        businessSettings?.businessName || 'Your Business',
        new Date(invoice.dueDate).toISOString(),
      );
      setEmailBody(fallback);
      saveInvoice({ ...invoice, draftEmailBody: fallback });
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleEmailOption = isInvoice ? handleEmailInvoice : handleEmailQuote;

  const handleRegenerateEmail = async () => {
    setIsGeneratingEmail(true);
    try {
      if (isInvoice) {
        const body = await generateInvoiceEmail({
          jobName: invoice.job.name,
          jobDescription: invoice.job.description || '',
          materials: invoice.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
          laborHours: invoice.laborHours,
          total: invoice.total,
          businessName: businessSettings?.businessName || '',
          customerName: invoice.customerName,
          dueDate: new Date(invoice.dueDate).toISOString(),
          invoiceNumber: invoice.invoiceNumber,
        });
        setEmailBody(body);
        saveInvoice({ ...invoice, draftEmailBody: body });
      } else {
        const body = await generateQuoteEmail({
          jobName: quote.job.name,
          jobDescription: quote.job.description || '',
          materials: quote.materials.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit })),
          laborHours: quote.laborHours,
          total: quote.total,
          businessName: businessSettings?.businessName || '',
          customerName: quote.customerName,
        });
        setEmailBody(body);
        saveDraft({ ...quote, draftEmailBody: body });
      }
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
  };

  const handleSendSMS = async () => {
    setSendDialogVisible(false);
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
  };

  const handleShareFromDialog = async () => {
    setSendDialogVisible(false);
    try {
      const message = isInvoice
        ? `Invoice for ${invoice.customerName}\n${invoice.job.name}\nTotal: ${formatCurrency(invoice.total)}\nDue: ${format(new Date(invoice.dueDate), 'dd MMM yyyy')}`
        : `Quote for ${quote.customerName}\n${quote.job.name}\nTotal: ${formatCurrency(quote.total)}`;
      await Share.share({ message, title: isInvoice ? 'Share Invoice' : 'Share Quote' });
    } catch {
      Alert.alert('Error', `Could not share ${isInvoice ? 'invoice' : 'quote'}`);
    }
  };

  const handleExportFromDialog = async () => {
    setSendDialogVisible(false);
    try {
      await exportDocumentPDF(doc, businessSettings, 'export', { isPro });
    } catch {
      Alert.alert('Error', 'Failed to export PDF. Please try again.');
    }
  };

  const sendOptions: ActionSheetOption[] = [
    { icon: 'email-outline', label: 'Email', onPress: handleEmailOption },
    { icon: 'message-text', label: 'SMS', onPress: handleSendSMS },
    { icon: 'share-variant', label: 'Share', onPress: handleShareFromDialog },
    { icon: 'file-pdf-box', label: 'Export PDF', onPress: handleExportFromDialog },
  ];

  // Send button uses the SendInvoiceButton's slightly different content padding
  // when we're sending an invoice — preserved from the original divergence.
  const buttonContentStyle = isInvoice ? styles.buttonContentInvoice : styles.buttonContent;

  return (
    <>
      <Button
        mode={buttonMode}
        onPress={() => setSendDialogVisible(true)}
        style={buttonStyle}
        icon={buttonIcon}
        contentStyle={buttonContentStyle}
        labelStyle={styles.buttonLabel}
      >
        {resolvedLabel}
      </Button>

      <ActionSheet
        visible={sendDialogVisible}
        onDismiss={() => setSendDialogVisible(false)}
        title={isInvoice ? 'Send Invoice' : 'Send Quote'}
        options={sendOptions}
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

const styles = StyleSheet.create({
  buttonContent: {
    height: 48,
  },
  buttonContentInvoice: {
    paddingVertical: 8,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
