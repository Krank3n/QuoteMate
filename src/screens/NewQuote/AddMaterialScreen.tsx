/**
 * Add Material Screen
 * Modern full-screen UX for adding materials with tabs for Search/Manual and Saved Items
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  Platform,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  ActivityIndicator,
  Divider,
  SegmentedButtons,
  Switch,
  IconButton,
  Chip,
} from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { generateId } from '../../utils/generateId';

import { useStore } from '../../store/useStore';
import { Material } from '../../types';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { bunningsApi } from '../../services/bunningsApi';
import { searchMaterialPrice } from '../../services/webSearchPricing';
import {
  searchMaterialWithWebScraping,
  getBestMatch,
} from '../../services/webScrapingPricing';
import {
  searchProductWithScraper,
} from '../../services/bunningsScraperService';
import {
  loadFavoritesFromLocal,
  saveFavoriteProduct,
  removeFavoriteProduct,
} from '../../services/materialFavorites';
import { BUNNINGS_SCRAPER_URL } from '@env';

type TabValue = 'search' | 'saved';

export function AddMaterialScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { currentQuote, updateQuote, businessSettings } = useStore();

  // Check if we're in edit mode
  const materialId = route.params?.materialId;
  const isEditMode = !!materialId;
  const editingMaterial = isEditMode
    ? currentQuote?.materials.find(m => m.id === materialId)
    : null;

  // Tab state
  const [activeTab, setActiveTab] = useState<TabValue>('search');

  // Search & Add tab state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Manual entry state - initialize with editing material if in edit mode
  const [manualName, setManualName] = useState(editingMaterial?.name || '');
  const [manualQuantity, setManualQuantity] = useState(
    editingMaterial?.quantity.toString() || '1'
  );
  const [manualUnit, setManualUnit] = useState<Material['unit']>(
    editingMaterial?.unit || 'each'
  );
  const [manualPrice, setManualPrice] = useState(
    editingMaterial?.price.toString() || ''
  );
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  // Update form when editing material changes
  React.useEffect(() => {
    if (editingMaterial) {
      setManualName(editingMaterial.name);
      setManualQuantity(editingMaterial.quantity.toString());
      setManualUnit(editingMaterial.unit);
      setManualPrice(editingMaterial.price.toString());
      setActiveTab('search'); // Start on manual entry area when editing
    }
  }, [editingMaterial]);

  // Saved items state
  const [savedItems, setSavedItems] = useState<any[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);

  // Load saved items when switching to saved tab
  useEffect(() => {
    if (activeTab === 'saved') {
      loadSavedItems();
    }
  }, [activeTab]);

  const loadSavedItems = async () => {
    setIsLoadingSaved(true);
    try {
      const favorites = await loadFavoritesFromLocal();
      const items = Object.entries(favorites).map(([key, fav]) => ({
        key,
        ...fav,
      }));
      setSavedItems(items);
    } catch (error) {
      console.error('Error loading saved items:', error);
    } finally {
      setIsLoadingSaved(false);
    }
  };

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      Alert.alert('Enter Search Term', 'Please enter a product name or description to search');
      return;
    }

    setIsSearching(true);
    setSearchResults([]);

    try {
      const selectedStore = businessSettings?.selectedStore || 'bunnings';
      const hardwareStores = businessSettings?.hardwareStores || ['bunnings.com.au'];
      const firstStore = hardwareStores[0];
      const useScraperApi = BUNNINGS_SCRAPER_URL ? true : false;

      const isBunnings = selectedStore === 'bunnings' || firstStore.includes('bunnings.com.au');

      if (isBunnings && useScraperApi) {
        console.log(`🔍 Searching Bunnings via scraper for: "${searchQuery}"`);

        const scraperResponse = await searchProductWithScraper(searchQuery, 10);

        if (scraperResponse && scraperResponse.success && scraperResponse.results.length > 0) {
          const products = scraperResponse.results.map(product => ({
            productName: product.productName,
            description: product.description || '',
            itemNumber: product.itemNumber || '',
            brand: product.brand || '',
            price: product.price,
            productUrl: product.productUrl,
            imageUrl: product.imageUrl,
            store: 'bunnings.com.au',
            stockLevel: product.stockLevel,
            isScraperResult: true,
            confidence: product.confidence,
          }));

          setSearchResults(products);
          console.log(`✅ Found ${products.length} products from scraper`);
        } else {
          // Fallback to web scraping method
          console.log('⚠️ Scraper returned no results, trying web scraping fallback...');
          const scraperResults = await searchMaterialWithWebScraping(
            searchQuery,
            searchQuery,
            1,
            'each',
            [firstStore]
          );

          const products = scraperResults.flatMap(r => r.matches).map(match => ({
            productName: match.productName,
            description: match.description || '',
            itemNumber: match.itemNumber || '',
            brand: match.brand || '',
            price: match.price,
            productUrl: match.productUrl,
            imageUrl: match.imageUrl,
            store: match.store,
            isScraperResult: true,
          }));

          setSearchResults(products);

          if (products.length === 0) {
            // Final fallback to AI estimation
            console.log('⚠️ Web scraping also returned no results, trying AI estimation...');
            const aiResult = await searchMaterialPrice(searchQuery, [firstStore]);

            if (aiResult.price) {
              const estimatedProduct = {
                productName: aiResult.productName || searchQuery,
                description: aiResult.store ? `Estimated from ${aiResult.store}` : 'AI Estimated Price',
                itemNumber: '',
                brand: '',
                price: aiResult.price,
                productUrl: undefined,
                imageUrl: undefined,
                store: aiResult.store || firstStore,
                isScraperResult: false,
                isAiEstimate: true,
              };
              setSearchResults([estimatedProduct]);
              console.log(`✅ AI estimation provided fallback result: $${aiResult.price}`);
            }
          }
        }
      } else if (isBunnings) {
        console.log(`🔍 Searching Bunnings via API for: "${searchQuery}"`);
        const results = await bunningsApi.searchItem(searchQuery, 20);
        setSearchResults(results.map(item => ({ ...item, isScraperResult: false })));
      } else {
        console.log(`🔍 Searching ${firstStore} via scraper for: "${searchQuery}"`);
        const scraperResults = await searchMaterialWithWebScraping(
          searchQuery,
          searchQuery,
          1,
          'each',
          [firstStore]
        );

        const products = scraperResults.flatMap(r => r.matches).map(match => ({
          productName: match.productName,
          description: match.description || '',
          itemNumber: match.itemNumber || '',
          brand: match.brand || '',
          price: match.price,
          productUrl: match.productUrl,
          imageUrl: match.imageUrl,
          store: match.store,
          isScraperResult: true,
        }));

        setSearchResults(products);

        if (products.length === 0) {
          const aiResult = await searchMaterialPrice(searchQuery, [firstStore]);

          if (aiResult.price) {
            const estimatedProduct = {
              productName: aiResult.productName || searchQuery,
              description: aiResult.store ? `Estimated from ${aiResult.store}` : 'AI Estimated Price',
              itemNumber: '',
              brand: '',
              price: aiResult.price,
              productUrl: undefined,
              imageUrl: undefined,
              store: aiResult.store || firstStore,
              isScraperResult: false,
              isAiEstimate: true,
            };
            setSearchResults([estimatedProduct]);
          }
        }
      }
    } catch (error) {
      console.error('Search error:', error);
      Alert.alert('Search Error', 'Failed to search products. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, businessSettings]);

  const handleSelectProduct = async (item: any) => {
    let newMaterial: Material;

    if (item.isAiEstimate) {
      newMaterial = {
        id: generateId(),
        name: item.productName,
        quantity: 1,
        unit: 'each',
        price: item.price || 0,
        totalPrice: item.price || 0,
        manualPriceOverride: false,
        searchTerm: item.productName,
        pricingSource: 'ai',
        description: item.description,
      };
    } else if (item.isScraperResult) {
      newMaterial = {
        id: generateId(),
        name: item.productName,
        quantity: 1,
        unit: 'each',
        bunningsItemNumber: item.itemNumber,
        price: item.price || 0,
        totalPrice: item.price || 0,
        manualPriceOverride: false,
        searchTerm: item.productName,
        pricingSource: 'scraper',
        productUrl: item.productUrl,
        imageUrl: item.imageUrl,
        description: item.description,
        brand: item.brand &&
               item.brand.toLowerCase() !== 'bunnings' &&
               item.brand.toLowerCase() !== 'bunnings.com.au'
          ? item.brand
          : undefined,
        stockLevel: item.stockLevel,
        stockCheckedAt: new Date().toISOString(),
      };
    } else {
      const price = await bunningsApi.getPrice(item.itemNumber);

      newMaterial = {
        id: generateId(),
        name: item.productName || item.description,
        quantity: 1,
        unit: 'each',
        bunningsItemNumber: item.itemNumber,
        price: price?.priceIncGst || 0,
        totalPrice: price?.priceIncGst || 0,
        manualPriceOverride: false,
        searchTerm: item.description,
        pricingSource: 'api',
      };
    }

    // Ask if user wants to save as template
    Alert.alert(
      'Material Added',
      'Would you like to save this as a template for future quotes?',
      [
        {
          text: 'No',
          style: 'cancel',
          onPress: () => {
            addMaterialToQuote(newMaterial);
          },
        },
        {
          text: 'Yes, Save Template',
          onPress: async () => {
            await saveFavoriteProduct(
              newMaterial.name,
              newMaterial.searchTerm,
              {
                productName: item.productName,
                store: item.store || 'bunnings.com.au',
                productUrl: item.productUrl,
                itemNumber: item.itemNumber,
                unit: newMaterial.unit,
                price: newMaterial.price,
                imageUrl: item.imageUrl,
              }
            );
            addMaterialToQuote(newMaterial);
          },
        },
      ]
    );
  };

  const handleAddManually = () => {
    if (!manualName.trim()) {
      Alert.alert('Enter Material Name', 'Please enter a material name');
      return;
    }

    const quantity = parseFloat(manualQuantity) || 1;
    const price = parseFloat(manualPrice) || 0;

    if (isEditMode && editingMaterial) {
      // Update existing material
      const updatedMaterial: Material = {
        ...editingMaterial,
        name: manualName.trim(),
        quantity,
        unit: manualUnit,
        price,
        totalPrice: price * quantity,
        manualPriceOverride: true,
        pricingSource: 'manual',
      };
      updateMaterialInQuote(updatedMaterial);
    } else {
      // Add new material
      const newMaterial: Material = {
        id: generateId(),
        name: manualName.trim(),
        quantity,
        unit: manualUnit,
        price,
        totalPrice: price * quantity,
        manualPriceOverride: true,
        pricingSource: 'manual',
      };

      if (saveAsTemplate) {
        saveFavoriteProduct(
          newMaterial.name,
          newMaterial.name,
          {
            productName: newMaterial.name,
            store: 'manual',
            unit: newMaterial.unit,
            price: newMaterial.price,
          }
        );
      }

      addMaterialToQuote(newMaterial);
    }
  };

  const handleSelectSavedItem = async (item: any) => {
    // Create material from saved template
    const price = item.price || 0;
    const newMaterial: Material = {
      id: generateId(),
      name: item.productName,
      quantity: 1,
      unit: (item.unit || 'each') as Material['unit'],
      price: price,
      totalPrice: price * 1,
      manualPriceOverride: false,
      searchTerm: item.productName,
      productUrl: item.productUrl,
      bunningsItemNumber: item.itemNumber,
      imageUrl: item.imageUrl,
      pricingSource: item.store === 'manual' ? 'manual' : 'scraper',
    };

    addMaterialToQuote(newMaterial);
  };

  const handleDeleteSavedItem = async (item: any) => {
    Alert.alert(
      'Delete Template',
      `Remove "${item.productName}" from saved templates?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await removeFavoriteProduct(item.productName, item.productName);
            loadSavedItems();
          },
        },
      ]
    );
  };

  const addMaterialToQuote = (material: Material) => {
    if (!currentQuote) return;

    updateQuote({
      ...currentQuote,
      materials: [...(currentQuote.materials || []), material],
    });

    // Navigate back
    navigation.goBack();
  };

  const updateMaterialInQuote = (updatedMaterial: Material) => {
    if (!currentQuote) return;

    const updatedMaterials = currentQuote.materials.map(m =>
      m.id === updatedMaterial.id ? updatedMaterial : m
    );

    updateQuote({
      ...currentQuote,
      materials: updatedMaterials,
    });

    // Navigate back
    navigation.goBack();
  };

  // Render Search & Add Tab
  const renderSearchTab = () => (
    <ScrollView style={styles.tabContent} keyboardShouldPersistTaps="handled">
      {/* Search Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Search Products</Text>
        <TextInput
          label="Search for materials"
          value={searchQuery}
          onChangeText={setSearchQuery}
          mode="outlined"
          placeholder="e.g., treated pine 90x45"
          style={styles.searchInput}
          right={
            <TextInput.Icon
              icon="magnify"
              onPress={handleSearch}
              disabled={isSearching}
            />
          }
          onSubmitEditing={handleSearch}
        />

        {isSearching && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Searching...</Text>
          </View>
        )}

        {searchResults.length > 0 && (
          <View style={styles.resultsContainer}>
            <Text style={styles.resultsHeader}>
              Found {searchResults.length} products:
            </Text>
            <FlatList
              data={searchResults}
              keyExtractor={(item, index) => item.itemNumber || `result-${index}`}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.resultItem}
                  onPress={() => handleSelectProduct(item)}
                >
                  {item.imageUrl && (
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={styles.resultImage}
                      resizeMode="contain"
                    />
                  )}
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultName}>
                      {item.productName || item.description}
                    </Text>
                    <Text style={styles.resultDetails}>
                      {item.itemNumber && `Item #: ${item.itemNumber}`}
                      {item.brand && item.brand.toLowerCase() !== 'bunnings' && ` • ${item.brand}`}
                    </Text>
                    {item.price > 0 && (
                      <Text style={styles.resultPrice}>
                        {formatCurrency(item.price)}
                      </Text>
                    )}
                    {item.isAiEstimate && (
                      <Chip
                        icon="robot"
                        mode="outlined"
                        compact
                        style={styles.aiChip}
                        textStyle={styles.aiChipText}
                      >
                        AI Estimate
                      </Chip>
                    )}
                  </View>
                  <IconButton icon="chevron-right" size={20} />
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <Divider />}
            />
          </View>
        )}
      </View>

      <Divider style={styles.divider} />

      {/* Manual Entry Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
          <Text style={styles.sectionTitle}>Can't find it? Add manually</Text>
        </View>

        <TextInput
          label="Material Name *"
          value={manualName}
          onChangeText={setManualName}
          mode="outlined"
          style={styles.input}
          placeholder="e.g., Custom timber piece"
        />

        <View style={styles.row}>
          <TextInput
            label="Quantity *"
            value={manualQuantity}
            onChangeText={setManualQuantity}
            mode="outlined"
            keyboardType="decimal-pad"
            style={[styles.input, styles.halfWidth]}
          />

          <TextInput
            label="Price per Unit"
            value={manualPrice}
            onChangeText={setManualPrice}
            mode="outlined"
            keyboardType="decimal-pad"
            left={<TextInput.Affix text="$" />}
            style={[styles.input, styles.halfWidth]}
          />
        </View>

        <View style={styles.unitSelector}>
          <Text style={styles.unitLabel}>Unit</Text>
          <View style={styles.unitButtons}>
            <SegmentedButtons
              value={manualUnit}
              onValueChange={(value) => setManualUnit(value as Material['unit'])}
              buttons={[
                { value: 'each', label: 'Each' },
                { value: 'm', label: 'M' },
                { value: 'L', label: 'L' },
              ]}
              style={styles.unitRow}
            />
            <SegmentedButtons
              value={manualUnit}
              onValueChange={(value) => setManualUnit(value as Material['unit'])}
              buttons={[
                { value: 'kg', label: 'Kg' },
                { value: 'box', label: 'Box' },
                { value: 'pack', label: 'Pack' },
              ]}
              style={styles.unitRow}
            />
          </View>
        </View>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Save as template for future quotes</Text>
          <Switch
            value={saveAsTemplate}
            onValueChange={setSaveAsTemplate}
            color={colors.primary}
          />
        </View>

        <Button
          mode="contained"
          onPress={handleAddManually}
          style={styles.addButton}
          icon={isEditMode ? "check" : "plus"}
        >
          {isEditMode ? 'Update Material' : 'Add to Quote'}
        </Button>
      </View>
    </ScrollView>
  );

  // Render Saved Items Tab
  const renderSavedTab = () => (
    <View style={styles.tabContent}>
      {isLoadingSaved ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading saved items...</Text>
        </View>
      ) : savedItems.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="star-outline" size={64} color={colors.onSurface} />
          <Text style={styles.emptyStateTitle}>No Saved Templates</Text>
          <Text style={styles.emptyStateText}>
            Save materials from the Search tab to quickly add them to future quotes
          </Text>
        </View>
      ) : (
        <FlatList
          data={savedItems}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.savedList}
          renderItem={({ item }) => (
            <View style={styles.savedItem}>
              <TouchableOpacity
                style={styles.savedItemContent}
                onPress={() => handleSelectSavedItem(item)}
              >
                {item.imageUrl ? (
                  <Image
                    source={{ uri: item.imageUrl }}
                    style={styles.savedItemImage}
                    resizeMode="contain"
                  />
                ) : (
                  <MaterialCommunityIcons
                    name="star"
                    size={24}
                    color={colors.primary}
                    style={styles.savedIcon}
                  />
                )}
                <View style={styles.savedInfo}>
                  <Text style={styles.savedName}>{item.productName}</Text>
                  <Text style={styles.savedDetails}>
                    {item.store && item.store !== 'manual' && `${item.store}`}
                    {item.itemNumber && ` • Item #: ${item.itemNumber}`}
                  </Text>
                  {item.price && item.price > 0 && (
                    <Text style={styles.savedPrice}>
                      Last price: {formatCurrency(item.price)}
                    </Text>
                  )}
                </View>
                <IconButton icon="chevron-right" size={20} />
              </TouchableOpacity>
              <IconButton
                icon="delete"
                size={20}
                iconColor={colors.error}
                onPress={() => handleDeleteSavedItem(item)}
              />
            </View>
          )}
          ItemSeparatorComponent={() => <Divider />}
        />
      )}
    </View>
  );

  // Update screen title based on mode
  React.useEffect(() => {
    navigation.setOptions({
      title: isEditMode ? 'Edit Material' : 'Add Material',
    });
  }, [isEditMode, navigation]);

  return (
    <View style={styles.container}>
      {/* Tab Selector */}
      <View style={styles.tabBar}>
        <SegmentedButtons
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as TabValue)}
          buttons={[
            {
              value: 'search',
              label: 'Search & Add',
              icon: 'magnify',
            },
            {
              value: 'saved',
              label: 'Saved Items',
              icon: 'star',
            },
          ]}
        />
      </View>

      {/* Tab Content */}
      {activeTab === 'search' ? renderSearchTab() : renderSavedTab()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  tabBar: {
    padding: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabContent: {
    flex: 1,
  },
  section: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  searchInput: {
    marginBottom: 16,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    marginLeft: 12,
    fontSize: 14,
    color: colors.onSurface,
  },
  resultsContainer: {
    marginTop: 8,
  },
  resultsHeader: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
    color: colors.onSurface,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  resultImage: {
    width: 60,
    height: 60,
    marginRight: 12,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 4,
    color: colors.text,
  },
  resultDetails: {
    fontSize: 12,
    color: colors.onSurface,
    marginBottom: 4,
  },
  resultPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 4,
  },
  aiChip: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  aiChipText: {
    fontSize: 10,
  },
  divider: {
    marginVertical: 8,
  },
  input: {
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  unitSelector: {
    marginBottom: 16,
  },
  unitLabel: {
    fontSize: 12,
    color: colors.onSurface,
    marginBottom: 8,
    marginLeft: 4,
  },
  unitButtons: {
    gap: 8,
  },
  unitRow: {
    marginBottom: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingVertical: 8,
  },
  toggleLabel: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
    marginRight: 12,
  },
  addButton: {
    marginTop: 8,
  },
  savedList: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  savedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginBottom: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  savedItemContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  savedIcon: {
    marginRight: 12,
  },
  savedItemImage: {
    width: 50,
    height: 50,
    marginRight: 12,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  savedInfo: {
    flex: 1,
  },
  savedName: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 4,
    color: colors.text,
  },
  savedDetails: {
    fontSize: 12,
    color: colors.onSurface,
    marginBottom: 2,
  },
  savedPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 20,
  },
});
