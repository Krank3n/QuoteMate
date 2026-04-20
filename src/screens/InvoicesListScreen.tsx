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
  Menu,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect, useScrollToTop } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import { Invoice, Quote } from '../types';
import { documentToInvoice, documentToQuote } from '../types/documentAdapter';
import { colors } from '../theme';
import { WebContainer } from '../components/WebContainer';
import { DocumentCard } from '../components/DocumentCard';
import { invoiceToDocument } from '../types/documentAdapter';
import type { Document } from '../types/document';
import { ProBadge } from '../components/ProBadge';
import { isInvoiceOverdue } from '../utils/invoiceCalculator';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { SkeletonCardList } from '../components/SkeletonCard';
import { SkeletonCrossfade } from '../components/SkeletonCrossfade';
import { QuoteSelectSheet } from '../components/QuoteSelectSheet';

type FilterStatus = 'all' | 'draft' | 'sent' | 'paid' | 'overdue';

const EMPTY_MESSAGES = [
  { title: 'No invoices yet', subtitle: "Your invoice list is wide open" },
  { title: 'Nothing to collect', subtitle: "Time to send someone a bill" },
  { title: 'All quiet here', subtitle: "Your invoice list is feeling lonely" },
  { title: 'Zero invoices', subtitle: "Let's change that, shall we?" },
  { title: 'Tumbleweeds...', subtitle: "Not a single invoice in sight" },
];

export function InvoicesListScreen() {
  const listRef = useRef<FlatList>(null);
  useScrollToTop(listRef);

  const navigation = useNavigation<any>();
  const {
    invoices: legacyInvoices,
    quotes: legacyQuotes,
    documents,
    documentsLoaded,
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

  // Derive the displayed invoices/quotes from the unified documents
  // collection, falling back to the legacy slices when the documents
  // listener hasn't filled in yet.
  const invoices = useMemo<Invoice[]>(() => {
    if (!documentsLoaded || documents.length === 0) {
      return legacyInvoices;
    }
    const fromDocs = documents
      .filter((d) => d.type === 'invoice')
      .map((d) => documentToInvoice(d));
    return fromDocs.length > 0 ? fromDocs : legacyInvoices;
  }, [documents, documentsLoaded, legacyInvoices]);

  const quotes = useMemo<Quote[]>(() => {
    if (!documentsLoaded || documents.length === 0) {
      return legacyQuotes;
    }
    const QUOTE_STAGES = new Set(['draft', 'quote_sent', 'quote_accepted', 'quote_rejected']);
    const fromDocs = documents
      .filter((d) => d.type === 'quote' || QUOTE_STAGES.has(d.stage))
      .map((d) => documentToQuote(d));
    return fromDocs.length > 0 ? fromDocs : legacyQuotes;
  }, [documents, documentsLoaded, legacyQuotes]);
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const emptyMessage = useMemo(() => EMPTY_MESSAGES[Math.floor(Math.random() * EMPTY_MESSAGES.length)], []);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [fabOpen, setFabOpen] = useState(false);
  const [quoteDialogVisible, setQuoteDialogVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(invoices.length > 0);

  useEffect(() => {
    if (!initialLoaded && invoices.length > 0) setInitialLoaded(true);
  }, [invoices.length, initialLoaded]);

  // Load invoices on mount
  useEffect(() => {
    loadInvoices().then(() => setInitialLoaded(true));
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
    const invoice = await createInvoiceFromQuote(quote);
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

  const handleExportCSV = async () => {
    setFabOpen(false);
    const exportable = invoices.filter((inv) => inv.status !== 'draft');
    if (exportable.length === 0) {
      Alert.alert('No Invoices', 'You need at least one non-draft invoice to export.');
      return;
    }
    try {
      const { exportInvoicesToCSV } = await import('../services/csvExportService');
      await exportInvoicesToCSV(exportable);
    } catch (error) {
      Alert.alert('Export Failed', 'Could not export invoices. Please try again.');
    }
  };

  const renderInvoiceCard = useCallback(({ item: invoice, index }: { item: Invoice; index: number }) => {
    const doc: Document = invoiceToDocument(invoice);
    return (
      <AnimatedListItem index={index}>
        <DocumentCard
          doc={doc}
          businessSettings={businessSettings}
          onView={handleViewInvoice}
          onEdit={() => handleEditInvoice(invoice)}
          onDelete={handleDeleteInvoice}
          onDuplicate={() => handleDuplicateInvoice(invoice)}
          onSave={() => saveInvoice(invoice)}
          onRecordPayment={() => handleRecordPayment(invoice)}
        />
      </AnimatedListItem>
    );
  }, [businessSettings, handleViewInvoice, handleEditInvoice, handleDeleteInvoice, handleRecordPayment, saveInvoice, handleDuplicateInvoice]);

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
        <SkeletonCrossfade
          loaded={initialLoaded}
          skeleton={
            <View style={{ padding: 16 }}>
              <SkeletonCardList count={4} />
            </View>
          }
        >
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
                <View style={styles.emptyIconCircle}>
                  <MaterialCommunityIcons name={"receipt-text-outline" as any} size={36} color={colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>
                  {filterStatus === 'all' && emptyMessage.title}
                  {filterStatus === 'draft' && "No drafts lying around"}
                  {filterStatus === 'sent' && "Nothing waiting on payment"}
                  {filterStatus === 'paid' && "No one's coughed up yet"}
                  {filterStatus === 'overdue' && "No one owes ya — stoked!"}
                </Text>
                <Text style={styles.emptyText}>
                  {filterStatus === 'all' && emptyMessage.subtitle}
                  {filterStatus === 'draft' && "You're either on top of it or haven't started"}
                  {filterStatus === 'sent' && "Send a bill and play the waiting game"}
                  {filterStatus === 'paid' && "Time to chase up some invoices, mate"}
                  {filterStatus === 'overdue' && "Everyone's paid up — that's rarer than rocking horse poo"}
                </Text>
                <Text style={styles.emptySubtext}>
                  {filterStatus === 'all'
                    ? (isPro ? "Hit + and send someone a bill" : "Upgrade to Pro to start invoicing")
                    : "Try another filter or tap + to fire one off"}
                </Text>
                {!isPro && <View style={{ marginTop: 12 }}><ProBadge /></View>}
              </View>
            }
          />
        </SkeletonCrossfade>
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
          {
            icon: 'file-export',
            label: 'Export CSV (Xero)',
            onPress: handleExportCSV,
          },
        ]}
        onStateChange={({ open }) => setFabOpen(open)}
        fabStyle={styles.fab}
        color={colors.white}
      />

      {/* Quote Selection Sheet */}
      <QuoteSelectSheet
        visible={quoteDialogVisible}
        onDismiss={() => setQuoteDialogVisible(false)}
        onSelect={handleSelectQuote}
        quotes={convertibleQuotes}
      />
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
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  fab: {
    backgroundColor: colors.primary,
    marginBottom: 80,
  },
});
