/**
 * Send Quote Button Component
 * Reusable button with modal dialog for sending quotes via Email, SMS, Share, or Export PDF
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert, Platform, TouchableOpacity, Share, Linking, Animated } from 'react-native';
import {
  Text,
  Button,
  Modal,
  Portal,
  IconButton,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Print from 'expo-print';
import * as MailComposer from 'expo-mail-composer';
import { format } from 'date-fns';

import { Quote, BusinessSettings } from '../types';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { generateQuotePDF, exportQuotePDF } from '../utils/pdfGenerator';

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
  const [sendDialogVisible, setSendDialogVisible] = useState(false);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (sendDialogVisible) {
      // Reset animations
      scaleAnim.setValue(0);
      fadeAnim.setValue(0);

      // Start animations
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [sendDialogVisible]);

  const handleSendQuote = async () => {
    try {
      if (Platform.OS === 'web') {
        // Generate PDF HTML
        const html = await generateQuotePDF(quote, businessSettings);
        const filename = `Quote_${quote.customerName.replace(/\s+/g, '_')}_${quote.job.name.replace(/\s+/g, '_')}_${format(quote.updatedAt, 'dd-MMM-yyyy')}.pdf`;

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
        const html = await generateQuotePDF(quote, businessSettings);
        const filename = `Quote_${quote.customerName.replace(/\s+/g, '_')}_${quote.job.name.replace(/\s+/g, '_')}_${format(quote.updatedAt, 'dd-MMM-yyyy')}.pdf`;
        const { uri } = await Print.printToFileAsync({ html, base64: false });

        // Compose email
        await MailComposer.composeAsync({
          recipients: quote.customerEmail ? [quote.customerEmail] : [],
          subject: `Quotation from ${businessSettings?.businessName || 'Your Business'} - ${quote.job.name}`,
          body: `Hi ${quote.customerName},\n\nPlease find attached your quotation for ${quote.job.name}.\n\nTotal: ${formatCurrency(quote.total)}\n\nThis quote is valid for 30 days from the date of issue.\n\nIf you have any questions, please don't hesitate to contact us.\n\nBest regards,\n${businessSettings?.businessName || 'Your Business'}`,
          attachments: [uri],
        });
      }
    } catch (error) {
      console.error('Send error:', error);
      Alert.alert('Error', 'Failed to send quote. Please try again.');
    }
  };

  const handleSendEmailFromDialog = async () => {
    setSendDialogVisible(false);
    await handleSendQuote();
  };

  const handleSendSMS = async () => {
    setSendDialogVisible(false);

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
    setSendDialogVisible(false);

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
    setSendDialogVisible(false);
    try {
      await exportQuotePDF(quote, businessSettings, 'export');
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export PDF. Please try again.');
    }
  };

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

      {/* Send Options Modal */}
      <Portal>
        <Modal
          visible={sendDialogVisible}
          onDismiss={() => setSendDialogVisible(false)}
          dismissable={true}
          contentContainerStyle={styles.modalContainer}
        >
          <Animated.View
            style={[
              styles.card,
              {
                opacity: fadeAnim,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.iconContainer}>
                <IconButton
                  icon="send"
                  iconColor={colors.primary}
                  size={40}
                />
              </View>
              <Text style={styles.title}>Send Quote</Text>
              <Text style={styles.subtitle}>Choose how to send this quote to your customer</Text>
            </View>

            {/* Send Options */}
            <View style={styles.optionsContainer}>
              <TouchableOpacity style={styles.sendOption} onPress={handleSendEmailFromDialog}>
                <View style={styles.optionIconContainer}>
                  <MaterialCommunityIcons name="email" size={28} color={colors.primary} />
                </View>
                <View style={styles.sendOptionText}>
                  <Text style={styles.sendOptionTitle}>Email</Text>
                  <Text style={styles.sendOptionSubtitle}>
                    {quote.customerEmail || 'No email provided'}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={24} color={colors.onSurface} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.sendOption} onPress={handleSendSMS}>
                <View style={styles.optionIconContainer}>
                  <MaterialCommunityIcons name="message-text" size={28} color={colors.primary} />
                </View>
                <View style={styles.sendOptionText}>
                  <Text style={styles.sendOptionTitle}>SMS</Text>
                  <Text style={styles.sendOptionSubtitle}>
                    {quote.customerPhone || 'No phone provided'}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={24} color={colors.onSurface} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.sendOption} onPress={handleShareFromDialog}>
                <View style={styles.optionIconContainer}>
                  <MaterialCommunityIcons name="share-variant" size={28} color={colors.primary} />
                </View>
                <View style={styles.sendOptionText}>
                  <Text style={styles.sendOptionTitle}>Share</Text>
                  <Text style={styles.sendOptionSubtitle}>Share via other apps</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={24} color={colors.onSurface} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.sendOption} onPress={handleExportFromDialog}>
                <View style={styles.optionIconContainer}>
                  <MaterialCommunityIcons name="file-pdf-box" size={28} color={colors.primary} />
                </View>
                <View style={styles.sendOptionText}>
                  <Text style={styles.sendOptionTitle}>Export PDF</Text>
                  <Text style={styles.sendOptionSubtitle}>Save or share PDF file</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={24} color={colors.onSurface} />
              </TouchableOpacity>
            </View>

            {/* Cancel Button */}
            <Button
              mode="outlined"
              onPress={() => setSendDialogVisible(false)}
              style={styles.cancelButton}
              textColor={colors.onSurface}
            >
              Cancel
            </Button>
          </Animated.View>
        </Modal>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  buttonContent: {
    paddingVertical: 8,
  },
  buttonLabel: {
    marginVertical: 8,
  },
  modalContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 32,
    ...Platform.select({
      android: {
        elevation: 8,
      },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      web: {
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      },
    }),
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconContainer: {
    backgroundColor: colors.primaryBg,
    borderRadius: 50,
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  optionsContainer: {
    width: '100%',
    marginBottom: 20,
  },
  sendOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: colors.surfaceLight,
    ...Platform.select({
      android: {
        elevation: 1,
      },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
    }),
  },
  optionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  sendOptionText: {
    flex: 1,
  },
  sendOptionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 3,
  },
  sendOptionSubtitle: {
    fontSize: 14,
    color: colors.onSurface,
  },
  cancelButton: {
    width: '100%',
    paddingVertical: 6,
    borderColor: colors.border,
  },
});
