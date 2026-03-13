/**
 * Send Quote Button Component
 * Reusable button with modal dialog for sending quotes via Email, SMS, Share, or Export PDF
 */

import React, { useState } from 'react';
import { StyleSheet, Alert, Share, Linking, Platform } from 'react-native';
import {
  Button,
} from 'react-native-paper';
import * as Print from 'expo-print';
import * as MailComposer from 'expo-mail-composer';

import { Quote, BusinessSettings } from '../types';
import { formatCurrency } from '../utils/quoteCalculator';
import { generateQuotePDF, exportQuotePDF, generatePdfFilename } from '../utils/pdfGenerator';
import { generateAcceptanceLink } from '../services/quoteAcceptanceService';
import { auth } from '../config/firebase';
import { useStore } from '../store/useStore';
import { ActionSheet, ActionSheetOption } from './ActionSheet';

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

  const handleSendQuote = async () => {
    try {
      // Generate acceptance link for the quote (Pro only)
      let acceptanceUrl = '';
      if (isPro) {
        const userId = auth.currentUser?.uid;
        if (userId) {
          try {
            acceptanceUrl = await generateAcceptanceLink(quote.id, userId);
            console.log('Generated acceptance link:', acceptanceUrl);
          } catch (linkError) {
            console.error('Failed to generate acceptance link:', linkError);
          }
        }
      }

      // Build email body with optional acceptance link
      const buildEmailBody = () => {
        let body = `Hi ${quote.customerName},\n\nPlease find attached your quotation for ${quote.job.name}.\n\nTotal: ${formatCurrency(quote.total)}\n\nThis quote is valid for 30 days from the date of issue.`;

        if (acceptanceUrl) {
          body += `\n\n--- RESPOND TO THIS QUOTE ---\n\nYou can accept or decline this quote directly by clicking the link below:\n\n${acceptanceUrl}\n\n(This link expires in 30 days)`;
        }

        body += `\n\nIf you have any questions, please don't hesitate to contact us.\n\nBest regards,\n${businessSettings?.businessName || 'Your Business'}`;

        return body;
      };

      if (Platform.OS === 'web') {
        // Generate PDF HTML
        const html = await generateQuotePDF(quote, businessSettings, { isPro });
        const filename = generatePdfFilename('Quote', quote.customerName, quote.job.name, new Date(quote.updatedAt));

        // Create a hidden iframe to print the PDF
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        const iframeDoc = iframe.contentWindow?.document;
        if (iframeDoc) {
          iframeDoc.open();
          iframeDoc.write(html);
          iframeDoc.close();

          // Wait for content to load then trigger print dialog
          iframe.onload = () => {
            setTimeout(() => {
              iframe.contentWindow?.print();
              // Clean up after a delay
              setTimeout(() => {
                document.body.removeChild(iframe);
              }, 1000);
            }, 250);
          };
        }

        // Show email client selector dialog immediately
        onEmailDialogOpen?.(quote);
      } else {
        // Mobile platforms
        // Check if email is available
        const isAvailable = await MailComposer.isAvailableAsync();
        if (!isAvailable) {
          Alert.alert('Email Not Available', 'Email is not configured on this device. Please set up an email account first.');
          return;
        }

        // Generate PDF with custom filename
        const html = await generateQuotePDF(quote, businessSettings, { isPro });
        const filename = generatePdfFilename('Quote', quote.customerName, quote.job.name, new Date(quote.updatedAt));
        const { uri } = await Print.printToFileAsync({ html, base64: false });

        // Compose email with acceptance link
        await MailComposer.composeAsync({
          recipients: quote.customerEmail ? [quote.customerEmail] : [],
          subject: `Quotation from ${businessSettings?.businessName || 'Your Business'} - ${quote.job.name}`,
          body: buildEmailBody(),
          attachments: [uri],
        });
      }
    } catch (error) {
      console.error('Send error:', error);
      Alert.alert('Error', 'Failed to send quote. Please try again.');
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
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export PDF. Please try again.');
    }
  };

  const sendOptions: ActionSheetOption[] = [
    {
      icon: 'email-outline',
      label: 'Email',
      onPress: handleSendQuote,
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
