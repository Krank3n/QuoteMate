/**
 * Dashboard Screen
 * Home screen with quick stats and new quote button
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Pressable } from 'react-native';
import {
  Text,
  Surface,
  Title,
  Button,
  Paragraph,
  Dialog,
  Portal,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as MailComposer from 'expo-mail-composer';

import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { Quote } from '../types';
import { generateQuotePDF } from '../utils/pdfGenerator';
import { WebContainer } from '../components/WebContainer';
import { QuoteCard } from '../components/QuoteCard';
import { AlertModal } from '../components/AlertModal';
import { updateActivityTimestamp } from '../services/emailService';

export function DashboardScreen() {
  // Track user activity for re-engagement emails (once per app session)
  const activityTracked = useRef(false);
  useEffect(() => {
    if (!activityTracked.current) {
      activityTracked.current = true;
      updateActivityTimestamp();
    }
  }, []);
  const navigation = useNavigation<any>();
  const { quotes, businessSettings, createNewQuote, setCurrentQuote, duplicateQuote, deleteQuote, saveQuote, canCreateQuote, subscriptionStatus, createInvoiceFromQuote, saveInvoice } = useStore();

  const [emailDialogVisible, setEmailDialogVisible] = useState(false);
  const [emailQuote, setEmailQuote] = useState<Quote | null>(null);
  const [statusDialogVisible, setStatusDialogVisible] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<'draft' | 'sent' | 'accepted' | 'rejected'>('draft');
  const [convertModalVisible, setConvertModalVisible] = useState(false);
  const [quoteToConvert, setQuoteToConvert] = useState<Quote | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  // Calculate quick stats
  const totalQuotes = quotes.length;
  const sentQuotes = quotes.filter((q) => q.status === 'sent').length;
  const acceptedQuotes = quotes.filter((q) => q.status === 'accepted').length;
  const totalRevenue = quotes
    .filter((q) => q.status === 'accepted')
    .reduce((sum, q) => sum + q.total, 0);

  // Recent quotes (last 3)
  const recentQuotes = [...quotes]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 3);

  const handleNewQuote = () => {
    // Check if user can create a new quote
    if (!canCreateQuote()) {
      navigation.navigate('Paywall' as never);
      return;
    }

    createNewQuote();
    navigation.navigate('NewQuote' as never);
  };

  const handleViewQuote = (quoteId: string) => {
    navigation.navigate('ViewQuote' as never, { quoteId } as never);
  };

  const handleEditQuote = (quote: Quote, section?: 'customer' | 'job' | 'materials' | 'labor') => {
    setCurrentQuote(quote);

    // Navigate to specific section if provided
    if (section) {
      const screenMap = {
        customer: 'CustomerDetails',
        job: 'JobDetails',
        materials: 'MaterialsList',
        labor: 'LaborMarkup',
      };
      navigation.navigate('NewQuote' as never, { screen: screenMap[section] } as never);
    } else {
      navigation.navigate('NewQuote' as never);
    }
  };

  const handleDuplicateQuote = async (quote: Quote) => {
    // Check if user can create a new quote
    if (!canCreateQuote()) {
      navigation.navigate('Paywall' as never);
      return;
    }

    try {
      await duplicateQuote(quote);
      Alert.alert('Success', 'Quote duplicated successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to duplicate quote. Please try again.');
    }
  };

  const handleConvertToInvoice = (quote: Quote) => {
    setQuoteToConvert(quote);
    setConvertModalVisible(true);
  };

  const handleConfirmConvert = async () => {
    if (!quoteToConvert) return;
    setIsConverting(true);
    try {
      const invoice = createInvoiceFromQuote(quoteToConvert);
      await saveInvoice(invoice);
      setConvertModalVisible(false);
      setQuoteToConvert(null);
      navigation.navigate('ViewInvoice' as never, { invoiceId: invoice.id } as never);
    } catch (error) {
      console.error('Failed to convert to invoice:', error);
    } finally {
      setIsConverting(false);
    }
  };

  const handleDeleteQuote = async (quoteId: string) => {
    Alert.alert(
      'Delete Quote',
      'Are you sure you want to delete this quote?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteQuote(quoteId);
            } catch (error) {
              Alert.alert('Error', 'Failed to delete quote. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleSendQuote = async (quote: Quote) => {
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
        setEmailQuote(quote);
        setEmailDialogVisible(true);
      } else{
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
          await saveQuote(updatedQuote);
          Alert.alert('Success', 'Quote sent successfully and marked as sent!');
        }
      }
    } catch (error) {
      console.error('Send error:', error);
      Alert.alert('Error', 'Failed to send quote. Please try again.');
    }
  };

  const handleEmailViaGmail = (quote: Quote) => {
    const subject = `Quotation from ${businessSettings?.businessName || 'Your Business'} - ${quote.job.name}`;
    const emailBody =
      `Hi ${quote.customerName},\n\n` +
      `Please find your quotation for ${quote.job.name}.\n\n` +
      `Total: ${formatCurrency(quote.total)}\n\n` +
      `This quote is valid for 30 days from the date of issue.\n\n` +
      `If you have any questions, please don't hesitate to contact us.\n\n` +
      `Best regards,\n${businessSettings?.businessName || 'Your Business'}\n\n` +
      `---\n` +
      `Note: A print dialog has opened with the quote PDF. Please save it as PDF and attach it to this email.`;

    const recipient = quote.customerEmail || '';
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipient)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;
    window.open(gmailUrl, '_blank');

    // Update quote status
    const updatedQuote = { ...quote, status: 'sent' as const };
    saveQuote(updatedQuote);
    setEmailDialogVisible(false);
  };

  const handleEmailViaOutlook = (quote: Quote) => {
    const subject = `Quotation from ${businessSettings?.businessName || 'Your Business'} - ${quote.job.name}`;
    const emailBody =
      `Hi ${quote.customerName},\n\n` +
      `Please find your quotation for ${quote.job.name}.\n\n` +
      `Total: ${formatCurrency(quote.total)}\n\n` +
      `This quote is valid for 30 days from the date of issue.\n\n` +
      `If you have any questions, please don't hesitate to contact us.\n\n` +
      `Best regards,\n${businessSettings?.businessName || 'Your Business'}\n\n` +
      `---\n` +
      `Note: A print dialog has opened with the quote PDF. Please save it as PDF and attach it to this email.`;

    const recipient = quote.customerEmail || '';
    const outlookUrl = `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(recipient)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;
    window.open(outlookUrl, '_blank');

    // Update quote status
    const updatedQuote = { ...quote, status: 'sent' as const };
    saveQuote(updatedQuote);
    setEmailDialogVisible(false);
  };

  const handleEmailViaYahoo = (quote: Quote) => {
    const subject = `Quotation from ${businessSettings?.businessName || 'Your Business'} - ${quote.job.name}`;
    const emailBody =
      `Hi ${quote.customerName},\n\n` +
      `Please find your quotation for ${quote.job.name}.\n\n` +
      `Total: ${formatCurrency(quote.total)}\n\n` +
      `This quote is valid for 30 days from the date of issue.\n\n` +
      `If you have any questions, please don't hesitate to contact us.\n\n` +
      `Best regards,\n${businessSettings?.businessName || 'Your Business'}\n\n` +
      `---\n` +
      `Note: A print dialog has opened with the quote PDF. Please save it as PDF and attach it to this email.`;

    const recipient = quote.customerEmail || '';
    const yahooUrl = `https://compose.mail.yahoo.com/?to=${encodeURIComponent(recipient)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;
    window.open(yahooUrl, '_blank');

    // Update quote status
    const updatedQuote = { ...quote, status: 'sent' as const };
    saveQuote(updatedQuote);
    setEmailDialogVisible(false);
  };

  const handleCopyEmailText = async (quote: Quote) => {
    try {
      const subject = `Quotation from ${businessSettings?.businessName || 'Your Business'} - ${quote.job.name}`;
      const emailBody =
        `Hi ${quote.customerName},\n\n` +
        `Please find your quotation for ${quote.job.name}.\n\n` +
        `Total: ${formatCurrency(quote.total)}\n\n` +
        `This quote is valid for 30 days from the date of issue.\n\n` +
        `If you have any questions, please don't hesitate to contact us.\n\n` +
        `Best regards,\n${businessSettings?.businessName || 'Your Business'}\n\n` +
        `---\n` +
        `Note: A print dialog has opened with the quote PDF. Please save it as PDF and attach it to this email.`;

      const recipient = quote.customerEmail || '';
      const emailText = `To: ${recipient}\nSubject: ${subject}\n\n${emailBody}`;
      await navigator.clipboard.writeText(emailText);
      Alert.alert('Copied!', 'Email text copied to clipboard. You can paste it into your email client.');

      // Update quote status
      const updatedQuote = { ...quote, status: 'sent' as const };
      await saveQuote(updatedQuote);
      setEmailDialogVisible(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to copy to clipboard');
    }
  };

  const handleOpenEmailDialog = (quote: Quote) => {
    setEmailQuote(quote);
    setEmailDialogVisible(true);
  };

  const handleOpenStatusDialog = (quote: Quote) => {
    setSelectedQuote(quote);
    setSelectedStatus(quote.status);
    setStatusDialogVisible(true);
  };

  const handleUpdateStatus = async () => {
    if (!selectedQuote) return;

    try {
      const updatedQuote = {
        ...selectedQuote,
        status: selectedStatus,
        updatedAt: new Date(),
      };
      await saveQuote(updatedQuote);
      setStatusDialogVisible(false);
      setSelectedQuote(null);
    } catch (error) {
      Alert.alert('Error', 'Failed to update quote status. Please try again.');
    }
  };

  return (
    <>
      {/* Convert to Invoice Modal */}
      <AlertModal
        visible={convertModalVisible}
        onDismiss={() => {
          setConvertModalVisible(false);
          setQuoteToConvert(null);
        }}
        type="info"
        icon="file-replace"
        title="Convert to Invoice"
        message={quoteToConvert ? `Create an invoice from this quote for ${quoteToConvert.customerName}?` : ''}
        showConfetti={false}
        primaryButtonText="Convert"
        primaryButtonAction={handleConfirmConvert}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => {
          setConvertModalVisible(false);
          setQuoteToConvert(null);
        }}
        secondaryButtonLoading={isConverting}
      />

    <ScrollView style={styles.container}>
      <WebContainer>
        <View style={styles.header}>
          <Title style={styles.greeting}>
            G'day, {businessSettings?.businessName || 'Mate'}!
          </Title>
          <Paragraph>Ready to create some quotes?</Paragraph>
        </View>

      {/* Quote Usage Counter */}
      {subscriptionStatus && !subscriptionStatus.isPro && (
        <Surface style={styles.quotaCard}>
          <View style={styles.quotaContent}>
            <View style={styles.quotaTextContainer}>
              <Text style={styles.quotaTitle}>
                {subscriptionStatus.freeQuotesLimit - subscriptionStatus.quotesThisMonth > 0
                  ? `${subscriptionStatus.freeQuotesLimit - subscriptionStatus.quotesThisMonth} of ${subscriptionStatus.freeQuotesLimit} quotes remaining`
                  : 'No quotes remaining this month'}
              </Text>
              <Text style={styles.quotaSubtext}>
                {subscriptionStatus.freeQuotesLimit - subscriptionStatus.quotesThisMonth > 0
                  ? 'Free plan resets monthly'
                  : 'Upgrade to Pro for unlimited quotes'}
              </Text>
            </View>
            <View style={styles.quotaBarContainer}>
              <View style={styles.quotaBarBackground}>
                <View
                  style={[
                    styles.quotaBarFill,
                    {
                      width: `${Math.min((subscriptionStatus.quotesThisMonth / subscriptionStatus.freeQuotesLimit) * 100, 100)}%`,
                      backgroundColor:
                        subscriptionStatus.quotesThisMonth >= subscriptionStatus.freeQuotesLimit
                          ? colors.error
                          : subscriptionStatus.quotesThisMonth >= subscriptionStatus.freeQuotesLimit - 1
                          ? colors.warning
                          : colors.primary,
                    },
                  ]}
                />
              </View>
            </View>
          </View>
          {subscriptionStatus.quotesThisMonth >= subscriptionStatus.freeQuotesLimit && (
            <Button
              mode="contained"
              compact
              onPress={() => navigation.navigate('Paywall' as never)}
              style={styles.quotaUpgradeButton}
            >
              Upgrade to Pro
            </Button>
          )}
        </Surface>
      )}

      {/* New Quote Button */}
      <Button
        mode="contained"
        icon="plus-circle"
        onPress={handleNewQuote}
        style={styles.newQuoteButton}
        contentStyle={styles.newQuoteButtonContent}
      >
        New Quote
      </Button>

      {/* Quick Stats */}
      <View style={styles.statsContainer}>
        <Surface style={styles.statCard}>
          <MaterialCommunityIcons name="file-document" size={32} color={colors.primary} />
          <Text style={styles.statNumber}>{totalQuotes}</Text>
          <Text style={styles.statLabel}>Total Quotes</Text>
        </Surface>

        <Surface style={styles.statCard}>
          <MaterialCommunityIcons name="send" size={32} color={colors.secondary} />
          <Text style={styles.statNumber}>{sentQuotes}</Text>
          <Text style={styles.statLabel}>Sent</Text>
        </Surface>

        <Surface style={styles.statCard}>
          <MaterialCommunityIcons name="check-circle" size={32} color={colors.success} />
          <Text style={styles.statNumber}>{acceptedQuotes}</Text>
          <Text style={styles.statLabel}>Accepted</Text>
        </Surface>

        <Surface style={styles.statCard}>
          <MaterialCommunityIcons name="currency-usd" size={32} color={colors.warning} />
          <Text style={styles.statNumber}>{formatCurrency(totalRevenue)}</Text>
          <Text style={styles.statLabel}>Revenue</Text>
        </Surface>
      </View>

      {/* Recent Quotes */}
      {recentQuotes.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Quotes</Text>

          {recentQuotes.map((quote) => (
            <QuoteCard
              key={quote.id}
              quote={quote}
              businessSettings={businessSettings}
              onView={handleViewQuote}
              onEdit={handleEditQuote}
              onDelete={handleDeleteQuote}
              onDuplicate={handleDuplicateQuote}
              onSave={saveQuote}
              onStatusChange={handleOpenStatusDialog}
              onEmailDialogOpen={handleOpenEmailDialog}
              onConvertToInvoice={handleConvertToInvoice}
            />
          ))}

          <Button
            mode="text"
            onPress={() => navigation.navigate('Quotes')}
            style={styles.viewAllButton}
          >
            View All Quotes
          </Button>
        </View>
      )}

      {recentQuotes.length === 0 && (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons
            name="file-document-outline"
            size={64}
            color={colors.disabled}
          />
          <Text style={styles.emptyText}>No quotes yet</Text>
          <Text style={styles.emptySubtext}>
            Tap "New Quote" to create your first quote
          </Text>
        </View>
      )}
      </WebContainer>
    </ScrollView>

    {/* Status Change Dialog */}
    <Portal>
      <Dialog visible={statusDialogVisible} onDismiss={() => setStatusDialogVisible(false)}>
        <Dialog.Title>Change Quote Status</Dialog.Title>
        <Dialog.Content>
          <View style={styles.statusOptions}>
            <Pressable
              style={[
                styles.statusOption,
                selectedStatus === 'draft' && styles.statusOptionSelected,
              ]}
              onPress={() => setSelectedStatus('draft')}
            >
              <View style={styles.statusOptionContent}>
                <View style={[styles.statusDot, { backgroundColor: colors.info }]} />
                <Text style={[
                  styles.statusOptionText,
                  selectedStatus === 'draft' && styles.statusOptionTextSelected,
                ]}>
                  Draft
                </Text>
              </View>
              {selectedStatus === 'draft' && (
                <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
              )}
            </Pressable>

            <Pressable
              style={[
                styles.statusOption,
                selectedStatus === 'sent' && styles.statusOptionSelected,
              ]}
              onPress={() => setSelectedStatus('sent')}
            >
              <View style={styles.statusOptionContent}>
                <View style={[styles.statusDot, { backgroundColor: colors.warning }]} />
                <Text style={[
                  styles.statusOptionText,
                  selectedStatus === 'sent' && styles.statusOptionTextSelected,
                ]}>
                  Sent
                </Text>
              </View>
              {selectedStatus === 'sent' && (
                <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
              )}
            </Pressable>

            <Pressable
              style={[
                styles.statusOption,
                selectedStatus === 'accepted' && styles.statusOptionSelected,
              ]}
              onPress={() => setSelectedStatus('accepted')}
            >
              <View style={styles.statusOptionContent}>
                <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
                <Text style={[
                  styles.statusOptionText,
                  selectedStatus === 'accepted' && styles.statusOptionTextSelected,
                ]}>
                  Accepted
                </Text>
              </View>
              {selectedStatus === 'accepted' && (
                <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
              )}
            </Pressable>

            <Pressable
              style={[
                styles.statusOption,
                selectedStatus === 'rejected' && styles.statusOptionSelected,
              ]}
              onPress={() => setSelectedStatus('rejected')}
            >
              <View style={styles.statusOptionContent}>
                <View style={[styles.statusDot, { backgroundColor: colors.rejected }]} />
                <Text style={[
                  styles.statusOptionText,
                  selectedStatus === 'rejected' && styles.statusOptionTextSelected,
                ]}>
                  Rejected
                </Text>
              </View>
              {selectedStatus === 'rejected' && (
                <MaterialCommunityIcons name="check-circle" size={24} color={colors.primary} />
              )}
            </Pressable>
          </View>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => setStatusDialogVisible(false)}>Cancel</Button>
          <Button onPress={handleUpdateStatus}>Update</Button>
        </Dialog.Actions>
      </Dialog>

      {/* Email Client Selector Dialog */}
      <Dialog visible={emailDialogVisible} onDismiss={() => setEmailDialogVisible(false)}>
        <Dialog.Title>Send Quote</Dialog.Title>
        <Dialog.Content>
          <Text style={{ marginBottom: 16 }}>Choose how to send your quote:</Text>
          <View style={{ gap: 8 }}>
            <Button
              mode="contained"
              icon="google"
              onPress={() => emailQuote && handleEmailViaGmail(emailQuote)}
              style={{ marginBottom: 8 }}
            >
              Gmail
            </Button>
            <Button
              mode="contained"
              icon="microsoft-outlook"
              onPress={() => emailQuote && handleEmailViaOutlook(emailQuote)}
              style={{ marginBottom: 8 }}
            >
              Outlook
            </Button>
            <Button
              mode="contained"
              icon="yahoo"
              onPress={() => emailQuote && handleEmailViaYahoo(emailQuote)}
              style={{ marginBottom: 8 }}
            >
              Yahoo Mail
            </Button>
            <Button
              mode="outlined"
              icon="content-copy"
              onPress={() => emailQuote && handleCopyEmailText(emailQuote)}
            >
              Copy Email Text
            </Button>
          </View>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => setEmailDialogVisible(false)}>Cancel</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: 20,
    paddingTop: 24,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  quotaCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
    elevation: 2,
  },
  quotaContent: {
    gap: 8,
  },
  quotaTextContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quotaTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  quotaSubtext: {
    fontSize: 12,
    color: colors.onSurface,
  },
  quotaBarContainer: {
    marginTop: 4,
  },
  quotaBarBackground: {
    height: 6,
    backgroundColor: colors.surfaceLight,
    borderRadius: 3,
    overflow: 'hidden',
  },
  quotaBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  quotaUpgradeButton: {
    marginTop: 12,
  },
  newQuoteButton: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  newQuoteButtonContent: {
    paddingVertical: 8,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    marginBottom: 24,
  },
  statCard: {
    width: '46%',
    margin: '2%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 2,
    backgroundColor: colors.surface,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 8,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: colors.onSurface,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  viewAllButton: {
    marginTop: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    color: colors.text,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.onSurface,
    marginTop: 8,
    textAlign: 'center',
  },
  statusOptions: {
    gap: 12,
  },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLight,
  },
  statusOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.successBg,
  },
  statusOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  statusOptionText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textDark,
    textTransform: 'capitalize',
  },
  statusOptionTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
});
