/**
 * Add Material Screen
 * Modern full-screen UX for adding materials with tabs for Search/Manual and Saved Items
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
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
import { useCurrentDocument, useDocumentMode } from '../../utils/documentMode';
import { Material } from '../../types';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { ProBadge } from '../../components/ProBadge';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { WebContainer } from '../../components/WebContainer';
import { SwipeableCard } from '../../components/SwipeableCard';
import { BUNNINGS_SCRAPER_URL } from '@env';
import { TRADE_CATEGORIES } from '../../constants/tradeCategories';
import { useTourRefs } from '../../components/tour/useTourRefs';
import { ScreenTour } from '../../components/tour/ScreenTour';
import { notifyScreenComplete, notifySkipRequest } from '../../components/tour/UnifiedTourController';
import { PHASE_STEP_OFFSETS, UNIFIED_TOUR_TOTAL_STEPS } from '../../components/tour/tourFlow';

// Material categories for the picker (derived from trade categories)
const MATERIAL_CATEGORIES = [
  { id: '', name: 'No Category', icon: 'folder-outline' },
  ...TRADE_CATEGORIES.filter(c => c.id !== 'general').map(c => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
  })),
];

type TabValue = 'search' | 'saved';

export function AddMaterialScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const mode = useDocumentMode();
  const { document: currentDocument, update: updateDocument } = useCurrentDocument();
  const { businessSettings, subscriptionStatus, unifiedTourActive, unifiedTourPhase } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  // For compatibility, alias to currentQuote (used throughout this file)
  const currentQuote = currentDocument;
  const updateQuote = updateDocument;

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
  const [selectedCategory, setSelectedCategory] = useState(
    editingMaterial?.category || ''
  );
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  // Ref for auto-focusing manual name input for non-pro users
  const materialNameRef = useRef<any>(null);

  // Auto-focus material name for non-pro users
  useEffect(() => {
    if (!isPro && !isEditMode && activeTab === 'search') {
      const timer = setTimeout(() => {
        materialNameRef.current?.focus();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isPro, isEditMode, activeTab]);

  // Update form when editing material changes
  React.useEffect(() => {
    if (editingMaterial) {
      setManualName(editingMaterial.name);
      setManualQuantity(editingMaterial.quantity.toString());
      setManualUnit(editingMaterial.unit);
      setManualPrice(editingMaterial.price.toString());
      setSelectedCategory(editingMaterial.category || '');
      setActiveTab('search'); // Start on manual entry area when editing
    }
  }, [editingMaterial]);

  // Tour refs
  const { registerRef } = useTourRefs();
  const savedItemsTabRef = useRef<View>(null);
  const searchSectionRef = useRef<View>(null);
  const manualEntrySectionRef = useRef<View>(null);

  useEffect(() => {
    if (savedItemsTabRef.current) registerRef('savedItemsTab', savedItemsTabRef.current);
    if (searchSectionRef.current) registerRef('searchSection', searchSectionRef.current);
    if (manualEntrySectionRef.current) registerRef('manualEntrySection', manualEntrySectionRef.current);
  });

  // Saved items state
  const [savedItems, setSavedItems] = useState<any[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);

  // Recently used materials state
  const [recentMaterials, setRecentMaterials] = useState<Material[]>([]);

  const RECENT_MATERIALS_KEY = '@quotemate_recent_materials';
  const MAX_RECENT_MATERIALS = 8;

  // Load recently used materials on mount
  useEffect(() => {
    loadRecentMaterials();
  }, []);

  const loadRecentMaterials = async () => {
    try {
      const stored = await AsyncStorage.getItem(RECENT_MATERIALS_KEY);
      if (stored) {
        setRecentMaterials(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading recent materials:', error);
    }
  };

  const saveToRecentMaterials = async (material: Material) => {
    try {
      const stored = await AsyncStorage.getItem(RECENT_MATERIALS_KEY);
      let recents: Material[] = stored ? JSON.parse(stored) : [];

      // Remove duplicate by name (case-insensitive)
      recents = recents.filter(
        (m) => m.name.toLowerCase() !== material.name.toLowerCase()
      );

      // Add to front
      recents.unshift(material);

      // Keep only the most recent
      recents = recents.slice(0, MAX_RECENT_MATERIALS);

      await AsyncStorage.setItem(RECENT_MATERIALS_KEY, JSON.stringify(recents));
      setRecentMaterials(recents);
    } catch (error) {
      console.error('Error saving recent material:', error);
    }
  };

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
    if (!isPro) {
      navigation.navigate('Paywall' as never);
      return;
    }

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
                description: 'AI reckons about this much',
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
              description: 'AI reckons about this much',
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
  }, [searchQuery, businessSettings, isPro, navigation]);

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
        category: selectedCategory || undefined,
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
        category: selectedCategory || undefined,
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

  const handleSelectRecentMaterial = (material: Material) => {
    const newMaterial: Material = {
      ...material,
      id: generateId(),
      quantity: 1,
      totalPrice: material.price * 1,
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

    // Save to recently used
    saveToRecentMaterials(material);

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

  // Search section component
  const renderSearchSection = () => (
    <View ref={searchSectionRef} style={styles.section}>
      <View style={styles.manualEntryHeader}>
        <View style={styles.manualEntryDividerLine} />
        <View style={styles.searchTitleRow}>
          <Text style={styles.manualEntryHeaderText}>Search Products</Text>
          {!isPro && <ProBadge size="small" />}
        </View>
        <View style={styles.manualEntryDividerLine} />
      </View>
      {!isPro ? (
        <TouchableOpacity
          style={styles.proSearchPrompt}
          onPress={() => navigation.navigate('Paywall' as never)}
        >
          <MaterialCommunityIcons name="lock-outline" size={20} color={colors.onSurface} />
          <Text style={styles.proSearchPromptText}>
            Search real product prices from hardware stores
          </Text>
          <Text style={styles.proSearchPromptCta}>Upgrade to Pro</Text>
        </TouchableOpacity>
      ) : (
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
      )}

      {isPro && isSearching && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      )}

      {isPro && searchResults.length > 0 && (
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
  );

  // Manual entry section component
  const renderManualEntrySection = () => (
    <View ref={manualEntrySectionRef} style={styles.section}>
      {!isEditMode && (
        <View style={styles.manualEntryHeader}>
          <View style={styles.manualEntryDividerLine} />
          <Text style={styles.manualEntryHeaderText}>
            {isPro ? 'add manually' : 'Add Material'}
          </Text>
          <View style={styles.manualEntryDividerLine} />
        </View>
      )}

      <TextInput
        ref={materialNameRef}
        label="Material Name *"
        value={manualName}
        onChangeText={setManualName}
        mode="outlined"
        style={styles.input}
        placeholder="e.g., Custom timber piece"
      />

      <View style={styles.row}>
        <View style={[styles.halfWidth, styles.quantityStepperContainer]}>
          <Text style={styles.quantityLabel}>Quantity *</Text>
          <View style={styles.quantityStepper}>
            <TouchableOpacity
              style={styles.stepperButton}
              onPress={() => {
                const current = parseFloat(manualQuantity) || 1;
                if (current > 1) setManualQuantity((current - 1).toString());
              }}
            >
              <MaterialCommunityIcons name="minus" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TextInput
              value={manualQuantity}
              onChangeText={setManualQuantity}
              mode="flat"
              keyboardType="decimal-pad"
              style={styles.quantityInput}
              contentStyle={styles.quantityInputContent}
              underlineStyle={{ display: 'none' }}
            />
            <TouchableOpacity
              style={styles.stepperButton}
              onPress={() => {
                const current = parseFloat(manualQuantity) || 0;
                setManualQuantity((current + 1).toString());
              }}
            >
              <MaterialCommunityIcons name="plus" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        <TextInput
          label="Price per Unit"
          value={manualPrice}
          onChangeText={setManualPrice}
          mode="outlined"
          keyboardType="decimal-pad"
          placeholder="Optional"
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

      {/* Category Picker */}
      <View style={styles.categorySelector}>
        <Text style={styles.unitLabel}>Category (for grouping)</Text>
        <TouchableOpacity
          style={styles.categoryButton}
          onPress={() => setShowCategoryPicker(!showCategoryPicker)}
        >
          <MaterialCommunityIcons
            name={(MATERIAL_CATEGORIES.find(c => c.id === selectedCategory)?.icon || 'folder-outline') as any}
            size={20}
            color={colors.primary}
          />
          <Text style={styles.categoryButtonText}>
            {MATERIAL_CATEGORIES.find(c => c.id === selectedCategory)?.name || 'No Category'}
          </Text>
          <MaterialCommunityIcons
            name={showCategoryPicker ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={colors.onSurface}
          />
        </TouchableOpacity>
        {showCategoryPicker && (
          <View style={styles.categoryList}>
            {MATERIAL_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryItem,
                  selectedCategory === cat.id && styles.categoryItemSelected,
                ]}
                onPress={() => {
                  setSelectedCategory(cat.id);
                  setShowCategoryPicker(false);
                }}
              >
                <MaterialCommunityIcons
                  name={cat.icon as any}
                  size={18}
                  color={selectedCategory === cat.id ? colors.primary : colors.onSurface}
                />
                <Text
                  style={[
                    styles.categoryItemText,
                    selectedCategory === cat.id && styles.categoryItemTextSelected,
                  ]}
                >
                  {cat.name}
                </Text>
                {selectedCategory === cat.id && (
                  <MaterialCommunityIcons name="check" size={18} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Save as template for future quotes</Text>
        <Switch
          value={saveAsTemplate}
          onValueChange={setSaveAsTemplate}
          color={colors.primary}
        />
      </View>
    </View>
  );

  // Recently Used section
  const renderRecentlyUsedSection = () => {
    if (recentMaterials.length === 0 || isEditMode) return null;

    return (
      <View style={styles.section}>
        <View style={styles.manualEntryHeader}>
          <View style={styles.manualEntryDividerLine} />
          <Text style={styles.manualEntryHeaderText}>Recently Used</Text>
          <View style={styles.manualEntryDividerLine} />
        </View>
        <View style={styles.recentChipsContainer}>
          {recentMaterials.map((material, index) => (
            <TouchableOpacity
              key={`${material.name}-${index}`}
              style={styles.recentChip}
              onPress={() => handleSelectRecentMaterial(material)}
            >
              <Text style={styles.recentChipName} numberOfLines={1}>
                {material.name}
              </Text>
              {material.price > 0 && (
                <Text style={styles.recentChipPrice}>
                  {formatCurrency(material.price)}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  // Render Search & Add Tab - manual entry first for non-pro users
  const renderSearchTab = () => (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <WebContainer>
      {renderRecentlyUsedSection()}
      {recentMaterials.length > 0 && !isEditMode && <Divider style={styles.divider} />}
      {isEditMode ? (
        renderManualEntrySection()
      ) : isPro ? (
        <>
          {renderSearchSection()}
          {renderManualEntrySection()}
        </>
      ) : (
        <>
          {renderManualEntrySection()}
          <Divider style={styles.divider} />
          {renderSearchSection()}
        </>
      )}
      </WebContainer>
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
            <SwipeableCard
              rightActions={[
                {
                  icon: 'delete-outline',
                  label: 'Delete',
                  color: colors.error,
                  bgColor: colors.error + '18',
                  onPress: () => handleDeleteSavedItem(item),
                },
              ]}
            >
              <TouchableOpacity
                style={styles.savedItem}
                onPress={() => handleSelectSavedItem(item)}
                activeOpacity={0.7}
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
            </SwipeableCard>
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
      {/* Tab Selector - hidden in edit mode */}
      {!isEditMode && (
        <WebContainer>
        <View ref={savedItemsTabRef} style={styles.tabBar}>
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
        </WebContainer>
      )}

      {/* Tab Content */}
      {isEditMode ? renderSearchTab() : activeTab === 'search' ? renderSearchTab() : renderSavedTab()}

      {/* Fixed Bottom Button */}
      {(isEditMode || activeTab === 'search') && (
        <FixedBottomButton
          label={isEditMode ? 'Update Material' : 'Add to Quote'}
          onPress={handleAddManually}
          icon={isEditMode ? 'check' : 'plus'}
        />
      )}

      {/* Screen Tour */}
      {!isEditMode && (
        <ScreenTour
          tourId="addMaterial"
          unifiedMode={unifiedTourActive && unifiedTourPhase === 'addMaterial'}
          onScreenComplete={() => notifyScreenComplete('addMaterial')}
          onSkipRequest={notifySkipRequest}
          stepOffset={unifiedTourActive ? PHASE_STEP_OFFSETS.addMaterial : 0}
          globalTotalSteps={unifiedTourActive ? UNIFIED_TOUR_TOTAL_STEPS : undefined}
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
  tabBar: {
    padding: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabContent: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 140,
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
  manualEntryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  manualEntryDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  manualEntryHeaderText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.onSurface,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  searchTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  proSearchPrompt: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  proSearchPromptText: {
    fontSize: 14,
    color: colors.onSurface,
    textAlign: 'center',
  },
  proSearchPromptCta: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
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
  recentChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 6,
  },
  recentChipName: {
    fontSize: 13,
    color: colors.text,
    maxWidth: 150,
  },
  recentChipPrice: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
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
  quantityStepperContainer: {
    marginBottom: 12,
  },
  quantityLabel: {
    fontSize: 12,
    color: colors.onSurface,
    marginBottom: 6,
    marginLeft: 4,
  },
  quantityStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    height: 48,
  },
  stepperButton: {
    width: 44,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityInput: {
    flex: 1,
    textAlign: 'center',
    backgroundColor: 'transparent',
    height: 48,
  },
  quantityInputContent: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
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
  categorySelector: {
    marginBottom: 16,
  },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  categoryButtonText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  categoryList: {
    marginTop: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    maxHeight: 250,
    overflow: 'hidden',
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  categoryItemSelected: {
    backgroundColor: colors.primaryBg,
  },
  categoryItemText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  categoryItemTextSelected: {
    color: colors.primary,
    fontWeight: '600',
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
