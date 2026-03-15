/**
 * Send Invoice Button Component
 * Reusable button with modal dialog for sending invoices via Email, SMS, Share, or Export PDF
 * Email option now uses Brevo-powered branded HTML emails with PDF attachment
 */

import React, { useState } from 'react';
import { StyleSheet, Alert, Share, Linking, Platform } from 'react-native';
import {
  Button,
} from 'react-native-paper';

import { Invoice, BusinessSettings } from '../types';
import { formatCurrency } from '../utils/quoteCalculator';
import { exportInvoicePDF } from '../utils/pdfGenerator';
import { useStore } from '../store/useStore';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { InvoiceEmailPreviewModal } from './InvoiceEmailPreviewModal';
import { generateInvoiceEmail, getDefaultInvoiceEmailBody } from '../services/llmService';
import { format } from 'date-fns';

interface SendInvoiceButtonProps {
  invoice: Invoice;
  businessSettings: BusinessSettings | null;
  buttonMode?: 'contained' | 'outlined' | 'text';
  buttonLabel?: string;
  buttonIcon?: string;
  buttonStyle?: any;
}

export function SendInvoiceButton({
  invoice,
  businessSettings,
  buttonMode = 'contained',
  buttonLabel = 'Send Invoice',
  buttonIcon = 'send',
  buttonStyle,
}: SendInvoiceButtonProps) {
  const { subscriptionStatus, quotes } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const sourceQuotePhotos = invoice.sourceQuoteId
    ? quotes.find(q => q.id === invoice.sourceQuoteId)?.photos || []
    : [];
  const isPro = subscriptionStatus?.isPro || isTrialActive;
  const [sendDialogVisible, setSendDialogVisible] = useState(false);
  const [emailPreviewVisible, setEmailPreviewVisible] = useState(false);
  const [emailBody, setEmailBody] = useState('');
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);

  const handleEmailOption = async () => {
    setSendDialogVisible(false);
    setIsGeneratingEmail(true);
    setEmailPreviewVisible(true);

    try {
      if (isPro) {
        const body = await generateInvoiceEmail({
          jobName: invoice.job.name,
          jobDescription: invoice.job.description || '',
          materials: invoice.materials.map(m => ({
            name: m.name,
            quantity: m.quantity,
            unit: m.unit,
          })),
          laborHours: invoice.laborHours,
          total: invoice.total,
          businessName: businessSettings?.businessName || '',
          customerName: invoice.customerName,
          dueDate: new Date(invoice.dueDate).toISOString(),
          invoiceNumber: invoice.invoiceNumber,
        });
        setEmailBody(body);
      } else {
        setEmailBody(getDefaultInvoiceEmailBody(
          invoice.customerName,
          invoice.job.name,
          invoice.total,
          businessSettings?.businessName || 'Your Business',
          new Date(invoice.dueDate).toISOString()
        ));
      }
    } catch (error) {
      console.error('Invoice email generation failed:', error);
      setEmailBody(getDefaultInvoiceEmailBody(
        invoice.customerName,
        invoice.job.name,
        invoice.total,
        businessSettings?.businessName || 'Your Business',
        new Date(invoice.dueDate).toISOString()
      ));
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleRegenerateEmail = async () => {
    setIsGeneratingEmail(true);
    try {
      const body = await generateInvoiceEmail({
        jobName: invoice.job.name,
        jobDescription: invoice.job.description || '',
        materials: invoice.materials.map(m => ({
          name: m.name,
          quantity: m.quantity,
          unit: m.unit,
        })),
        laborHours: invoice.laborHours,
        total: invoice.total,
        businessName: businessSettings?.businessName || '',
        customerName: invoice.customerName,
        dueDate: new Date(invoice.dueDate).toISOString(),
        invoiceNumber: invoice.invoiceNumber,
      });
      setEmailBody(body);
    } catch (error) {
      console.error('Invoice email regeneration failed:', error);
      Alert.alert('Error', 'Could not regenerate email. Please try again.');
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleSendSMS = async () => {
    setSendDialogVisible(false);

    const message = `Hi ${invoice.customerName}, your invoice from ${businessSettings?.businessName || 'us'} for ${invoice.job.name} is ready. Total: ${formatCurrency(invoice.total)}. Payment due: ${format(new Date(invoice.dueDate), 'dd MMM yyyy')}. Thank you!`;
    const phone = invoice.customerPhone || '';

    const url = Platform.OS === 'ios'
      ? `sms:${phone}&body=${encodeURIComponent(message)}`
      : `sms:${phone}?body=${encodeURIComponent(message)}`;

    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('Error', 'Could not open SMS');
    }
  };

  const handleShareFromDialog = async () => {
    setSendDialogVisible(false);

    try {
      const message = `Invoice for ${invoice.customerName}\n${invoice.job.name}\nTotal: ${formatCurrency(invoice.total)}\nDue: ${format(new Date(invoice.dueDate), 'dd MMM yyyy')}`;

      await Share.share({
        message,
        title: 'Share Invoice',
      });
    } catch (error) {
      Alert.alert('Error', 'Could not share invoice');
    }
  };

  const handleExportFromDialog = async () => {
    setSendDialogVisible(false);
    try {
      await exportInvoicePDF(invoice, businessSettings, 'export', { isPro });
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export PDF. Please try again.');
    }
  };

  const sendOptions: ActionSheetOption[] = [
    {
      icon: 'email-outline',
      label: 'Email',
      onPress: handleEmailOption,
    },
    {
      icon: 'message-text',
      label: 'SMS',
      onPress: handleSendSMS,
    },
    {
      icon: 'share-variant',
      label: 'Share',
      onPress: handleShareFromDialog,
    },
    {
      icon: 'file-pdf-box',
      label: 'Export PDF',
      onPress: handleExportFromDialog,
    },
  ];

  return (
    <>
      <Button
        mode={buttonMode}
        onPress={() => setSendDialogVisible(true)}
        style={buttonStyle}
        icon={buttonIcon}
        contentStyle={styles.buttonContent}
        labelStyle={styles.buttonLabel}
      >
        {buttonLabel}
      </Button>

      <ActionSheet
        visible={sendDialogVisible}
        onDismiss={() => setSendDialogVisible(false)}
        title="Send Invoice"
        options={sendOptions}
      />

      <InvoiceEmailPreviewModal
        visible={emailPreviewVisible}
        onDismiss={() => setEmailPreviewVisible(false)}
        invoice={invoice}
        businessSettings={businessSettings}
        emailBody={emailBody}
        onEmailBodyChange={setEmailBody}
        onRegenerate={handleRegenerateEmail}
        isPro={isPro}
        isRegenerating={isGeneratingEmail}
        photoCount={sourceQuotePhotos.length}
      />
    </>
  );
}

const styles = StyleSheet.create({
  buttonContent: {
    paddingVertical: 8,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
