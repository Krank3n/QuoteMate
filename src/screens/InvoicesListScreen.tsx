/**
 * Invoices List Screen
 * Display all invoices with search and filter
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
  Menu,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect, useScrollToTop } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import { Invoice, Quote } from '../types';
import { colors } from '../theme';
import { WebContainer } from '../components/WebContainer';
import { InvoiceCard } from '../components/InvoiceCard';
import { ProBadge } from '../components/ProBadge';
import { isInvoiceOverdue } from '../utils/invoiceCalculator';
import { AnimatedListItem } from '../components/AnimatedListItem';

type FilterStatus = 'all' | 'draft' | 'sent' | 'paid' | 'overdue';

export function InvoicesListScreen() {
  const listRef = useRef<FlatList>(null);
  useScrollToTop(listRef);

  const navigation = useNavigation<any>();
  const {
    invoices,
    quotes,
    deleteInvoice,
    setCurrentInvoice,
    createNewInvoice,
    createInvoiceFromQuote,
    saveInvoice,
    duplicateInvoice,
    businessSettings,
    loadInvoices,
    loadNextInvoiceNumber,
    subscriptionStatus,
  } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [fabOpen, setFabOpen] = useState(false);
  const [quoteDialogVisible, setQuoteDialogVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Load invoices on mount
  useEffect(() => {
    loadInvoices();
    loadNextInvoiceNumber();
  }, []);

  // Refresh invoices when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      loadInvoices();
    }, [loadInvoices])
  );

  // Get convertible quotes (accepted or sent)
  const convertibleQuotes = useMemo(() => quotes.filter(
    (q) => q.status === 'accepted' || q.status === 'sent' || q.status === 'completed'
  ), [quotes]);

  // Apply overdue status to all invoices (used for both filtering and chip counts)
  const invoicesWithStatus = useMemo(() => invoices.map((invoice) => {
    if (isInvoiceOverdue(invoice) && invoice.status !== 'paid' && invoice.status !== 'cancelled') {
      return { ...invoice, status: 'overdue' as const };
    }
    return invoice;
  }), [invoices]);

  // Filter and search invoices
  const filteredInvoices = useMemo(() => invoicesWithStatus
    .filter((invoice) => {
      // Status filter
      if (filterStatus !== 'all' && invoice.status !== filterStatus) {
        return false;
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          invoice.customerName.toLowerCase().includes(query) ||
          invoice.job.name.toLowerCase().includes(query) ||
          (invoice.invoiceNumber?.toLowerCase().includes(query) || false)
        );
      }

      return true;
    }), [invoicesWithStatus, filterStatus, searchQuery]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadInvoices();
    } finally {
      setRefreshing(false);
    }
  };

  const handleNewInvoice = () => {
    setFabOpen(false);
    if (!isPro) {
      navigation.navigate('Paywall' as never);
      return;
    }
    createNewInvoice();
    navigation.navigate('NewInvoice' as never, { screen: 'JobDetails' } as never);
  };

  const handleConvertFromQuote = () => {
    setFabOpen(false);
    if (!isPro) {
      navigation.navigate('Paywall' as never);
      return;
    }
    if (convertibleQuotes.length === 0) {
      Alert.alert(
        'No Quotes Available',
        'You need accepted or sent quotes to convert to an invoice. Create and accept a quote first.'
      );
      return;
    }
    setQuoteDialogVisible(true);
  };

  const handleSelectQuote = async (quote: Quote) => {
    setQuoteDialogVisible(false);
    const invoice = createInvoiceFromQuote(quote);
    await saveInvoice(invoice);
    navigation.navigate('ViewInvoice' as never, { invoiceId: invoice.id } as never);
  };

  const handleViewInvoice = (invoiceId: string) => {
    navigation.navigate('ViewInvoice' as never, { invoiceId } as never);
  };

  const handleEditInvoice = (invoice: Invoice) => {
    setCurrentInvoice(invoice);
    navigation.navigate('ViewInvoice' as never, { invoiceId: invoice.id } as never);
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    await deleteInvoice(invoiceId);
  };

  const handleRecordPayment = (invoice: Invoice) => {
    navigation.navigate('RecordPayment' as never, { invoiceId: invoice.id } as never);
  };

  const handleDuplicateInvoice = async (invoice: Invoice) => {
    try {
      const newInvoice = await duplicateInvoice(invoice);
      navigation.navigate('ViewInvoice' as never, { invoiceId: newInvoice.id } as never);
    } catch (error) {
      Alert.alert('Error', 'Failed to duplicate invoice. Please try again.');
    }
  };

  const renderInvoiceCard = useCallback(({ item: invoice, index }: { item: Invoice; index: number }) => (
    <AnimatedListItem index={index}>
      <InvoiceCard
        invoice={invoice}
        businessSettings={businessSettings}
        onView={handleViewInvoice}
        onEdit={handleEditInvoice}
        onDelete={handleDeleteInvoice}
        onRecordPayment={handleRecordPayment}
        onSave={saveInvoice}
        onDuplicate={handleDuplicateInvoice}
      />
    </AnimatedListItem>
  ), [businessSettings, handleViewInvoice, handleEditInvoice, handleDeleteInvoice, handleRecordPayment, saveInvoice, handleDuplicateInvoice]);

  return (
    <View style={styles.container}>
      <WebContainer>
        {/* Search Bar */}
        <Searchbar
          placeholder="Search invoices..."
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
            { key: 'paid', label: 'Paid' },
            { key: 'overdue', label: 'Overdue' },
          ] as const).map(({ key, label }) => {
            const count = key === 'all'
              ? invoices.length
              : invoicesWithStatus.filter(i => i.status === key).length;
            return (
              <Chip
                key={key}
                selected={filterStatus === key}
                onPress={() => setFilterStatus(key)}
                style={styles.filterChip}
              >
                {label}{count > 0 ? ` (${count})` : ''}
              </Chip>
            );
          })}
        </View>
      </WebContainer>

      {/* Invoices List */}
      <WebContainer style={styles.listContainer}>
        <FlatList
          ref={listRef}
          data={filteredInvoices}
          renderItem={renderInvoiceCard}
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
                name="receipt"
                size={64}
                color={colors.disabled}
              />
              <Text style={styles.emptyText}>No invoices found</Text>
              <Text style={styles.emptySubtext}>
                {isPro ? 'Create an invoice or convert a quote' : 'Upgrade to Pro to create invoices'}
              </Text>
              {!isPro && <View style={{ marginTop: 12 }}><ProBadge /></View>}
            </View>
          }
        />
      </WebContainer>

      {/* FAB with Menu */}
      <FAB.Group
        open={fabOpen}
        visible
        icon={fabOpen ? 'close' : 'plus'}
        actions={[
          {
            icon: 'file-document-edit',
            label: 'New Invoice',
            onPress: handleNewInvoice,
          },
          {
            icon: 'file-replace',
            label: 'Convert from Quote',
            onPress: handleConvertFromQuote,
          },
        ]}
        onStateChange={({ open }) => setFabOpen(open)}
        fabStyle={styles.fab}
        color={colors.white}
      />

      {/* Quote Selection Dialog */}
      <Portal>
        <Dialog
          visible={quoteDialogVisible}
          onDismiss={() => setQuoteDialogVisible(false)}
          style={styles.dialog}
        >
          <Dialog.Title>Select Quote to Convert</Dialog.Title>
          <Dialog.ScrollArea style={styles.dialogScrollArea}>
            {convertibleQuotes.map((quote) => (
              <Button
                key={quote.id}
                mode="outlined"
                onPress={() => handleSelectQuote(quote)}
                style={styles.quoteButton}
                contentStyle={styles.quoteButtonContent}
              >
                <View style={styles.quoteButtonInner}>
                  <Text style={styles.quoteButtonTitle}>
                    {quote.quoteNumber || 'Quote'} - {quote.customerName}
                  </Text>
                  <Text style={styles.quoteButtonSubtitle}>{quote.job.name}</Text>
                </View>
              </Button>
            ))}
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setQuoteDialogVisible(false)}>Cancel</Button>
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
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
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
  emptySubtext: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
  },
  fab: {
    backgroundColor: colors.primary,
    marginBottom: 80,
  },
  dialog: {
    maxHeight: '70%',
  },
  dialogScrollArea: {
    paddingHorizontal: 16,
    maxHeight: 300,
  },
  quoteButton: {
    marginBottom: 8,
    borderColor: colors.border,
  },
  quoteButtonContent: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingVertical: 8,
  },
  quoteButtonInner: {
    width: '100%',
  },
  quoteButtonTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  quoteButtonSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
