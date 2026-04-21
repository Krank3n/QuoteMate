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
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, useScrollToTop } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import { Quote } from '../types';
import { documentToQuote } from '../types/documentAdapter';
import { colors } from '../theme';
import { WebContainer } from '../components/WebContainer';
import { DocumentCard } from '../components/DocumentCard';
import { quoteToDocument } from '../types/documentAdapter';
import type { Document, DocumentStage } from '../types/document';
import { AlertModal } from '../components/AlertModal';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { SkeletonCardList } from '../components/SkeletonCard';
import { SkeletonCrossfade } from '../components/SkeletonCrossfade';
import { StageSheet } from '../components/StageSheet';
import { applyStageChange } from '../utils/applyStageChange';
import { lightTap } from '../utils/haptics';

type FilterStatus = 'all' | 'draft' | 'sent' | 'accepted' | 'rejected' | 'completed';

export function QuotesListScreen() {
  const listRef = useRef<FlatList>(null);
  useScrollToTop(listRef);

  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { quotes: legacyQuotes, documents, documentsLoaded, deleteQuote, duplicateQuote, setCurrentQuote, createNewQuote, saveQuote, businessSettings, canCreateQuote, createInvoiceFromQuote, saveInvoice, loadQuotes, subscriptionStatus } = useStore();

  // Read from the unified documents collection. Filter to quote-side stages
  // and project back to the typed Quote shape via the canonical adapter so
  // the rest of this screen can stay unchanged. Falls back to the legacy
  // slice when the documents listener hasn't filled in yet (first paint or
  // pre-mirror data).
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

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(route.params?.filter || 'all');

  // Update filter when navigating with a filter param
  useEffect(() => {
    if (route.params?.filter) {
      setFilterStatus(route.params.filter);
    }
  }, [route.params?.filter]);
  const [stageSheetVisible, setStageSheetVisible] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(quotes.length > 0);
  const [duplicateSuccessVisible, setDuplicateSuccessVisible] = useState(false);

  useEffect(() => {
    if (!initialLoaded && quotes.length > 0) setInitialLoaded(true);
  }, [quotes.length, initialLoaded]);

  // Mark loaded after first refresh completes even if empty
  useEffect(() => {
    if (!initialLoaded) {
      loadQuotes().then(() => setInitialLoaded(true));
    }
  }, []);

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

  const handleOpenStageSheet = (doc: Document) => {
    setSelectedDoc(doc);
    setStageSheetVisible(true);
  };

  const handleStageSelect = async (target: DocumentStage) => {
    if (!selectedDoc) return;
    setStageSheetVisible(false);
    if (target === 'invoice_sent' && selectedDoc.type === 'quote' && !isPro) {
      navigation.navigate('Paywall' as never);
      setSelectedDoc(null);
      return;
    }
    try {
      await applyStageChange(selectedDoc, target, {
        saveQuote,
        saveInvoice,
        createInvoiceFromQuote,
        navigation,
      });
    } catch {
      Alert.alert('Error', 'Failed to update stage. Please try again.');
    }
    setSelectedDoc(null);
  };

  const handleDuplicateQuote = async (quote: Quote) => {
    // Check if user can create a new quote
    if (!canCreateQuote()) {
      navigation.navigate('Paywall' as never);
      return;
    }

    try {
      await duplicateQuote(quote);
      setDuplicateSuccessVisible(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to duplicate quote. Please try again.');
    }
  };

  const renderQuoteCard = useCallback(({ item: quote, index }: { item: Quote; index: number }) => {
    // Project the typed Quote back into the unified Document for the new card.
    // The quote came from documents anyway (via the screen-level memo), so this
    // is a round-trip; cheap, and keeps the card 100% type-driven.
    const doc: Document = quoteToDocument(quote);
    return (
      <AnimatedListItem index={index}>
        <DocumentCard
          doc={doc}
          businessSettings={businessSettings}
          onView={handleViewQuote}
          onEdit={() => handleEditQuote(quote)}
          onDelete={handleDeleteQuote}
          onDuplicate={() => handleDuplicateQuote(quote)}
          onSave={() => saveQuote(quote)}
          onStatusChange={handleOpenStageSheet}
        />
      </AnimatedListItem>
    );
  }, [businessSettings, handleViewQuote, handleEditQuote, handleDeleteQuote, handleDuplicateQuote, saveQuote, handleOpenStageSheet]);

  return (
    <View style={styles.container}>
      {/* Duplicate Success */}
      <AlertModal
        visible={duplicateSuccessVisible}
        onDismiss={() => setDuplicateSuccessVisible(false)}
        type="success"
        title="Quote Duplicated"
        message="Quote duplicated successfully!"
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
                <View style={styles.emptyIconCircle}>
                  <MaterialCommunityIcons name={"file-document-plus-outline" as any} size={36} color={colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>
                  {filterStatus === 'all' && "Nothing here yet, chief"}
                  {filterStatus === 'draft' && "No drafts gathering dust"}
                  {filterStatus === 'sent' && "Nothing out in the wild"}
                  {filterStatus === 'accepted' && "No one's said yes... yet"}
                  {filterStatus === 'rejected' && "Clean slate, no knockbacks"}
                  {filterStatus === 'completed' && "No jobs wrapped up yet"}
                </Text>
                <Text style={styles.emptyText}>
                  {filterStatus === 'all' && "Time to drum up some work"}
                  {filterStatus === 'draft' && "You've fired off everything — good on ya"}
                  {filterStatus === 'sent' && "Either no one's got a quote or they're all sorted"}
                  {filterStatus === 'accepted' && "Send a few out and she'll be right"}
                  {filterStatus === 'rejected' && "No one's given you the flick — beauty!"}
                  {filterStatus === 'completed' && "Finish a job and it'll show up here, legend"}
                </Text>
                <Text style={styles.emptySubtext}>
                  {filterStatus === 'all'
                    ? "Tap + to bang out your first quote"
                    : "Try another filter or tap + to whip one up"}
                </Text>
              </View>
            }
          />
        </SkeletonCrossfade>
      </WebContainer>

      {/* New Quote FAB */}
      <FAB
        icon="plus"
        style={styles.fab}
        onPress={handleNewQuote}
        color={colors.white}
        accessibilityLabel="Create new quote"
      />

      {/* Stage Sheet */}
      {selectedDoc && (
        <StageSheet
          visible={stageSheetVisible}
          onDismiss={() => {
            setStageSheetVisible(false);
            setSelectedDoc(null);
          }}
          doc={selectedDoc}
          onSelect={handleStageSelect}
        />
      )}

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
    position: 'absolute',
    right: 16,
    bottom: 96,
    backgroundColor: colors.primary,
  },
});
