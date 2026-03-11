/**
 * Quotes List Screen
 * Display all quotes with search and filter
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, StyleSheet, FlatList, Alert, RefreshControl } from 'react-native';
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
import { useNavigation, useRoute, useScrollToTop } from '@react-navigation/native';
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
import { AnimatedListItem } from '../components/AnimatedListItem';
import { StatusSheet, QUOTE_STATUS_OPTIONS } from '../components/StatusSheet';
import { lightTap } from '../utils/haptics';
import { openWebEmailClient, copyQuoteEmailText } from '../utils/emailUtils';

type FilterStatus = 'all' | 'draft' | 'sent' | 'accepted' | 'rejected' | 'completed';

export function QuotesListScreen() {
  const listRef = useRef<FlatList>(null);
  useScrollToTop(listRef);

  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { quotes, deleteQuote, duplicateQuote, setCurrentQuote, createNewQuote, saveQuote, businessSettings, canCreateQuote, createInvoiceFromQuote, saveInvoice, loadQuotes, subscriptionStatus } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(route.params?.filter || 'all');

  // Update filter when navigating with a filter param
  useEffect(() => {
    if (route.params?.filter) {
      setFilterStatus(route.params.filter);
    }
  }, [route.params?.filter]);
  const [statusSheetVisible, setStatusSheetVisible] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [emailDialogVisible, setEmailDialogVisible] = useState(false);
  const [emailQuote, setEmailQuote] = useState<Quote | null>(null);
  const [convertModalVisible, setConvertModalVisible] = useState(false);
  const [quoteToConvert, setQuoteToConvert] = useState<Quote | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Filter and search quotes
  const filteredQuotes = useMemo(() => quotes.filter((quote) => {
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
  }), [quotes, filterStatus, searchQuery]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadQuotes();
    } finally {
      setRefreshing(false);
    }
  };

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

  const handleOpenStatusSheet = (quote: Quote) => {
    setSelectedQuote(quote);
    setStatusSheetVisible(true);
  };

  const handleStatusSelect = async (newStatus: string) => {
    if (!selectedQuote) return;
    try {
      const updatedQuote = {
        ...selectedQuote,
        status: newStatus as Quote['status'],
        updatedAt: new Date(),
      };
      await saveQuote(updatedQuote);
    } catch (error) {
      Alert.alert('Error', 'Failed to update quote status. Please try again.');
    }
    setStatusSheetVisible(false);
    setSelectedQuote(null);
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
    if (!isPro) {
      navigation.navigate('Paywall' as never);
      return;
    }
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

  const handleEmailViaGmail = async (quote: Quote) => {
    await openWebEmailClient('gmail', quote, businessSettings, saveQuote);
    setEmailDialogVisible(false);
  };

  const handleEmailViaOutlook = async (quote: Quote) => {
    await openWebEmailClient('outlook', quote, businessSettings, saveQuote);
    setEmailDialogVisible(false);
  };

  const handleEmailViaYahoo = async (quote: Quote) => {
    await openWebEmailClient('yahoo', quote, businessSettings, saveQuote);
    setEmailDialogVisible(false);
  };

  const handleCopyEmailText = async (quote: Quote) => {
    try {
      await copyQuoteEmailText(quote, businessSettings, saveQuote);
      setEmailDialogVisible(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to copy to clipboard');
    }
  };

  const renderQuoteCard = useCallback(({ item: quote, index }: { item: Quote; index: number }) => (
    <AnimatedListItem index={index}>
      <QuoteCard
        quote={quote}
        businessSettings={businessSettings}
        onView={handleViewQuote}
        onEdit={handleEditQuote}
        onDelete={handleDeleteQuote}
        onDuplicate={handleDuplicateQuote}
        onSave={saveQuote}
        onStatusChange={handleOpenStatusSheet}
        onEmailDialogOpen={handleOpenEmailDialog}
        onConvertToInvoice={handleConvertToInvoice}
      />
    </AnimatedListItem>
  ), [businessSettings, handleViewQuote, handleEditQuote, handleDeleteQuote, handleDuplicateQuote, saveQuote, handleOpenStatusSheet, handleOpenEmailDialog, handleConvertToInvoice]);

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
        {([
          { key: 'all', label: 'All' },
          { key: 'draft', label: 'Draft' },
          { key: 'sent', label: 'Sent' },
          { key: 'accepted', label: 'Accepted' },
          { key: 'completed', label: 'Completed' },
        ] as const).map(({ key, label }) => {
          const count = key === 'all' ? quotes.length : quotes.filter(q => q.status === key).length;
          return (
            <Chip
              key={key}
              selected={filterStatus === key}
              onPress={() => {
                lightTap();
                setFilterStatus(key);
              }}
              style={styles.filterChip}
            >
              {label}{count > 0 ? ` (${count})` : ''}
            </Chip>
          );
        })}
      </View>
      </WebContainer>

      {/* Quotes List */}
      <WebContainer style={styles.listContainer}>
        <FlatList
          ref={listRef}
          data={filteredQuotes}
          renderItem={renderQuoteCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          style={styles.flatList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
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
        accessibilityLabel="Create new quote"
      />

      {/* Status Sheet */}
      <StatusSheet
        visible={statusSheetVisible}
        onDismiss={() => {
          setStatusSheetVisible(false);
          setSelectedQuote(null);
        }}
        currentStatus={selectedQuote?.status || 'draft'}
        onSelect={handleStatusSelect}
        options={QUOTE_STATUS_OPTIONS}
      />

      {/* Email Client Selector Dialog */}
      <Portal>
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
    paddingBottom: 100,
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
    bottom: 96,
    backgroundColor: colors.primary,
  },
});
