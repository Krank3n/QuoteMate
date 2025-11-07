/**
 * Materials List Screen
 * View, edit, add, and delete materials with Bunnings pricing
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
  TouchableOpacity,
  Platform,
  Linking,
  Image,
} from 'react-native';
import {
  Text,
  Button,
  List,
  IconButton,
  Dialog,
  Portal,
  TextInput,
  SegmentedButtons,
  ActivityIndicator,
  Divider,
} from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import LottieView from 'lottie-react-native';
import { generateId } from '../../utils/generateId';

import { useStore } from '../../store/useStore';
import { Material, BunningsItem } from '../../types';
import { colors } from '../../theme';
import { formatCurrency, updateMaterialTotalPrice } from '../../utils/quoteCalculator';
import { bunningsApi } from '../../services/bunningsApi';
import { searchMaterialPrice } from '../../services/webSearchPricing';
import { searchReeceMaterialPrice } from '../../services/reeceApi';
import {
  searchMaterialWithWebScraping,
  ProductMatch,
  PricingResult,
  getBestMatch,
} from '../../services/webScrapingPricing';
import {
  getFavoriteProduct,
  saveFavoriteProduct,
} from '../../services/materialFavorites';
import MaterialMatchSelector from '../../components/MaterialMatchSelector';
import {
  findBestMatchForMaterial,
  checkScraperHealth,
} from '../../services/bunningsScraperClient';
import { FixedBottomButton } from '../../components/FixedBottomButton';

// AI Analysis Loading State with Lottie Animation
function AiAnalyzingState() {
  const animationRef = React.useRef<LottieView>(null);

  React.useEffect(() => {
    // Ensure animation plays on iOS
    if (animationRef.current) {
      animationRef.current.play();
    }
  }, []);

  return (
    <View style={styles.aiAnalyzingContainer}>
      <View style={styles.lottieWrapper}>
        <LottieView
          ref={animationRef}
          source={require('../../../assets/materials-loading.json')}
          autoPlay={true}
          loop={true}
          speed={1}
          style={styles.lottieAnimation}
          resizeMode="contain"
        />
      </View>
      <Text style={styles.aiAnalyzingTitle}>Analyzing your job...</Text>
      <Text style={styles.aiAnalyzingSubtitle}>
        AI is generating materials list based on your job description
      </Text>
    </View>
  );
}

// Format time ago helper
function formatTimeAgo(isoTimestamp: string): string {
  const now = new Date();
  const then = new Date(isoTimestamp);
  const secondsAgo = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (secondsAgo < 60) {
    return 'Just now';
  } else if (secondsAgo < 3600) {
    const minutes = Math.floor(secondsAgo / 60);
    return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
  } else if (secondsAgo < 86400) {
    const hours = Math.floor(secondsAgo / 3600);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else {
    const days = Math.floor(secondsAgo / 86400);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
}

export function MaterialsListScreen() {
  const navigation = useNavigation<any>();
  const { currentQuote, updateQuote, businessSettings } = useStore();

  const [isFetchingPrices, setIsFetchingPrices] = useState(false);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [initialMaterialCount, setInitialMaterialCount] = useState(0);
  const [editDialogVisible, setEditDialogVisible] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [editName, setEditName] = useState('');
  const [editQuantity, setEditQuantity] = useState('');
  const [editUnit, setEditUnit] = useState<Material['unit']>('each');
  const [editPrice, setEditPrice] = useState('');
  const [isFetchingSinglePrice, setIsFetchingSinglePrice] = useState(false);

  // Product search state
  const [searchDialogVisible, setSearchDialogVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Delete confirmation dialog state
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState<string | null>(null);

  // Unpriced materials warning dialog state
  const [unpricedDialogVisible, setUnpricedDialogVisible] = useState(false);

  // Match selector state for web scraping pricing
  const [matchSelectorVisible, setMatchSelectorVisible] = useState(false);
  const [pendingMatches, setPendingMatches] = useState<ProductMatch[]>([]);
  const [pendingMaterialIndex, setPendingMaterialIndex] = useState<number>(-1);
  const [pendingMaterialName, setPendingMaterialName] = useState<string>('');

  // Expanded materials state for accordion
  const [expandedMaterials, setExpandedMaterials] = useState<Set<string>>(new Set());

  // Memoize text input handlers to prevent flickering
  const handleEditNameChange = useCallback((text: string) => {
    setEditName(text);
  }, []);

  const handleEditQuantityChange = useCallback((text: string) => {
    setEditQuantity(text);
  }, []);

  const handleEditPriceChange = useCallback((text: string) => {
    setEditPrice(text);
  }, []);

  const handleSearchQueryChange = useCallback((text: string) => {
    setSearchQuery(text);
  }, []);

  const toggleMaterialExpanded = useCallback((materialId: string) => {
    setExpandedMaterials(prev => {
      const newSet = new Set(prev);
      if (newSet.has(materialId)) {
        newSet.delete(materialId);
      } else {
        newSet.add(materialId);
      }
      return newSet;
    });
  }, []);

  // Detect if AI is analyzing (materials list is empty on first load for custom jobs)
  React.useEffect(() => {
    if (currentQuote && currentQuote.materials.length === 0 && currentQuote.job.template === 'custom') {
      setIsAiAnalyzing(true);
      setInitialMaterialCount(0);

      // Poll for materials being added (AI analysis completing)
      const checkInterval = setInterval(() => {
        const quote = useStore.getState().currentQuote;
        if (quote && quote.materials.length > 0) {
          setIsAiAnalyzing(false);
          clearInterval(checkInterval);
        }
      }, 500);

      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        setIsAiAnalyzing(false);
        clearInterval(checkInterval);
      }, 30000);

      return () => {
        clearInterval(checkInterval);
        clearTimeout(timeout);
      };
    } else {
      setIsAiAnalyzing(false);
    }
  }, [currentQuote?.id]);

  // Early return after all hooks have been called
  if (!currentQuote) {
    return null;
  }

  const materials = currentQuote.materials;

  const handleFetchPrices = async () => {
    if (materials.length === 0) {
      Alert.alert('No Materials', 'Please add materials first');
      return;
    }

    setIsFetchingPrices(true);

    let fetchedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // Determine which pricing method to use
    const useBunningsApi = businessSettings?.useBunningsApi === true;
    const useReeceApi = businessSettings?.useReeceApi === true;
    const useScraperApi = process.env.BUNNINGS_SCRAPER_URL ? true : false;
    const hardwareStores = businessSettings?.hardwareStores || ['bunnings.com.au'];

    let methodName = 'Intelligent pricing (web search + AI estimation)';
    if (useScraperApi) {
      methodName = 'Bunnings Scraper (Real Prices)';
    } else if (useBunningsApi) {
      methodName = 'Bunnings API';
    } else if (useReeceApi) {
      methodName = 'Reece API';
    }

    try {
      const updatedMaterials = [...materials];

      for (let i = 0; i < updatedMaterials.length; i++) {
        const material = updatedMaterials[i];

        // Skip if price already set and not overridden
        if (material.price > 0 && !material.manualPriceOverride) {
          skippedCount++;
          continue;
        }

        const searchTerm = material.searchTerm || material.name;

        if (useScraperApi) {
          // Use Bunnings Scraper API (Priority #1 - Real Prices)
          try {
            console.log(`🔍 Scraper: Searching for "${searchTerm}"...`);
            const product = await findBestMatchForMaterial(searchTerm);

            if (product && product.price > 0) {
              material.price = product.price;
              material.totalPrice = product.price * material.quantity;
              material.manualPriceOverride = false;
              material.pricingSource = 'scraper';

              if (product.itemNumber) {
                material.bunningsItemNumber = product.itemNumber;
              }

              if (product.productUrl) {
                material.productUrl = product.productUrl;
              }

              if (product.imageUrl) {
                material.imageUrl = product.imageUrl;
              }

              if (product.description) {
                material.description = product.description;
              }

              // Only save brand if it's not just the store name
              if (product.brand &&
                  product.brand.toLowerCase() !== 'bunnings' &&
                  product.brand.toLowerCase() !== 'bunnings.com.au') {
                material.brand = product.brand;
              }

              if (product.stockCheckedAt) {
                material.stockCheckedAt = product.stockCheckedAt;
              }

              fetchedCount++;
              console.log(`✅ Scraper: ${product.productName} - $${product.price}`);
            } else {
              console.log('⚠️ Scraper: No product found with price, trying next method...');
              throw new Error('No product found with price');
            }
          } catch (error) {
            console.log('❌ Scraper failed, falling back to next pricing method:', error);

            // Fallback to next method
            if (useBunningsApi) {
              const result = await bunningsApi.findAndPriceMaterial(searchTerm);
              if (result) {
                material.bunningsItemNumber = result.item.itemNumber;
                material.price = result.price.priceIncGst;
                material.totalPrice = material.price * material.quantity;
                material.manualPriceOverride = false;
                fetchedCount++;
              } else {
                failedCount++;
              }
            } else {
              failedCount++;
            }
          }
        } else if (useBunningsApi) {
          // Use Bunnings API
          const result = await bunningsApi.findAndPriceMaterial(searchTerm);

          if (result) {
            material.bunningsItemNumber = result.item.itemNumber;
            material.price = result.price.priceIncGst;
            material.totalPrice = material.price * material.quantity;
            material.manualPriceOverride = false;
            material.pricingSource = 'api';

            // Store additional info from Bunnings API
            if (result.item.productName) {
              material.name = result.item.productName;
            }
            // Only save brand if it's not just the store name
            if (result.item.brand &&
                result.item.brand.toLowerCase() !== 'bunnings' &&
                result.item.brand.toLowerCase() !== 'bunnings.com.au') {
              material.brand = result.item.brand;
            }
            if (result.item.description) {
              material.description = result.item.description;
            }

            fetchedCount++;
          } else {
            failedCount++;
          }
        } else if (useReeceApi) {
          // Use Reece API for plumbing supplies
          const result = await searchReeceMaterialPrice(searchTerm);

          if (result.price) {
            material.price = result.price;
            material.totalPrice = material.price * material.quantity;
            material.manualPriceOverride = false;
            material.pricingSource = 'api';

            // Store additional info if available
            if (result.productName) {
              material.name = result.productName;
            }
            if (result.store) {
              material.description = `Available at ${result.store}`;
            }

            fetchedCount++;
          } else {
            failedCount++;
          }
        } else {
          // Use Web Scraping with Favorites (NEW METHOD)

          // 1. Check for saved favorite first
          const favorite = await getFavoriteProduct(material.name, material.searchTerm);

          if (favorite) {
            // Use favorite product's last known price (user can manually update if needed)
            console.log(`Using favorite for "${searchTerm}":`, favorite.productName);
            material.favoriteProduct = favorite;
            // Note: Favorite stores the product info but not price (prices change)
            // So we still need to search, but we'll auto-select the favorite
          }

          // 2. Search hardware stores with web scraping
          const results = await searchMaterialWithWebScraping(
            material.name,
            searchTerm,
            material.quantity,
            material.unit,
            hardwareStores
          );

          if (results.length > 0 && results[0].matches.length > 0) {
            const allMatches = results.flatMap(r => r.matches);
            const quantityAdj = results[0].quantityAdjustment;

            // 3. Check if we have a favorite match in results
            let selectedMatch: ProductMatch | null = null;

            if (favorite) {
              // Try to find the favorite product in matches
              selectedMatch = allMatches.find(
                m =>
                  m.productName === favorite.productName ||
                  m.itemNumber === favorite.itemNumber
              ) || null;
            }

            // 4. If no favorite or favorite not found, get best match
            if (!selectedMatch) {
              selectedMatch = getBestMatch(results);
            }

            // 5. If multiple high-confidence matches and no favorite, prompt user
            const highConfidenceMatches = allMatches.filter(m => m.confidence === 'high');
            if (!favorite && highConfidenceMatches.length > 1 && !selectedMatch) {
              // Pause and ask user to select
              setPendingMatches(highConfidenceMatches);
              setPendingMaterialIndex(i);
              setPendingMaterialName(material.name);
              setMatchSelectorVisible(true);

              // Wait for user selection before continuing
              // (This will be handled by the modal callback)
              setIsFetchingPrices(false);
              return; // Exit early, user will resume after selection
            }

            // 6. Apply selected product to material
            if (selectedMatch) {
              material.price = selectedMatch.price;
              material.totalPrice = selectedMatch.price * material.quantity;
              material.manualPriceOverride = false;
              material.pricingSource = 'scraper';

              // Apply quantity adjustment if needed
              if (quantityAdj && quantityAdj.adjustedQuantity !== material.quantity) {
                material.quantity = quantityAdj.adjustedQuantity;
                material.totalPrice = selectedMatch.price * material.quantity;
              }

              // Store product details
              if (selectedMatch.itemNumber) {
                material.bunningsItemNumber = selectedMatch.itemNumber;
              }
              if (selectedMatch.productUrl) {
                material.productUrl = selectedMatch.productUrl;
              }
              if (selectedMatch.description) {
                material.description = selectedMatch.description;
              }
              // Only save brand if it's not just the store name
              if (selectedMatch.brand &&
                  selectedMatch.brand.toLowerCase() !== 'bunnings' &&
                  selectedMatch.brand.toLowerCase() !== 'bunnings.com.au' &&
                  selectedMatch.brand.toLowerCase() !== 'reece' &&
                  selectedMatch.brand.toLowerCase() !== 'mitre 10') {
                material.brand = selectedMatch.brand;
              }
              if (selectedMatch.stockCheckedAt) {
                material.stockCheckedAt = selectedMatch.stockCheckedAt;
              }

              fetchedCount++;
            } else {
              failedCount++;
            }
          } else {
            // Web scraping failed, fall back to AI estimation
            console.log(`Web scraping failed for "${searchTerm}", trying AI estimation...`);
            const aiResult = await searchMaterialPrice(searchTerm, hardwareStores);

            if (aiResult.price) {
              material.price = aiResult.price;
              material.totalPrice = material.price * material.quantity;
              material.manualPriceOverride = false;
              material.pricingSource = 'ai';

              if (aiResult.productName) {
                material.name = aiResult.productName;
              }
              if (aiResult.store) {
                material.description = `Estimated from ${aiResult.store}`;
              }

              fetchedCount++;
              console.log(`AI estimation succeeded for "${searchTerm}": $${aiResult.price}`);
            } else {
              failedCount++;
            }
          }
        }

        // Update UI progressively (skip if dialogs are open to avoid flickering)
        if (!editDialogVisible && !searchDialogVisible && !matchSelectorVisible) {
          updateQuote({
            ...currentQuote,
            materials: [...updatedMaterials],
          });
        }

        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Final update to ensure all changes are saved
      updateQuote({
        ...currentQuote,
        materials: [...updatedMaterials],
      });

      // Show appropriate message based on results
      if (fetchedCount === 0 && failedCount === 0 && skippedCount > 0) {
        Alert.alert('Already Priced', 'All materials already have prices.');
      } else if (fetchedCount === 0 && failedCount > 0) {
        Alert.alert(
          'No Prices Found',
          `Could not find prices for ${failedCount} material${failedCount > 1 ? 's' : ''} using ${methodName}.\n\nTry:\n• Editing material names to match hardware store products\n• Adding prices manually\n• ${useBunningsApi ? 'Checking if the Bunnings API is down' : 'Trying different hardware stores in Settings'}\n• Checking again later`
        );
      } else if (fetchedCount > 0 && failedCount === 0) {
        Alert.alert('Success', `Updated ${fetchedCount} price${fetchedCount > 1 ? 's' : ''} using ${methodName}.`);
      } else if (fetchedCount > 0 && failedCount > 0) {
        Alert.alert('Partial Success', `Updated ${fetchedCount} price${fetchedCount > 1 ? 's' : ''} using ${methodName}. Could not find ${failedCount} item${failedCount > 1 ? 's' : ''}. ${useBunningsApi ? 'The Bunnings API may be experiencing issues.' : 'Try editing material names or adjusting hardware stores in Settings.'}`);
      } else {
        Alert.alert('Complete', 'Price fetch complete.');
      }
    } catch (error) {
      console.error('Error fetching prices:', error);
      Alert.alert('Error', `Failed to fetch prices using ${methodName}. ${useBunningsApi ? 'The Bunnings API may be down or' : 'The AI price estimation service may be unavailable or'} there may be a connection issue. Please try again later.`);
    } finally {
      setIsFetchingPrices(false);
    }
  };

  const handleMatchSelected = async (match: ProductMatch, saveAsFavorite: boolean) => {
    setMatchSelectorVisible(false);

    // Apply the selected match to the pending material
    const updatedMaterials = [...materials];
    const material = updatedMaterials[pendingMaterialIndex];

    if (material) {
      material.price = match.price;
      material.totalPrice = match.price * material.quantity;
      material.manualPriceOverride = false;
      material.pricingSource = 'scraper';

      if (match.itemNumber) {
        material.bunningsItemNumber = match.itemNumber;
      }
      if (match.productUrl) {
        material.productUrl = match.productUrl;
      }
      if (match.description) {
        material.description = match.description;
      }
      // Only save brand if it's not just the store name
      if (match.brand &&
          match.brand.toLowerCase() !== 'bunnings' &&
          match.brand.toLowerCase() !== 'bunnings.com.au' &&
          match.brand.toLowerCase() !== 'reece' &&
          match.brand.toLowerCase() !== 'mitre 10') {
        material.brand = match.brand;
      }
      if (match.stockCheckedAt) {
        material.stockCheckedAt = match.stockCheckedAt;
      }

      // Save as favorite if requested
      if (saveAsFavorite) {
        const favoriteMapping = {
          productName: match.productName,
          store: match.store,
          productUrl: match.productUrl,
          itemNumber: match.itemNumber,
          dimensions: match.dimensions,
          unit: match.unit,
        };
        material.favoriteProduct = favoriteMapping;
        await saveFavoriteProduct(material.name, material.searchTerm, favoriteMapping);
      }

      updateQuote({
        ...currentQuote,
        materials: updatedMaterials,
      });

      Alert.alert('Price Updated', `${match.productName} - ${formatCurrency(match.price)}`);
    }

    // Resume fetching remaining materials
    // Note: This is simplified - in production you'd want to resume from where you left off
    setPendingMatches([]);
    setPendingMaterialIndex(-1);
    setPendingMaterialName('');
  };

  const handleMatchCanceled = () => {
    setMatchSelectorVisible(false);
    setPendingMatches([]);
    setPendingMaterialIndex(-1);
    setPendingMaterialName('');
  };

  const handleSearchProducts = async () => {
    if (!searchQuery.trim()) {
      Alert.alert('Enter Search Term', 'Please enter a product name or description to search');
      return;
    }

    setIsSearching(true);
    setSearchResults([]);

    try {
      // Get the first selected hardware store
      const hardwareStores = businessSettings?.hardwareStores || ['bunnings.com.au'];
      const firstStore = hardwareStores[0];
      const useScraperApi = process.env.BUNNINGS_SCRAPER_URL ? true : false;

      // Check if the first store is Bunnings
      const isBunnings = firstStore.includes('bunnings.com.au');

      if (isBunnings && useScraperApi) {
        // Use Bunnings Scraper for search
        console.log(`🔍 Searching Bunnings via scraper for: "${searchQuery}"`);
        const scraperResults = await searchMaterialWithWebScraping(
          searchQuery,
          searchQuery,
          1,
          'each',
          [firstStore]
        );

        // Convert scraper results to a format we can display
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
          Alert.alert(
            'No Results',
            `No products found on ${firstStore}. Try:\n\n• Adding the material manually\n• Using a different search term\n• Checking your internet connection`
          );
        }
      } else if (isBunnings) {
        // Fallback to Bunnings API if scraper not available
        console.log(`🔍 Searching Bunnings via API for: "${searchQuery}"`);
        const results = await bunningsApi.searchItem(searchQuery, 20);
        setSearchResults(results.map(item => ({ ...item, isScraperResult: false })));

        if (results.length === 0) {
          Alert.alert(
            'No Results',
            'No products found. The Bunnings API may have limited data. Try:\n\n• Adding the material manually\n• Using a different search term'
          );
        }
      } else {
        // For other stores, use web scraping
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
          Alert.alert(
            'No Results',
            `No products found on ${firstStore}. Try:\n\n• Adding the material manually\n• Using a different search term\n• Selecting a different hardware store in Settings`
          );
        }
      }
    } catch (error) {
      console.error('Search error:', error);
      Alert.alert('Search Error', 'Failed to search products. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectProduct = async (item: any) => {
    setSearchDialogVisible(false);

    let newMaterial: Material;

    if (item.isScraperResult) {
      // Handle scraper results
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
        brand: item.brand && item.brand.toLowerCase() !== 'bunnings' && item.brand.toLowerCase() !== 'bunnings.com.au'
          ? item.brand
          : undefined,
      };
    } else {
      // Handle Bunnings API results
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

    updateQuote({
      ...currentQuote,
      materials: [...materials, newMaterial],
    });

    // Reset search
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleAddMaterialManually = () => {
    setSearchDialogVisible(false);

    const newMaterial: Material = {
      id: generateId(),
      name: searchQuery.trim() || 'New Material',
      quantity: 1,
      unit: 'each',
      price: 0,
      totalPrice: 0,
      manualPriceOverride: false,
    };

    updateQuote({
      ...currentQuote,
      materials: [...materials, newMaterial],
    });

    setSearchQuery('');
    setSearchResults([]);
  };

  const handleAddMaterial = () => {
    // Check if Bunnings is the first selected store
    const hardwareStores = businessSettings?.hardwareStores || ['bunnings.com.au'];
    const firstStore = hardwareStores[0];
    const isBunnings = firstStore.includes('bunnings.com.au');

    if (!isBunnings) {
      // For non-Bunnings stores, add material manually
      handleAddMaterialManually();
      return;
    }

    // Show search dialog for Bunnings
    setSearchDialogVisible(true);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleOpenInStore = (material: Material) => {
    // If we have a direct product URL (from scraper or API), use it!
    if (material.productUrl) {
      console.log(`🔗 Opening product URL: ${material.productUrl}`);
      if (Platform.OS === 'web') {
        window.open(material.productUrl, '_blank');
      } else {
        Linking.openURL(material.productUrl).catch((err) => {
          Alert.alert('Error', 'Could not open product link');
          console.error('Failed to open URL:', err);
        });
      }
      return;
    }

    // Otherwise, construct a search URL as fallback
    const stores = businessSettings?.hardwareStores || ['bunnings.com.au'];
    const firstStore = stores[0];

    // Determine search term
    const searchTerm = material.searchTerm || material.name;
    const encodedSearch = encodeURIComponent(searchTerm);

    // Generate store URL based on the store domain
    let storeUrl = '';

    if (firstStore.includes('bunnings.com.au')) {
      storeUrl = `https://www.bunnings.com.au/search/products?q=${encodedSearch}`;
    } else if (firstStore.includes('reece.com.au')) {
      storeUrl = `https://www.reece.com.au/search?q=${encodedSearch}`;
    } else if (firstStore.includes('mitre10.com.au')) {
      storeUrl = `https://www.mitre10.com.au/catalogsearch/result?q=${encodedSearch}&viewType=GRID&flag=product`;
    } else if (firstStore.includes('flexihire.com.au')) {
      storeUrl = `https://www.flexihire.com.au/equipment?q=${encodedSearch}`;
    } else {
      // Generic store - use Google search
      storeUrl = `https://www.google.com/search?q=${encodedSearch}+site:${firstStore}`;
    }

    console.log(`🔍 Opening search URL: ${storeUrl}`);

    // Open URL
    if (Platform.OS === 'web') {
      window.open(storeUrl, '_blank');
    } else {
      Linking.openURL(storeUrl).catch((err) => {
        Alert.alert('Error', 'Could not open store link');
        console.error('Failed to open URL:', err);
      });
    }
  };

  const handleEditMaterial = (material: Material) => {
    setEditingMaterial(material);
    setEditName(material.name);
    setEditQuantity(material.quantity.toString());
    setEditUnit(material.unit);
    setEditPrice(material.price.toString());
    setEditDialogVisible(true);
  };

  const handleSaveMaterial = () => {
    if (!editingMaterial) return;

    const updatedMaterials = materials.map((m) =>
      m.id === editingMaterial.id
        ? updateMaterialTotalPrice({
            ...m,
            name: editName,
            quantity: parseFloat(editQuantity) || 0,
            unit: editUnit,
            price: parseFloat(editPrice) || 0,
            manualPriceOverride: true,
            pricingSource: 'manual',
          })
        : m
    );

    updateQuote({
      ...currentQuote,
      materials: updatedMaterials,
    });

    setEditDialogVisible(false);
    setEditingMaterial(null);
  };

  const handleDeleteMaterial = (materialId: string) => {
    setMaterialToDelete(materialId);
    setDeleteDialogVisible(true);
  };

  const confirmDeleteMaterial = () => {
    if (materialToDelete) {
      const updatedMaterials = materials.filter((m) => m.id !== materialToDelete);
      updateQuote({
        ...currentQuote,
        materials: updatedMaterials,
      });
    }
    setDeleteDialogVisible(false);
    setMaterialToDelete(null);
  };

  const handleFetchSinglePrice = async () => {
    if (!editName.trim()) {
      Alert.alert('Enter Material Name', 'Please enter a material name to search for pricing');
      return;
    }

    setIsFetchingSinglePrice(true);

    try {
      const useBunningsApi = businessSettings?.useBunningsApi === true;
      const hardwareStores = businessSettings?.hardwareStores || ['https://www.bunnings.com.au/'];
      const searchTerm = editName;

      if (useBunningsApi) {
        // Use Bunnings API
        const result = await bunningsApi.findAndPriceMaterial(searchTerm);

        if (result) {
          setEditPrice(result.price.priceIncGst.toString());
          // Update the editing material to include pricingSource and metadata
          if (editingMaterial) {
            editingMaterial.pricingSource = 'api';
            if (result.item.productName) {
              editingMaterial.name = result.item.productName;
              setEditName(result.item.productName);
            }
            // Only save brand if it's not just the store name
            if (result.item.brand &&
                result.item.brand.toLowerCase() !== 'bunnings' &&
                result.item.brand.toLowerCase() !== 'bunnings.com.au') {
              editingMaterial.brand = result.item.brand;
            }
          }
          Alert.alert('Success', `Found price: ${formatCurrency(result.price.priceIncGst)}`);
        } else {
          Alert.alert(
            'Not Found',
            'Could not find this material in the Bunnings catalog. Try:\n\n• Editing the material name\n• Entering the price manually\n• Checking if Bunnings API is available'
          );
        }
      } else {
        // Use AI price estimation
        const result = await searchMaterialPrice(searchTerm, hardwareStores);

        if (result.price) {
          setEditPrice(result.price.toString());
          // Update the editing material to include pricingSource
          if (editingMaterial) {
            editingMaterial.pricingSource = 'ai';
            if (result.productName) {
              editingMaterial.name = result.productName;
              setEditName(result.productName);
            }
          }
          Alert.alert('Estimated Price', `Estimated price: ${formatCurrency(result.price)}\n\nNote: This is an AI estimate, not a live price.`);
        } else {
          Alert.alert(
            'Could Not Estimate',
            'Could not estimate a price for this material. Please enter the price manually.'
          );
        }
      }
    } catch (error) {
      console.error('Error fetching single price:', error);
      Alert.alert('Error', 'Failed to fetch price. Please try again or enter manually.');
    } finally {
      setIsFetchingSinglePrice(false);
    }
  };

  const handleNext = () => {
    // Allow proceeding with no materials (labor-only quotes)
    const hasUnpricedMaterials = materials.some((m) => m.price === 0);
    if (hasUnpricedMaterials) {
      setUnpricedDialogVisible(true);
    } else {
      navigation.navigate('LaborMarkup');
    }
  };

  const proceedWithUnpricedMaterials = () => {
    setUnpricedDialogVisible(false);
    navigation.navigate('LaborMarkup');
  };

  return (
    <View style={styles.container}>
      <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
      >
        {isAiAnalyzing ? (
            <AiAnalyzingState />
        ) : materials.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No materials required</Text>
            <Text style={styles.emptySubtext}>
              This will be a labor-only quote. Tap + if you need to add materials.
            </Text>
          </View>
        ) : (
          <List.Section style={styles.listView}>
            {materials.map((material) => {
              const isExpanded = expandedMaterials.has(material.id);

              // Check if brand is meaningful (not just "Bunnings" or the store name)
              const hasMeaningfulBrand = material.brand &&
                material.brand.toLowerCase() !== 'bunnings' &&
                material.brand.toLowerCase() !== 'bunnings.com.au' &&
                material.brand.toLowerCase() !== 'reece' &&
                material.brand.toLowerCase() !== 'mitre 10';

              const hasDetails = material.imageUrl || material.description || hasMeaningfulBrand || material.stockCheckedAt || material.bunningsItemNumber;
              const showLink = material.pricingSource === 'scraper' || material.pricingSource === 'api';
              const isAiEstimate = material.pricingSource === 'ai';

              return (
                <View key={material.id} style={styles.listItem}>
                  <TouchableOpacity
                    onPress={() => hasDetails && toggleMaterialExpanded(material.id)}
                    disabled={!hasDetails}
                    activeOpacity={0.7}
                  >
                    <View style={styles.accordionHeader}>
                      <MaterialCommunityIcons
                        name="package-variant"
                        size={24}
                        color={colors.onSurface}
                        style={styles.accordionIcon}
                      />
                      <View style={styles.accordionContent}>
                        <Text style={styles.accordionTitle}>{material.name}</Text>
                        <View>
                          <Text style={styles.materialDescription}>
                            {material.quantity} {material.unit} × {formatCurrency(material.price)}
                          </Text>
                          {isAiEstimate && (
                            <Text style={styles.aiEstimateLabel}>AI Estimate</Text>
                          )}
                        </View>
                      </View>
                      <View style={styles.itemRight}>
                        <Text style={styles.itemTotal}>
                          {formatCurrency(material.totalPrice)}
                        </Text>
                        <View style={styles.itemActions}>
                          {showLink && (
                            <IconButton
                              icon="open-in-new"
                              size={20}
                              onPress={() => handleOpenInStore(material)}
                              iconColor={colors.primary}
                            />
                          )}
                          <IconButton
                            icon="pencil"
                            size={20}
                            onPress={() => handleEditMaterial(material)}
                          />
                          <IconButton
                            icon="delete"
                            size={20}
                            onPress={() => handleDeleteMaterial(material.id)}
                          />
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                  {hasDetails && isExpanded && (
                    <View style={styles.expandedContent}>
                      <View style={styles.detailsContainer}>
                        {material.imageUrl && (
                          <Image
                            source={{ uri: material.imageUrl }}
                            style={styles.productImage}
                            resizeMode="contain"
                          />
                        )}
                        <View style={styles.detailsColumn}>
                          {material.description && (
                            <View style={styles.detailRow}>
                              <Text style={styles.detailLabel}>Description:</Text>
                              <Text style={styles.detailValue}>{material.description}</Text>
                            </View>
                          )}
                          {hasMeaningfulBrand && (
                            <View style={styles.detailRow}>
                              <Text style={styles.detailLabel}>Brand:</Text>
                              <Text style={styles.detailValue}>{material.brand}</Text>
                            </View>
                          )}
                          {material.stockCheckedAt && (
                            <View style={styles.detailRow}>
                              <Text style={styles.detailLabel}>Last checked:</Text>
                              <Text style={styles.detailValue}>{formatTimeAgo(material.stockCheckedAt)}</Text>
                            </View>
                          )}
                          {material.bunningsItemNumber && (
                            <View style={styles.detailRow}>
                              <Text style={styles.detailLabel}>Item #:</Text>
                              <Text style={styles.detailValue}>{material.bunningsItemNumber}</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </List.Section>
        )}

        <View style={styles.actions}>
          <Button
            mode="contained"
            onPress={handleAddMaterial}
            style={styles.addButton}
            icon="plus"
            contentStyle={styles.addButtonContent}
          >
            Add Material
          </Button>
        </View>

        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>Materials Subtotal:</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(materials.reduce((sum, m) => sum + m.totalPrice, 0))}
          </Text>
        </View>
      </ScrollView>

      {/* Optional Fetch Prices - Secondary Action */}
      {materials.length > 0 && (
        <View style={styles.fetchPricesContainer}>
          <Button
            mode="outlined"
            onPress={handleFetchPrices}
            style={styles.fetchPricesButton}
            loading={isFetchingPrices}
            disabled={isFetchingPrices}
          >
            Fetch Prices
          </Button>
        </View>
      )}

      {/* Primary Navigation - Next Step */}
      <FixedBottomButton
        label="Next: Labor & Markup"
        onPress={handleNext}
      />

      {/* Edit Material Dialog */}
      <Portal>
        <Dialog visible={editDialogVisible} onDismiss={() => setEditDialogVisible(false)}>
          <Dialog.Title>Edit Material</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Material Name"
              value={editName}
              onChangeText={handleEditNameChange}
              mode="outlined"
              style={styles.dialogInput}
              multiline
              numberOfLines={2}
            />

            <TextInput
              label="Quantity"
              value={editQuantity}
              onChangeText={handleEditQuantityChange}
              mode="outlined"
              keyboardType="decimal-pad"
              style={styles.dialogInput}
            />

            <View style={styles.unitSelector}>
              <Text style={styles.unitLabel}>Unit</Text>
              <View style={styles.unitButtons}>
                <SegmentedButtons
                  value={editUnit}
                  onValueChange={(value) => setEditUnit(value as Material['unit'])}
                  buttons={[
                    { value: 'each', label: 'Each' },
                    { value: 'm', label: 'M' },
                    { value: 'L', label: 'L' },
                  ]}
                  style={styles.unitRow}
                />
                <SegmentedButtons
                  value={editUnit}
                  onValueChange={(value) => setEditUnit(value as Material['unit'])}
                  buttons={[
                    { value: 'kg', label: 'Kg' },
                    { value: 'box', label: 'Box' },
                    { value: 'pack', label: 'Pack' },
                  ]}
                  style={styles.unitRow}
                />
              </View>
            </View>

            <TextInput
              label="Price per Unit"
              value={editPrice}
              onChangeText={handleEditPriceChange}
              mode="outlined"
              keyboardType="decimal-pad"
              left={<TextInput.Affix text="$" />}
              style={styles.dialogInput}
            />

            <Button
              mode="text"
              onPress={handleFetchSinglePrice}
              loading={isFetchingSinglePrice}
              disabled={isFetchingSinglePrice || !editName.trim()}
              icon="cash-sync"
              compact
              style={styles.fetchPriceButton}
            >
              Fetch Price
            </Button>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setEditDialogVisible(false)}>Cancel</Button>
            <Button onPress={handleSaveMaterial}>Save</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Search Products Dialog */}
        <Dialog
          visible={searchDialogVisible}
          onDismiss={() => setSearchDialogVisible(false)}
          style={styles.searchDialog}
        >
          <Dialog.Title>
            Add Material from {
              (() => {
                const stores = businessSettings?.hardwareStores || ['bunnings.com.au'];
                const firstStore = stores[0];
                if (firstStore.includes('bunnings.com.au')) return 'Bunnings';
                if (firstStore.includes('reece.com.au')) return 'Reece';
                if (firstStore.includes('mitre10.com.au')) return 'Mitre 10';
                if (firstStore.includes('flexihire.com.au')) return 'Flexihire';
                return firstStore.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/$/, '');
              })()
            }
          </Dialog.Title>
          <Dialog.Content>
            <View style={styles.searchContainer}>
              <TextInput
                label="Search Products"
                value={searchQuery}
                onChangeText={handleSearchQueryChange}
                mode="outlined"
                placeholder="e.g., treated pine 90x45"
                style={styles.searchInput}
                right={
                  <TextInput.Icon
                    icon="magnify"
                    onPress={handleSearchProducts}
                    disabled={isSearching}
                  />
                }
                onSubmitEditing={handleSearchProducts}
              />

              {isSearching && (
                <View style={styles.searchingContainer}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.searchingText}>Searching Bunnings...</Text>
                </View>
              )}

              {searchResults.length > 0 && (
                <View style={styles.resultsContainer}>
                  <Text style={styles.resultsHeader}>
                    Found {searchResults.length} products:
                  </Text>
                  <FlatList
                    data={searchResults}
                    keyExtractor={(item) => item.itemNumber}
                    style={styles.resultsList}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={styles.resultItem}
                        onPress={() => handleSelectProduct(item)}
                      >
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName}>
                            {item.productName || item.description}
                          </Text>
                          <Text style={styles.resultDetails}>
                            Item #: {item.itemNumber}
                            {item.brand && ` • ${item.brand}`}
                            {item.uom && ` • ${item.uom}`}
                          </Text>
                        </View>
                        <IconButton icon="chevron-right" size={20} />
                      </TouchableOpacity>
                    )}
                    ItemSeparatorComponent={() => <Divider />}
                  />
                </View>
              )}

              {!isSearching && searchResults.length === 0 && searchQuery && (
                <View style={styles.emptyResults}>
                  <Text style={styles.emptyResultsText}>
                    No products found. Try a different search term or add manually.
                  </Text>
                </View>
              )}
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSearchDialogVisible(false)}>Cancel</Button>
            <Button onPress={handleAddMaterialManually} icon="pencil">
              Add Manually
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Delete Material Confirmation Dialog */}
        <Dialog visible={deleteDialogVisible} onDismiss={() => setDeleteDialogVisible(false)}>
          <Dialog.Title>Delete Material</Dialog.Title>
          <Dialog.Content>
            <Text>Are you sure you want to remove this material?</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteDialogVisible(false)}>Cancel</Button>
            <Button onPress={confirmDeleteMaterial} textColor={colors.error}>Delete</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Unpriced Materials Warning Dialog */}
        <Dialog visible={unpricedDialogVisible} onDismiss={() => setUnpricedDialogVisible(false)}>
          <Dialog.Title>Unpriced Materials</Dialog.Title>
          <Dialog.Content>
            <Text>Some materials don't have prices. Do you want to continue?</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setUnpricedDialogVisible(false)}>Go Back</Button>
            <Button onPress={proceedWithUnpricedMaterials}>Continue</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Material Match Selector Modal */}
      <MaterialMatchSelector
        visible={matchSelectorVisible}
        materialName={pendingMaterialName}
        matches={pendingMatches}
        quantityAdjustment={undefined}
        onSelect={handleMatchSelected}
        onCancel={handleMatchCanceled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' && {
      display: 'flex' as any,
      flexDirection: 'column' as any,
      height: '100vh' as any,
      overflow: 'hidden' as any,
    }),
  },
  scrollView: {
    flex: 1,
    ...(Platform.OS === 'web' && {
      overflow: 'auto' as any,
      flexShrink: 1,
    }),
  },
  scrollContent: {
    flexGrow: 1,
    ...(Platform.OS === 'web' && {
      maxWidth: 800,
      margin: 'auto' as any,
      width: '100%',
      paddingBottom: 20,
      height: '0px' as any,
    }),
  },
  listView: {
    ...(Platform.OS === 'web' && {
      maxWidth: 800,
      margin: '0 auto' as any,
      width: '100%',
    }),
  },
  listItem: {
    backgroundColor: colors.surface,
    marginBottom: 1,
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingRight: 8,
  },
  accordionIcon: {
    marginRight: 16,
  },
  accordionContent: {
    flex: 1,
    justifyContent: 'center',
  },
  accordionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 4,
  },
  itemRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  itemTotal: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 8,
  },
  itemActions: {
    flexDirection: 'row',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.onSurface,
    textAlign: 'center',
  },
  actions: {
    padding: 20,
    paddingBottom: 8,
  },
  addButton: {
    alignSelf: 'flex-end',
    marginTop: 0,
    marginBottom: 0,
  },
  addButtonContent: {
    flexDirection: 'row-reverse',
  },
  fetchPricesContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: colors.surfaceGray3,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...(Platform.OS === 'web' && {
      flexShrink: 0,
      margin: '0 auto' as any,
      width: '100%',
    }),
  },
  fetchPricesButton: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  fetchPricesHint: {
    fontSize: 12,
    color: colors.onSurface,
    textAlign: 'center',
    marginTop: 4,
  },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  summaryLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
  },
  dialogInput: {
    marginBottom: 12,
  },
  fetchPriceButton: {
    marginTop: -8,
    marginBottom: 8,
    alignSelf: 'flex-start',
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
  searchDialog: {
    maxHeight: '80%',
    ...(Platform.OS === 'web' && {
      maxWidth: 600,
      alignSelf: 'center' as any,
    }),
  },
  searchContainer: {
    minHeight: 200,
  },
  searchInput: {
    marginBottom: 16,
  },
  searchingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  searchingText: {
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
  resultsList: {
    maxHeight: 300,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 4,
  },
  resultDetails: {
    fontSize: 12,
    color: colors.onSurface,
  },
  emptyResults: {
    padding: 20,
    alignItems: 'center',
  },
  emptyResultsText: {
    fontSize: 14,
    color: colors.onSurface,
    textAlign: 'center',
  },
  materialDescription: {
    fontSize: 14,
    color: colors.onSurface,
  },
  aiEstimateLabel: {
    fontSize: 11,
    color: colors.onSurface,
    fontStyle: 'italic',
    marginTop: 2,
  },
  expandedContent: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'flex-start',
  },
  productImage: {
    width: Platform.OS === 'web' ? 100 : 80,
    height: Platform.OS === 'web' ? 100 : 80,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailsColumn: {
    flex: 1,
    minWidth: 200,
  },
  detailRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurface,
    marginRight: 8,
    minWidth: 80,
  },
  detailValue: {
    fontSize: 13,
    color: colors.text,
    flex: 1,
  },
  // AI Analyzing State with Lottie
  aiAnalyzingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
    margin: 'auto',
    minHeight: 300,
    minWidth: 300,
    maxWidth: 500,
  },
  lottieWrapper: {
    width: 250,
    height: 250,
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lottieAnimation: {
    width: 250,
    height: 250,
  },
  aiAnalyzingTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  aiAnalyzingSubtitle: {
    fontSize: 14,
    color: colors.onSurface,
    textAlign: 'center',
    marginBottom: 24,
  },
});
