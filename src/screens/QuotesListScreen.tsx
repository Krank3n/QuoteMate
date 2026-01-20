/**
 * Quotes List Screen
 * Display all quotes with search and filter
 */

import React, { useState } from 'react';
import { View, StyleSheet, FlatList, Alert, Platform, Pressable } from 'react-native';
import {
  Text,
  Searchbar,
  Chip,
  FAB,
  Dialog,
  Portal,
  Button,
} from 'react-native-paper';
import { format } from 'date-fns';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as MailComposer from 'expo-mail-composer';

import { useStore } from '../store/useStore';
import { Quote } from '../types';
import { colors } from '../theme';
import { formatCurrency } from '../utils/quoteCalculator';
import { generateQuotePDF, exportQuotePDF } from '../utils/pdfGenerator';
import { WebContainer } from '../components/WebContainer';
import { QuoteCard } from '../components/QuoteCard';
import { AlertModal } from '../components/AlertModal';

type FilterStatus = 'all' | 'draft' | 'sent' | 'accepted' | 'rejected';

export function QuotesListScreen() {
  const navigation = useNavigation<any>();
  const { quotes, deleteQuote, duplicateQuote, setCurrentQuote, createNewQuote, saveQuote, businessSettings, canCreateQuote, createInvoiceFromQuote, saveInvoice } = useStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [statusDialogVisible, setStatusDialogVisible] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<'draft' | 'sent' | 'accepted' | 'rejected'>('draft');
  const [emailDialogVisible, setEmailDialogVisible] = useState(false);
  const [emailQuote, setEmailQuote] = useState<Quote | null>(null);
  const [convertModalVisible, setConvertModalVisible] = useState(false);
  const [quoteToConvert, setQuoteToConvert] = useState<Quote | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  // Filter and search quotes
  const filteredQuotes = quotes.filter((quote) => {
    // Status filter
    if (filterStatus !== 'all' && quote.status !== filterStatus) {
      return false;
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        quote.customerName.toLowerCase().includes(query) ||
        quote.job.name.toLowerCase().includes(query) ||
        quote.job.description.toLowerCase().includes(query)
      );
    }

    return true;
  });

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

  const handleDeleteQuote = async (quoteId: string) => {
    // Could add confirmation dialog
    await deleteQuote(quoteId);
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

  const handleOpenEmailDialog = (quote: Quote) => {
    setEmailQuote(quote);
    setEmailDialogVisible(true);
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

  const renderQuoteCard = ({ item: quote }: { item: Quote }) => (
    <QuoteCard
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
  );

  return (
    <View style={styles.container}>
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

      <WebContainer>
        {/* Search Bar */}
        <Searchbar
          placeholder="Search quotes..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
        />

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        <Chip
          selected={filterStatus === 'all'}
          onPress={() => setFilterStatus('all')}
          style={styles.filterChip}
        >
          All
        </Chip>
        <Chip
          selected={filterStatus === 'draft'}
          onPress={() => setFilterStatus('draft')}
          style={styles.filterChip}
        >
          Draft
        </Chip>
        <Chip
          selected={filterStatus === 'sent'}
          onPress={() => setFilterStatus('sent')}
          style={styles.filterChip}
        >
          Sent
        </Chip>
        <Chip
          selected={filterStatus === 'accepted'}
          onPress={() => setFilterStatus('accepted')}
          style={styles.filterChip}
        >
          Accepted
        </Chip>
      </View>
      </WebContainer>

      {/* Quotes List */}
      <WebContainer style={styles.listContainer}>
        <FlatList
          data={filteredQuotes}
          renderItem={renderQuoteCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          style={styles.flatList}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <MaterialCommunityIcons
                name="file-document-outline"
                size={64}
                color={colors.disabled}
              />
              <Text style={styles.emptyText}>No quotes found</Text>
            </View>
          }
        />
      </WebContainer>

      {/* New Quote FAB */}
      <FAB
        icon="plus"
        style={styles.fab}
        onPress={handleNewQuote}
        color={colors.white}
      />

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchBar: {
    margin: 16,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  filterChip: {
    marginRight: 8,
    backgroundColor: colors.surface,
  },
  listContainer: {
    flex: 1,
  },
  flatList: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: colors.onSurface,
    marginTop: 16,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    backgroundColor: colors.primary,
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
