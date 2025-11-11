/**
 * QuoteCard Component
 * Consolidated quote card used in both DashboardScreen and QuotesListScreen
 */

import React, { useState } from 'react';
import { View, StyleSheet, Alert, Platform, Modal, Pressable, ScrollView } from 'react-native';
import {
  Text,
  Card,
  Divider,
  Menu,
  IconButton,
  Chip,
  Button,
  Surface,
  Title,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
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
  onEdit: (quote: Quote) => void;
  onDelete: (quoteId: string) => void;
  onDuplicate: (quote: Quote) => void;
  onSave: (quote: Quote) => void;
  onStatusChange?: (quote: Quote) => void;
  onEmailDialogOpen?: (quote: Quote) => void;
}

export function QuoteCard({
  quote,
  businessSettings,
  onEdit,
  onDelete,
  onDuplicate,
  onSave,
  onStatusChange,
  onEmailDialogOpen,
}: QuoteCardProps) {
  const [menuVisible, setMenuVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);

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
        <Pressable onPress={() => setPreviewVisible(true)}>
          <Card.Content style={styles.cardContent}>
            <View style={styles.quoteHeader}>
              <View style={styles.quoteInfo}>
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

      {/* Quote Preview Modal */}
      <Modal
        visible={previewVisible}
        animationType="slide"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Title>Quote Preview</Title>
            <IconButton
              icon="close"
              size={24}
              onPress={() => setPreviewVisible(false)}
            />
          </View>

          <ScrollView style={styles.modalContent}>
            <Surface style={styles.section}>
              <Title style={styles.sectionTitle}>Customer</Title>
              <Text style={styles.text}>{quote.customerName}</Text>
              {quote.customerEmail && <Text style={styles.subtext}>{quote.customerEmail}</Text>}
              {quote.customerPhone && <Text style={styles.subtext}>{quote.customerPhone}</Text>}
              {quote.jobAddress && <Text style={styles.subtext}>{quote.jobAddress}</Text>}
            </Surface>

            <Surface style={styles.section}>
              <Title style={styles.sectionTitle}>Job</Title>
              <Text style={styles.text}>{quote.job.name}</Text>
              <Text style={styles.subtext}>{quote.job.description}</Text>
            </Surface>

            <Surface style={styles.section}>
              <Title style={styles.sectionTitle}>Materials ({quote.materials.length})</Title>
              {quote.materials.length === 0 ? (
                <Text style={styles.subtext}>No materials required - Labor only</Text>
              ) : (
                quote.materials.map((material) => (
                  <View key={material.id} style={styles.itemRow}>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemName}>{material.name}</Text>
                      <Text style={styles.itemDetails}>
                        {material.quantity} {material.unit} × {formatCurrency(material.price)}
                      </Text>
                    </View>
                    <Text style={styles.itemTotal}>{formatCurrency(material.totalPrice)}</Text>
                  </View>
                ))
              )}
              <Divider style={styles.divider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Materials Subtotal</Text>
                <Text style={styles.summaryValue}>{formatCurrency(quote.materialsSubtotal)}</Text>
              </View>
            </Surface>

            <Surface style={styles.section}>
              <Title style={styles.sectionTitle}>Labor</Title>
              <View style={styles.summaryRow}>
                <Text style={styles.text}>
                  {quote.laborHours} hours @ {formatCurrency(quote.laborRate)}/hr
                </Text>
                <Text style={styles.summaryValue}>{formatCurrency(quote.laborTotal)}</Text>
              </View>
            </Surface>

            <Surface style={styles.totalSection}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal</Text>
                <Text style={styles.summaryValue}>{formatCurrency(quote.subtotal)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Markup ({quote.markup}%)</Text>
                <Text style={styles.summaryValue}>{formatCurrency(quote.markupAmount)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>GST (10%)</Text>
                <Text style={styles.summaryValue}>{formatCurrency(quote.gst)}</Text>
              </View>
              <Divider style={styles.divider} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>TOTAL</Text>
                <Text style={styles.totalValue}>{formatCurrency(quote.total)}</Text>
              </View>
            </Surface>

            {quote.notes && (
              <Surface style={styles.section}>
                <Title style={styles.sectionTitle}>Notes</Title>
                <Text style={styles.text}>{quote.notes}</Text>
              </Surface>
            )}
          </ScrollView>

          <View style={styles.modalActions}>
            <Button
              mode="outlined"
              onPress={() => {
                setPreviewVisible(false);
                onEdit(quote);
              }}
              style={styles.modalButton}
              icon="pencil"
            >
              Edit
            </Button>
            <Button
              mode="contained"
              onPress={() => setPreviewVisible(false)}
              style={styles.modalButton}
            >
              Close
            </Button>
          </View>
        </View>
      </Modal>
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
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  text: {
    fontSize: 14,
    marginBottom: 4,
  },
  subtext: {
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 2,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  itemDetails: {
    fontSize: 12,
    color: colors.onSurface,
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalSection: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 3,
    backgroundColor: colors.surfaceGray,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  modalButton: {
    flex: 1,
  },
});
