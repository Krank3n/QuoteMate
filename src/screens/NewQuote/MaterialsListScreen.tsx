/**
 * Materials List Screen
 * View, edit, add, and delete materials with Bunnings pricing
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
  Platform,
  Linking,
  Image,
  Animated,
} from 'react-native';
import {
  Text,
  Button,
  List,
  IconButton,
  Dialog,
  Portal,
  Modal,
  TextInput,
  SegmentedButtons,
  ActivityIndicator,
  FAB,
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
import { analyzeJobDescription, convertLLMMaterialsToMaterials } from '../../services/llmService';
import { getTradeCategoryById, getTradeNicheById } from '../../constants/tradeCategories';
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
} from '../../services/bunningsScraperClient';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { AlertModal } from '../../components/AlertModal';
import { BUNNINGS_SCRAPER_URL } from '@env';

// AI Analysis Loading State with Lottie Animation
function AiAnalyzingState({ onCancel }: { onCancel: () => void }) {
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
      <Button
        mode="outlined"
        onPress={onCancel}
        style={styles.cancelButton}
        textColor={colors.error}
        compact
      >
        Cancel
      </Button>
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
  const [cancelGeneration, setCancelGeneration] = useState(false);

  // Product search state - REMOVED: Now handled by AddMaterialScreen

  // Delete confirmation dialog state
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState<string | null>(null);

  // Unpriced materials warning dialog state
  const [unpricedDialogVisible, setUnpricedDialogVisible] = useState(false);
  const unpricedScaleAnim = useRef(new Animated.Value(0)).current;
  const unpricedFadeAnim = useRef(new Animated.Value(0)).current;

  // Success modal state
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [successTitle, setSuccessTitle] = useState('Success!');

  // Animate unpriced dialog
  useEffect(() => {
    if (unpricedDialogVisible) {
      unpricedScaleAnim.setValue(0);
      unpricedFadeAnim.setValue(0);

      Animated.parallel([
        Animated.spring(unpricedScaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(unpricedFadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [unpricedDialogVisible]);

  // Match selector state for web scraping pricing
  const [matchSelectorVisible, setMatchSelectorVisible] = useState(false);
  const [pendingMatches, setPendingMatches] = useState<ProductMatch[]>([]);
  const [pendingMaterialIndex, setPendingMaterialIndex] = useState<number>(-1);
  const [pendingMaterialName, setPendingMaterialName] = useState<string>('');

  // Expanded materials state for accordion
  const [expandedMaterials, setExpandedMaterials] = useState<Set<string>>(new Set());



  // Get materials safely - before any hooks that depend on it
  const materials = currentQuote?.materials || [];

  // Memoize expensive computations
  const materialsSubtotal = React.useMemo(
    () => (materials && Array.isArray(materials)) ? materials.reduce((sum, m) => sum + m.totalPrice, 0) : 0,
    [materials]
  );

  const hasUnpricedMaterials = React.useMemo(
    () => (materials && Array.isArray(materials)) ? materials.some((m) => m.price === 0) : false,
    [materials]
  );

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

  const handleGenerateMaterialsList = async () => {
    if (!currentQuote || !currentQuote.job.description) {
      Alert.alert('No Description', 'Please go back and add a job description first');
      return;
    }

    setCancelGeneration(false);
    setIsAiAnalyzing(true);

    try {
      const jobDescription = currentQuote.job.description;

      // Prepare trade context from business settings (supports multi-select)
      const tradeContext = businessSettings ? (() => {
        let categoryNames: string[] = [];
        let nicheNames: string[] = [];
        let allSuggestedMaterials: string[] = [];
        let pricingMethod: string | undefined;

        // Try new multi-select fields first
        if (businessSettings.tradeCategories && businessSettings.tradeCategories.length > 0) {
          categoryNames = businessSettings.tradeCategories
            .map(id => getTradeCategoryById(id)?.name)
            .filter((n): n is string => !!n);

          if (businessSettings.tradeNiches && businessSettings.tradeNiches.length > 0) {
            businessSettings.tradeCategories.forEach(catId => {
              businessSettings.tradeNiches?.forEach(nicheId => {
                const niche = getTradeNicheById(catId, nicheId);
                if (niche) {
                  nicheNames.push(niche.name);
                  allSuggestedMaterials.push(...(niche.commonServices || []));
                  if (!pricingMethod && niche.pricingMethods && niche.pricingMethods.length > 0) {
                    pricingMethod = niche.pricingMethods[0].label;
                  }
                }
              });
            });
          }
        } else if (businessSettings.tradeCategory) {
          // Fallback to legacy single-select
          const category = getTradeCategoryById(businessSettings.tradeCategory);
          if (category) categoryNames.push(category.name);

          if (businessSettings.tradeNiche) {
            const niche = getTradeNicheById(businessSettings.tradeCategory, businessSettings.tradeNiche);
            if (niche) {
              nicheNames.push(niche.name);
              allSuggestedMaterials.push(...(niche.commonServices || []));
              if (niche.pricingMethods && niche.pricingMethods.length > 0) {
                pricingMethod = niche.pricingMethods[0].label;
              }
            }
          }
        }

        // Remove duplicates from suggested materials
        const uniqueMaterials = Array.from(new Set(allSuggestedMaterials));

        return {
          categoryName: categoryNames.join(', '),
          nicheName: nicheNames.join(', '),
          suggestedMaterials: uniqueMaterials.length > 0 ? uniqueMaterials : undefined,
          pricingMethod,
          selectedStore: businessSettings.selectedStore || 'bunnings',
        };
      })() : undefined;

      const analysis = await analyzeJobDescription(jobDescription, tradeContext);

      // Check if user canceled during AI analysis
      if (cancelGeneration) {
        console.log('Generation canceled by user');
        return;
      }

      // Convert LLM materials to app materials format
      const baseMaterials = convertLLMMaterialsToMaterials(analysis.materials);

      // Add IDs to materials and ensure all required fields are present
      const generatedMaterials = baseMaterials.map((m) => ({
        id: generateId(),
        name: m.name || 'Unknown Material',
        quantity: m.quantity || 1,
        unit: m.unit || 'each',
        searchTerm: m.searchTerm,
        price: 0,
        totalPrice: 0,
        manualPriceOverride: false,
      }));

      // Update the quote with analyzed data
      const updatedJob = {
        ...currentQuote.job,
        estimatedHours: analysis.estimatedHours,
      };

      const updatedQuote = {
        ...currentQuote,
        job: updatedJob,
        materials: generatedMaterials,
        laborHours: analysis.estimatedHours,
      };

      updateQuote(updatedQuote);

      console.log('✅ AI analysis complete:', generatedMaterials.length, 'materials generated');
      setSuccessTitle('Materials Generated!');
      setSuccessMessage(`Generated ${generatedMaterials.length} material${generatedMaterials.length !== 1 ? 's' : ''} from your job description.`);
      setShowSuccessModal(true);
    } catch (error: any) {
      console.error('❌ AI analysis error:', error);
      Alert.alert(
        'Generation Failed',
        'Could not generate materials list. Please add materials manually or try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsAiAnalyzing(false);
      setCancelGeneration(false);
    }
  };

  const handleCancelGeneration = () => {
    setCancelGeneration(true);
    setIsAiAnalyzing(false);
    Alert.alert('Canceled', 'Material generation canceled. You can add materials manually or try again.');
  };

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
    const useReeceApi = false; // Disabled - API coming soon
    const useScraperApi = BUNNINGS_SCRAPER_URL ? true : false;

    // Get selected store (single store only now)
    const selectedStore = businessSettings?.selectedStore || 'bunnings';
    const storeUrl = selectedStore === 'bunnings' ? 'bunnings.com.au' :
                     selectedStore === 'mitre10' ? 'mitre10.com.au' :
                     selectedStore === 'reece' ? 'reece.com.au' : 'bunnings.com.au';

    const hardwareStores = [storeUrl]; // Single store array for backwards compatibility

    console.log('💡 Pricing method settings:', {
      selectedStore,
      storeUrl,
      useScraperApi,
      useBunningsApi,
      scraperUrl: BUNNINGS_SCRAPER_URL,
    });

    let methodName = 'AI estimation';
    if (useScraperApi && selectedStore === 'bunnings') {
      methodName = 'Bunnings WebSearch';
    } else if (useBunningsApi) {
      methodName = 'Bunnings API';
    }

    console.log(`📊 Using pricing method: ${methodName}`);

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

            // Fallback to next method: try Bunnings API first, then AI estimation
            if (useBunningsApi) {
              console.log('🔄 Trying Bunnings API fallback...');
              const result = await bunningsApi.findAndPriceMaterial(searchTerm);
              if (result) {
                material.bunningsItemNumber = result.item.itemNumber;
                material.price = result.price.priceIncGst;
                material.totalPrice = material.price * material.quantity;
                material.manualPriceOverride = false;
                material.pricingSource = 'api';
                fetchedCount++;
                console.log(`✅ Bunnings API fallback succeeded: $${result.price.priceIncGst}`);
              } else {
                // Bunnings API also failed, try AI estimation as final fallback
                console.log('🔄 Bunnings API failed, trying AI estimation fallback...');
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
                  console.log(`✅ AI estimation fallback succeeded: $${aiResult.price}`);
                } else {
                  failedCount++;
                  console.log('❌ All fallback methods failed');
                }
              }
            } else {
              // No Bunnings API, fall back directly to AI estimation
              console.log('🔄 Trying AI estimation fallback...');
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
                console.log(`✅ AI estimation fallback succeeded: $${aiResult.price}`);
              } else {
                failedCount++;
                console.log('❌ AI estimation fallback failed');
              }
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
        if (!matchSelectorVisible) {
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
        setSuccessTitle('Prices Updated!');
        setSuccessMessage(`Updated ${fetchedCount} price${fetchedCount > 1 ? 's' : ''} using ${methodName}.`);
        setShowSuccessModal(true);
      } else if (fetchedCount > 0 && failedCount > 0) {
        setSuccessTitle('Partial Success');
        setSuccessMessage(`Updated ${fetchedCount} price${fetchedCount > 1 ? 's' : ''} using ${methodName}. Could not find ${failedCount} item${failedCount > 1 ? 's' : ''}. ${useBunningsApi ? 'The Bunnings API may be experiencing issues.' : 'Try editing material names or adjusting hardware stores in Settings.'}`);
        setShowSuccessModal(true);
      } else {
        setSuccessTitle('Complete');
        setSuccessMessage('Price fetch complete.');
        setShowSuccessModal(true);
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

  const handleMatchCanceled = useCallback(() => {
    setMatchSelectorVisible(false);
    setPendingMatches([]);
    setPendingMaterialIndex(-1);
    setPendingMaterialName('');
  }, []);

  const handleAddMaterial = () => {
    // Navigate to the new AddMaterial screen
    navigation.navigate('AddMaterial');
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
    // Navigate to AddMaterial screen in edit mode
    navigation.navigate('AddMaterial', { materialId: material.id });
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


  const handleNext = useCallback(() => {
    // Allow proceeding with no materials (labor-only quotes)
    if (hasUnpricedMaterials) {
      setUnpricedDialogVisible(true);
    } else {
      navigation.navigate('LaborMarkup');
    }
  }, [hasUnpricedMaterials, navigation]);

  const proceedWithUnpricedMaterials = () => {
    setUnpricedDialogVisible(false);
    navigation.navigate('LaborMarkup');
  };

  // Handle null currentQuote case
  if (!currentQuote) {
    return null;
  }

  return (
    <View style={styles.container}>
      <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
      >
        {isAiAnalyzing ? (
            <AiAnalyzingState onCancel={handleCancelGeneration} />
        ) : materials.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="package-variant-closed" size={80} color={colors.textMuted} />
            <Text style={styles.emptyText}>No materials yet</Text>
            <Text style={styles.emptySubtext}>
              Generate a materials list from your job description or add materials manually
            </Text>
            <Button
              mode="contained"
              onPress={handleGenerateMaterialsList}
              style={styles.generateButton}
              icon="auto-fix"
            >
              Generate Suggested Items
            </Button>
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

        {materials.length > 0 && (
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>Materials Subtotal:</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(materialsSubtotal)}
            </Text>
          </View>
        )}
       </ScrollView>

      {/* Floating Action Button for Add Material */}
      <FAB
        icon="plus"
        style={styles.fab}
        onPress={handleAddMaterial}
        label="Add Material"
      />

      <FixedBottomButton
        label="Next: Labor & Markup"
        onPress={handleNext}
        secondaryLabel={materials.length > 0 ? "Fetch Prices" : undefined}
        secondaryOnPress={materials.length > 0 ? handleFetchPrices : undefined}
        secondaryLoading={isFetchingPrices}
        secondaryDisabled={isFetchingPrices}
      />

      {/* Delete Material Confirmation Dialog */}
      <Portal>
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

        {/* Unpriced Materials Warning Modal */}
        <Modal
          visible={unpricedDialogVisible}
          onDismiss={() => setUnpricedDialogVisible(false)}
          dismissable={true}
          contentContainerStyle={styles.unpricedModalContainer}
        >
          <Animated.View
            style={[
              styles.unpricedCard,
              {
                opacity: unpricedFadeAnim,
                transform: [{ scale: unpricedScaleAnim }],
              },
            ]}
          >
            {/* Header */}
            <View style={styles.unpricedHeader}>
              <View style={styles.unpricedIconContainer}>
                <IconButton
                  icon="alert-circle"
                  iconColor={colors.warning}
                  size={40}
                />
              </View>
              <Text style={styles.unpricedTitle}>Unpriced Materials</Text>
              <Text style={styles.unpricedSubtitle}>
                Some materials don't have prices yet. You can continue anyway and add prices later, or go back to add them now.
              </Text>
            </View>

            {/* Action Buttons */}
            <View style={styles.unpricedButtonContainer}>
              <Button
                mode="outlined"
                onPress={() => setUnpricedDialogVisible(false)}
                style={styles.unpricedButton}
                textColor={colors.onSurface}
              >
                Go Back
              </Button>
              <Button
                mode="contained"
                onPress={proceedWithUnpricedMaterials}
                style={styles.unpricedButton}
                buttonColor={colors.warning}
                textColor={colors.white}
              >
                Continue Anyway
              </Button>
            </View>
          </Animated.View>
        </Modal>
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

      {/* Success Modal */}
      <AlertModal
        visible={showSuccessModal}
        onDismiss={() => setShowSuccessModal(false)}
        type="success"
        title={successTitle}
        message={successMessage}
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
      height: '100%' as any,
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
    paddingBottom: 140,
    flexGrow: 1,
    ...(Platform.OS === 'web' && {
      maxWidth: 800,
      margin: 'auto' as any,
      width: '100%',
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
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.onSurface,
    textAlign: 'center',
    marginBottom: 24,
  },
  generateButton: {
    marginTop: 8,
  },
  cancelButton: {
    marginTop: 16,
    borderColor: colors.error,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: Platform.OS === 'ios' ? 200 : 180,
    backgroundColor: colors.primary,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    ...(Platform.OS === 'web' && {
      bottom: 200,
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    }),
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
  // Unpriced Materials Modal
  unpricedModalContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  unpricedCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 32,
    ...Platform.select({
      android: {
        elevation: 8,
      },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      web: {
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      },
    }),
  },
  unpricedHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  unpricedIconContainer: {
    backgroundColor: colors.warningBg,
    borderRadius: 50,
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  unpricedTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  unpricedSubtitle: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  unpricedButtonContainer: {
    width: '100%',
    gap: 12,
  },
  unpricedButton: {
    width: '100%',
    paddingVertical: 6,
  },
});
