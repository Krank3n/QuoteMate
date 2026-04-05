/**
 * Send Quote Button Component
 * Reusable button with modal dialog for sending quotes via Email, SMS, Share, or Export PDF
 * Email option now uses Brevo-powered branded HTML emails instead of native mail composer
 */

import React, { useState } from 'react';
import { StyleSheet, Alert, Share, Linking, Platform } from 'react-native';
import {
  Button,
} from 'react-native-paper';

import { Quote, BusinessSettings } from '../types';
import { formatCurrency } from '../utils/quoteCalculator';
import { exportQuotePDF } from '../utils/pdfGenerator';
import { useStore } from '../store/useStore';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { EmailPreviewModal } from './EmailPreviewModal';
import { generateQuoteEmail, getDefaultEmailBody } from '../services/llmService';

interface SendQuoteButtonProps {
  quote: Quote;
  businessSettings: BusinessSettings | null;
  buttonMode?: 'contained' | 'outlined' | 'text';
  buttonLabel?: string;
  buttonIcon?: string;
  buttonStyle?: any;
  onEmailDialogOpen?: (quote: Quote) => void;
}

export function SendQuoteButton({
  quote,
  businessSettings,
  buttonMode = 'contained',
  buttonLabel = 'Send',
  buttonIcon = 'send',
  buttonStyle,
  onEmailDialogOpen,
}: SendQuoteButtonProps) {
  const { subscriptionStatus } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
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
        // Generate AI email body
        const body = await generateQuoteEmail({
          jobName: quote.job.name,
          jobDescription: quote.job.description || '',
          materials: quote.materials.map(m => ({
            name: m.name,
            quantity: m.quantity,
            unit: m.unit,
          })),
          laborHours: quote.laborHours,
          total: quote.total,
          businessName: businessSettings?.businessName || '',
          customerName: quote.customerName,
        });
        setEmailBody(body);
      } else {
        // Free users get default template
        setEmailBody(getDefaultEmailBody(
          quote.customerName,
          quote.job.name,
          quote.total,
          businessSettings?.businessName || 'Your Business'
        ));
      }
    } catch (error) {
      // Fallback to default template
      setEmailBody(getDefaultEmailBody(
        quote.customerName,
        quote.job.name,
        quote.total,
        businessSettings?.businessName || 'Your Business'
      ));
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleRegenerateEmail = async () => {
    setIsGeneratingEmail(true);
    try {
      const body = await generateQuoteEmail({
        jobName: quote.job.name,
        jobDescription: quote.job.description || '',
        materials: quote.materials.map(m => ({
          name: m.name,
          quantity: m.quantity,
          unit: m.unit,
        })),
        laborHours: quote.laborHours,
        total: quote.total,
        businessName: businessSettings?.businessName || '',
        customerName: quote.customerName,
      });
      setEmailBody(body);
    } catch (error) {
      Alert.alert('Error', 'Could not regenerate email. Please try again.');
    } finally {
      setIsGeneratingEmail(false);
    }
  };

  const handleSendSMS = async () => {
    const message = `Hi ${quote.customerName}, your quote from ${businessSettings?.businessName || 'us'} for ${quote.job.name} is ready. Total: ${formatCurrency(quote.total)}. Thank you for your business!`;
    const phone = quote.customerPhone || '';

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
    try {
      const message = `Quote for ${quote.customerName}\n${quote.job.name}\nTotal: ${formatCurrency(quote.total)}`;

      await Share.share({
        message,
        title: 'Share Quote',
      });
    } catch (error) {
      Alert.alert('Error', 'Could not share quote');
    }
  };

  const handleExportFromDialog = async () => {
    try {
      await exportQuotePDF(quote, businessSettings, 'export', { isPro });
    } catch (error) {
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
        title="Send Quote"
        options={sendOptions}
      />

      <EmailPreviewModal
        visible={emailPreviewVisible}
        onDismiss={() => setEmailPreviewVisible(false)}
        quote={quote}
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
    paddingVertical: 8,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
