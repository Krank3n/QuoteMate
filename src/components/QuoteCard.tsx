/**
 * QuoteCard Component
 * Consolidated quote card used in both DashboardScreen and QuotesListScreen
 */

import React, { useState } from 'react';
import { View, StyleSheet, Alert, Platform, Pressable } from 'react-native';
import {
  Text,
  Card,
  Divider,
  Menu,
  IconButton,
  Chip,
} from 'react-native-paper';
import { format } from 'date-fns';
import * as Print from 'expo-print';
import * as MailComposer from 'expo-mail-composer';

import { Quote, BusinessSettings } from '../types';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { generateQuotePDF, exportQuotePDF } from '../utils/pdfGenerator';

interface QuoteCardProps {
  quote: Quote;
  businessSettings: BusinessSettings | null;
  onView: (quoteId: string) => void;
  onEdit: (quote: Quote, section?: 'customer' | 'job' | 'materials' | 'labor') => void;
  onDelete: (quoteId: string) => void;
  onDuplicate: (quote: Quote) => void;
  onSave: (quote: Quote) => void;
  onStatusChange?: (quote: Quote) => void;
  onEmailDialogOpen?: (quote: Quote) => void;
  onConvertToInvoice?: (quote: Quote) => void;
}

export function QuoteCard({
  quote,
  businessSettings,
  onView,
  onEdit,
  onDelete,
  onDuplicate,
  onSave,
  onStatusChange,
  onEmailDialogOpen,
  onConvertToInvoice,
}: QuoteCardProps) {
  const [menuVisible, setMenuVisible] = useState(false);

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
        const result = await MailComposer.composeAsync({
          recipients: quote.customerEmail ? [quote.customerEmail] : [],
          subject: `Quotation from ${businessSettings?.businessName || 'Your Business'} - ${quote.job.name}`,
          body: `Hi ${quote.customerName},\n\nPlease find attached your quotation for ${quote.job.name}.\n\nTotal: ${formatCurrency(quote.total)}\n\nThis quote is valid for 30 days from the date of issue.\n\nIf you have any questions, please don't hesitate to contact us.\n\nBest regards,\n${businessSettings?.businessName || 'Your Business'}`,
          attachments: [uri],
        });

        // Update quote status to 'sent' if email was sent
        if (result.status === 'sent') {
          const updatedQuote = { ...quote, status: 'sent' as const };
          await onSave(updatedQuote);
          Alert.alert('Success', 'Quote sent successfully and marked as sent!');
        }
      }
    } catch (error) {
      console.error('Send error:', error);
      Alert.alert('Error', 'Failed to send quote. Please try again.');
    }
  };

  const handleShareQuote = async () => {
    try {
      await exportQuotePDF(quote, businessSettings, 'share');
    } catch (error) {
      console.error('Share error:', error);
      Alert.alert('Error', 'Failed to share quote. Please try again.');
    }
  };

  const handleExportQuote = async () => {
    try {
      await exportQuotePDF(quote, businessSettings, 'export');
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('Error', 'Failed to export quote. Please try again.');
    }
  };

  const handleDeleteQuote = () => {
    Alert.alert(
      'Delete Quote',
      'Are you sure you want to delete this quote?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDelete(quote.id),
        },
      ]
    );
  };


  return (
    <>
      <Card style={styles.quoteCard}>
        <Pressable onPress={() => onView(quote.id)}>
          <Card.Content style={styles.cardContent}>
            <View style={styles.quoteHeader}>
              <View style={styles.quoteInfo}>
                {quote.quoteNumber && (
                  <Text style={styles.quoteNumber}>{quote.quoteNumber}</Text>
                )}
                <Text style={styles.quoteName}>{quote.customerName}</Text>
                <Text style={styles.quoteJob}>{quote.job.name}</Text>
              </View>
              <View style={styles.quoteRight}>
                <View style={styles.quotePrice}>
                  <Text style={styles.quoteTotal}>{formatCurrency(quote.total)}</Text>
                  <Chip
                    style={[styles.statusChip, getStatusChipStyle(quote.status)]}
                    textStyle={styles.statusText}
                    onPress={(e) => {
                      e.stopPropagation();
                      onStatusChange?.(quote);
                    }}
                  >
                    {quote.status}
                  </Chip>
                </View>
                <Menu
                  visible={menuVisible}
                  onDismiss={() => setMenuVisible(false)}
                  anchor={
                    <IconButton
                      icon="dots-vertical"
                      size={20}
                      onPress={(e) => {
                        e.stopPropagation();
                        setMenuVisible(true);
                      }}
                    />
                  }
                >
                  <Menu.Item
                    leadingIcon="pencil"
                    onPress={() => {
                      setMenuVisible(false);
                      onEdit(quote);
                    }}
                    title="Edit"
                  />
                  <Menu.Item
                    leadingIcon="email"
                    onPress={() => {
                      setMenuVisible(false);
                      handleSendQuote();
                    }}
                    title="Send via Email"
                  />
                  <Menu.Item
                    leadingIcon="content-copy"
                    onPress={() => {
                      setMenuVisible(false);
                      onDuplicate(quote);
                    }}
                    title="Duplicate"
                  />
                  <Menu.Item
                    leadingIcon="share"
                    onPress={() => {
                      setMenuVisible(false);
                      handleShareQuote();
                    }}
                    title="Share"
                  />
                  <Menu.Item
                    leadingIcon="file-pdf-box"
                    onPress={() => {
                      setMenuVisible(false);
                      handleExportQuote();
                    }}
                    title="Export PDF"
                  />
                  {onConvertToInvoice && (
                    <Menu.Item
                      leadingIcon="file-replace"
                      onPress={() => {
                        setMenuVisible(false);
                        onConvertToInvoice(quote);
                      }}
                      title="Convert to Invoice"
                    />
                  )}
                  <Menu.Item
                    leadingIcon="delete"
                    onPress={() => {
                      setMenuVisible(false);
                      handleDeleteQuote();
                    }}
                    title="Delete"
                    titleStyle={{ color: colors.error }}
                  />
                </Menu>
              </View>
            </View>
            <Divider style={styles.divider} />
            <Text style={styles.quoteDate}>
              {format(new Date(quote.updatedAt), 'dd MMM yyyy')}
            </Text>
          </Card.Content>
        </Pressable>
      </Card>
    </>
  );
}

function getStatusChipStyle(status: string) {
  switch (status) {
    case 'accepted':
      return { backgroundColor: colors.successBg };
    case 'sent':
      return { backgroundColor: colors.warningBg };
    case 'rejected':
      return { backgroundColor: colors.errorBg };
    default:
      return { backgroundColor: colors.infoBg };
  }
}

const styles = StyleSheet.create({
  quoteCard: {
    marginBottom: 12,
    backgroundColor: colors.surface,
  },
  cardContent: {
    paddingTop: 16,
    paddingBottom: 16,
  },
  quoteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  quoteInfo: {
    flex: 1,
  },
  quoteRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quoteNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 2,
  },
  quoteName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  quoteJob: {
    fontSize: 14,
    color: colors.onSurface,
  },
  quotePrice: {
    alignItems: 'flex-end',
    marginRight: -8,
  },
  quoteTotal: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 8,
  },
  statusChip: {
    height: 24,
    marginBottom: 4,
  },
  statusText: {
    fontSize: 12,
    textTransform: 'capitalize',
    marginVertical: 0,
    lineHeight: 24,
  },
  divider: {
    marginVertical: 12,
  },
  quoteDate: {
    fontSize: 12,
    color: colors.onSurface,
  },
});
