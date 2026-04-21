/**
 * Documents List Screen
 *
 * Unified feed showing both quotes and invoices in a single list, with
 * type/stage chip filters. The visible payoff of the documents refactor —
 * tradies see all their work in one place. Reuses DocumentCard for parity
 * with the existing list screens.
 */

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, FlatList, Alert, RefreshControl } from 'react-native';
import { Text, Searchbar, Chip, FAB } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useScrollToTop } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import type { Document } from '../types/document';
import type { Quote, Invoice } from '../types';
import { documentToQuote, documentToInvoice } from '../types/documentAdapter';
import { colors } from '../theme';
import { WebContainer } from '../components/WebContainer';
import { DocumentCard } from '../components/DocumentCard';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { SkeletonCardList } from '../components/SkeletonCard';
import { SkeletonCrossfade } from '../components/SkeletonCrossfade';
import { StatusSheet, QUOTE_STATUS_OPTIONS } from '../components/StatusSheet';
import { lightTap } from '../utils/haptics';

type FilterKind = 'all' | 'quotes' | 'invoices' | 'drafts' | 'sent' | 'paid';

const FILTERS: { key: FilterKind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'sent', label: 'Sent' },
  { key: 'paid', label: 'Paid' },
];

function matchesFilter(doc: Document, filter: FilterKind): boolean {
  switch (filter) {
    case 'all': return true;
    case 'quotes':
      return doc.type === 'quote'
        || ['draft', 'quote_sent', 'quote_accepted', 'quote_rejected'].includes(doc.stage);
    case 'invoices':
      return doc.type === 'invoice'
        || ['invoice_sent', 'partially_paid', 'paid'].includes(doc.stage);
    case 'drafts':
      return doc.stage === 'draft';
    case 'sent':
      return doc.stage === 'quote_sent' || doc.stage === 'invoice_sent';
    case 'paid':
      return doc.stage === 'paid' || doc.stage === 'partially_paid';
    default:
      return true;
  }
}

