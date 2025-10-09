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
import { generateId } from '../../utils/generateId';

import { useStore } from '../../store/useStore';
import { Material, BunningsItem } from '../../types';
import { colors } from '../../theme';
import { formatCurrency, updateMaterialTotalPrice } from '../../utils/quoteCalculator';
import { bunningsApi } from '../../services/bunningsApi';
import { searchMaterialPrice } from '../../services/webSearchPricing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


export function MaterialsListScreen() {
  const navigation = useNavigation<any>();
  const { currentQuote, updateQuote, businessSettings } = useStore();
  const insets = useSafeAreaInsets();

  const [isFetchingPrices, setIsFetchingPrices] = useState(false);
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
  const [searchResults, setSearchResults] = useState<BunningsItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

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
    const useBunningsApi = businessSettings?.useBunningsApi === true; // Default to false
    const hardwareStores = businessSettings?.hardwareStores || ['https://www.bunnings.com.au/'];
    const methodName = useBunningsApi ? 'Bunnings API' : 'AI estimation';

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

        if (useBunningsApi) {
          // Use Bunnings API (original method)
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
          // Use AI price estimation with Claude
          const result = await searchMaterialPrice(searchTerm, hardwareStores);

          if (result.price) {
            material.price = result.price;
            material.totalPrice = material.price * material.quantity;
            material.manualPriceOverride = false;

            // Store additional info if available
            if (result.productName) {
              material.name = result.productName;
            }

            fetchedCount++;
          } else {
            failedCount++;
          }
        }

        // Update UI progressively (skip if dialogs are open to avoid flickering)
        if (!editDialogVisible && !searchDialogVisible) {
          updateQuote({
            ...currentQuote,
            materials: [...updatedMaterials],
          });
        }

        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 500));
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

  const handleSearchProducts = async () => {
    if (!searchQuery.trim()) {
      Alert.alert('Enter Search Term', 'Please enter a product name or description to search');
      return;
    }

    setIsSearching(true);
    setSearchResults([]);

    try {
      const results = await bunningsApi.searchItem(searchQuery, 20);
      setSearchResults(results);

      if (results.length === 0) {
        Alert.alert(
          'No Results',
          'No products found. The Bunnings Sandbox may have limited data. Try:\n\n• Adding the material manually\n• Using a different search term\n• Entering a Bunnings item number directly'
        );
      }
    } catch (error) {
      Alert.alert('Search Error', 'Failed to search products. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectProduct = async (item: BunningsItem) => {
    setSearchDialogVisible(false);

    // Fetch price for the selected item
    const price = await bunningsApi.getPrice(item.itemNumber);

    const newMaterial: Material = {
      id: generateId(),
      name: item.productName || item.description,
      quantity: 1,
      unit: 'each',
      bunningsItemNumber: item.itemNumber,
      price: price?.priceIncGst || 0,
      totalPrice: price?.priceIncGst || 0,
      manualPriceOverride: false,
      searchTerm: item.description,
    };

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
    // Show search dialog instead of directly adding
    setSearchDialogVisible(true);
    setSearchQuery('');
    setSearchResults([]);
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
    Alert.alert(
      'Delete Material',
      'Are you sure you want to remove this material?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const updatedMaterials = materials.filter((m) => m.id !== materialId);
            updateQuote({
              ...currentQuote,
              materials: updatedMaterials,
            });
          },
        },
      ]
    );
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
    if (materials.length === 0) {
      Alert.alert('No Materials', 'Please add at least one material');
      return;
    }

    const hasUnpricedMaterials = materials.some((m) => m.price === 0);
    if (hasUnpricedMaterials) {
      Alert.alert(
        'Unpriced Materials',
        'Some materials don\'t have prices. Do you want to continue?',
        [
          { text: 'Go Back', style: 'cancel' },
          {
            text: 'Continue',
            onPress: () => navigation.navigate('LaborMarkup'),
          },
        ]
      );
    } else {
      navigation.navigate('LaborMarkup');
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {materials.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No materials yet</Text>
            <Text style={styles.emptySubtext}>
              Tap + to add materials or fetch prices from Bunnings
            </Text>
          </View>
        ) : (
          <List.Section>
            {materials.map((material) => (
              <List.Item
                key={material.id}
                title={material.name}
                description={`${material.quantity} ${material.unit} × ${formatCurrency(
                  material.price
                )}`}
                left={(props) => <List.Icon {...props} icon="package-variant" />}
                right={() => (
                  <View style={styles.itemRight}>
                    <Text style={styles.itemTotal}>
                      {formatCurrency(material.totalPrice)}
                    </Text>
                    <View style={styles.itemActions}>
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
                )}
                style={styles.listItem}
              />
            ))}
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
            Add
          </Button>

          <Button
            mode="outlined"
            onPress={handleFetchPrices}
            style={styles.actionButton}
            loading={isFetchingPrices}
            disabled={isFetchingPrices || materials.length === 0}
          >
            Fetch Prices
          </Button>

          {(businessSettings?.useBunningsApi === false || businessSettings?.useBunningsApi === undefined) && (
            <Text style={styles.disclaimerText}>
              Note: Awaiting Bunnings API approval. Prices are AI estimates only.
            </Text>
          )}
        </View>

        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>Materials Subtotal:</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(materials.reduce((sum, m) => sum + m.totalPrice, 0))}
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.bottomActions, { paddingBottom: insets.bottom + 20 }]}>
        <Button
          mode="contained"
          onPress={handleNext}
          style={styles.nextButton}
          labelStyle={styles.nextButtonLabel}
          disabled={materials.length === 0}
        >
          Next: Labor & Markup
        </Button>
      </View>

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
          <Dialog.Title>Add Material from Bunnings</Dialog.Title>
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
                  <Text style={styles.emptyText}>
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
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  listItem: {
    backgroundColor: colors.surface,
    marginBottom: 1,
  },
  itemRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
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
  },
  addButton: {
    alignSelf: 'flex-end',
    marginTop: 0,
    marginBottom: 24,
  },
  addButtonContent: {
    flexDirection: 'row-reverse',
  },
  actionButton: {
    marginBottom: 12,
  },
  disclaimerText: {
    fontSize: 11,
    color: colors.onSurface,
    fontStyle: 'italic',
    marginTop: 8,
    marginBottom: 4,
    textAlign: 'center',
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
  bottomActions: {
    padding: 20,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  nextButton: {
    paddingVertical: 8,
  },
  nextButtonLabel: {
    color: colors.white,
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
  emptyText: {
    fontSize: 14,
    color: colors.onSurface,
    textAlign: 'center',
  },
});