export function DocumentsListScreen() {
  const listRef = useRef<FlatList>(null);
  useScrollToTop(listRef);

  const navigation = useNavigation<any>();
  const {
    documents,
    documentsLoaded,
    businessSettings,
    canCreateQuote,
    createNewQuote,
    deleteQuote,
    deleteInvoice,
    duplicateQuote,
    duplicateInvoice,
    saveQuote,
    saveInvoice,
    setCurrentQuote,
    setCurrentInvoice,
    createInvoiceFromQuote,
    loadDocuments,
    subscriptionStatus,
  } = useStore();

  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterKind>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(documentsLoaded || documents.length > 0);
  const [statusSheetVisible, setStatusSheetVisible] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);

  useEffect(() => {
    if (!initialLoaded && documents.length > 0) setInitialLoaded(true);
  }, [documents.length, initialLoaded]);

  useEffect(() => {
    if (!initialLoaded) {
      loadDocuments().then(() => setInitialLoaded(true));
    }
  }, []);

  const filtered = useMemo(() => {
    return documents.filter((d) => {
      if (!matchesFilter(d, filter)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          d.customerName.toLowerCase().includes(q) ||
          d.job?.name?.toLowerCase().includes(q) ||
          (d.job?.description || '').toLowerCase().includes(q) ||
          (d.number || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [documents, filter, searchQuery]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadDocuments();
    } finally {
      setRefreshing(false);
    }
  };

  const handleNew = () => {
    if (!canCreateQuote()) {
      navigation.navigate('Paywall' as never);
      return;
    }
    createNewQuote();
    navigation.navigate('NewQuote' as never);
  };

  const handleView = (id: string) => {
    const doc = documents.find((d) => d.id === id);
    if (!doc) return;
    if (doc.type === 'invoice') {
      navigation.navigate('ViewInvoice' as never, { invoiceId: id } as never);
    } else {
      navigation.navigate('ViewQuote' as never, { quoteId: id } as never);
    }
  };

  const handleEdit = (doc: Document) => {
    if (doc.type === 'invoice') {
      const invoice = documentToInvoice(doc);
      setCurrentInvoice(invoice);
      navigation.navigate('ViewInvoice' as never, { invoiceId: invoice.id } as never);
    } else {
      const quote = documentToQuote(doc);
      setCurrentQuote(quote);
      navigation.navigate('NewQuote' as never);
    }
  };

  const handleDelete = async (id: string) => {
    const doc = documents.find((d) => d.id === id);
    if (!doc) return;
    if (doc.type === 'invoice') {
      await deleteInvoice(id);
    } else {
      await deleteQuote(id);
    }
  };

  const handleDuplicate = async (doc: Document) => {
    if (doc.type === 'invoice') {
      const invoice = documentToInvoice(doc);
      await duplicateInvoice(invoice);
    } else {
      const quote = documentToQuote(doc);
      await duplicateQuote(quote);
    }
  };

  const handleSave = (doc: Document) => {
    if (doc.type === 'invoice') {
      saveInvoice(documentToInvoice(doc));
    } else {
      saveQuote(documentToQuote(doc));
    }
  };

  const handleConvert = async (doc: Document) => {
    if (!isPro) {
      navigation.navigate('Paywall' as never);
      return;
    }
    try {
      const quote = documentToQuote(doc);
      const invoice = await createInvoiceFromQuote(quote);
      await saveInvoice(invoice);
      navigation.navigate('ViewInvoice' as never, { invoiceId: invoice.id } as never);
    } catch {
      Alert.alert('Error', 'Failed to convert to invoice. Please try again.');
    }
  };

  const handleRecordPayment = (doc: Document) => {
    navigation.navigate('RecordPayment' as never, { invoiceId: doc.id } as never);
  };

  const handleOpenStatusSheet = (doc: Document) => {
    if (doc.type !== 'quote') return;
    setSelectedQuote(documentToQuote(doc));
    setStatusSheetVisible(true);
  };

  const handleStatusSelect = async (newStatus: string) => {
    if (!selectedQuote) return;
    try {
      await saveQuote({
        ...selectedQuote,
        status: newStatus as Quote['status'],
        updatedAt: new Date(),
      });
    } catch {
      Alert.alert('Error', 'Failed to update quote status. Please try again.');
    }
    setStatusSheetVisible(false);
    setSelectedQuote(null);
  };

  const renderCard = useCallback(({ item, index }: { item: Document; index: number }) => (
    <AnimatedListItem index={index}>
      <DocumentCard
        doc={item}
        businessSettings={businessSettings}
        onView={handleView}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onSave={handleSave}
        onConvertToInvoice={item.type === 'quote' ? handleConvert : undefined}
        onRecordPayment={item.type === 'invoice' ? handleRecordPayment : undefined}
        onStatusChange={item.type === 'quote' ? handleOpenStatusSheet : undefined}
      />
    </AnimatedListItem>
  ), [businessSettings, documents]);

  return (
    <View style={styles.container}>
      <WebContainer>
        <Searchbar
          placeholder="Search documents..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
        />

        <View style={styles.filterRow}>
          {FILTERS.map(({ key, label }) => {
            const count = key === 'all'
              ? documents.length
              : documents.filter((d) => matchesFilter(d, key)).length;
            return (
              <Chip
                key={key}
                selected={filter === key}
                onPress={() => {
                  lightTap();
                  setFilter(key);
                }}
                style={styles.filterChip}
              >
                {label}{count > 0 ? ` (${count})` : ''}
              </Chip>
            );
          })}
        </View>
      </WebContainer>

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
            data={filtered}
            renderItem={renderCard}
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
                  <MaterialCommunityIcons name={"file-document-multiple-outline" as any} size={36} color={colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>
                  {filter === 'all' && "Nothing in the books yet"}
                  {filter === 'quotes' && "No quotes around here"}
                  {filter === 'invoices' && "No invoices around here"}
                  {filter === 'drafts' && "No drafts gathering dust"}
                  {filter === 'sent' && "Nothing waiting on a reply"}
                  {filter === 'paid' && "No payments rolling in yet"}
                </Text>
                <Text style={styles.emptyText}>
                  {filter === 'all' && "Quotes and invoices both show up here"}
                  {filter === 'quotes' && "Drum up some work and they'll appear"}
                  {filter === 'invoices' && "Convert a quote when the job's done"}
                  {filter === 'drafts' && "Either nothing's started or everything's sent"}
                  {filter === 'sent' && "All quiet on the customer front"}
                  {filter === 'paid' && "Chase up those invoices, mate"}
                </Text>
                <Text style={styles.emptySubtext}>
                  {filter === 'all'
                    ? "Tap + to start your first quote"
                    : "Try another filter or tap + to start one"}
                </Text>
              </View>
            }
          />
        </SkeletonCrossfade>
      </WebContainer>

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={handleNew}
        color={colors.white}
        accessibilityLabel="Create new document"
      />

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
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
  filterChip: { backgroundColor: colors.surface },
  listContainer: { flex: 1 },
  flatList: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 100 },
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
    position: 'absolute',
    right: 16,
    bottom: 96,
    backgroundColor: colors.primary,
  },
});
