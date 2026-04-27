/**
 * Trade & Pricing Settings Screen
 * Trade categories, niches, and hardware store selection
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import {
  Text,
  Surface,
  Title,
  Chip,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { AlertModal } from '../../components/AlertModal';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import {
  TRADE_CATEGORIES,
  getTradeCategoryById,
} from '../../constants/tradeCategories';
import { getReeceConnectionStatus } from '../../services/reeceApi';

export function TradePricingScreen() {
  const { businessSettings, setBusinessSettings } = useStore();

  const navigation = useNavigation();

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedNiches, setSelectedNiches] = useState<string[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>('bunnings');
  const [reeceConnected, setReeceConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const initialSnapshotRef = useRef<string | null>(null);

  // Re-check Reece connection every time the screen is focused so returning
  // from ReeceIntegrationScreen instantly reflects the new state.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getReeceConnectionStatus()
        .then((status) => {
          if (!cancelled) setReeceConnected(!!status.connected);
        })
        .catch(() => {
          if (!cancelled) setReeceConnected(false);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  useEffect(() => {
    if (businessSettings) {
      const cats = businessSettings.tradeCategories || (businessSettings.tradeCategory ? [businessSettings.tradeCategory] : []);
      const niches = businessSettings.tradeNiches || (businessSettings.tradeNiche ? [businessSettings.tradeNiche] : []);
      const store = businessSettings.selectedStore || 'bunnings';
      setSelectedCategories(cats);
      setSelectedNiches(niches);
      setSelectedStore(store);
      initialSnapshotRef.current = JSON.stringify({ cats: [...cats].sort(), niches: [...niches].sort(), store });
    }
  }, [businessSettings]);

  const isDirty = useMemo(() => {
    if (!initialSnapshotRef.current) return false;
    const current = JSON.stringify({
      cats: [...selectedCategories].sort(),
      niches: [...selectedNiches].sort(),
      store: selectedStore,
    });
    return current !== initialSnapshotRef.current;
  }, [selectedCategories, selectedNiches, selectedStore]);

  const handleCategoryToggle = (categoryId: string) => {
    setSelectedCategories(prev => {
      if (prev.includes(categoryId)) {
        const category = getTradeCategoryById(categoryId);
        const nicheIds = category?.niches.map(n => n.id) || [];
        setSelectedNiches(niches => niches.filter(n => !nicheIds.includes(n)));
        return prev.filter(c => c !== categoryId);
      } else {
        return [...prev, categoryId];
      }
    });
  };

  const handleNicheToggle = (nicheId: string, categoryId: string) => {
    setSelectedNiches(prev => {
      if (nicheId === 'all') {
        const category = getTradeCategoryById(categoryId);
        if (!category) return prev;

        const allNicheIds = category.niches.map(n => n.id);
        const allSelected = allNicheIds.every(id => prev.includes(id));

        if (allSelected) {
          return prev.filter(n => !allNicheIds.includes(n));
        } else {
          const otherNiches = prev.filter(n => !allNicheIds.includes(n));
          return [...otherNiches, ...allNicheIds];
        }
      }

      if (prev.includes(nicheId)) {
        return prev.filter(n => n !== nicheId);
      } else {
        return [...prev, nicheId];
      }
    });
  };

  const availableNiches = selectedCategories.flatMap(catId => {
    const category = getTradeCategoryById(catId);
    return category?.niches.map(niche => ({ ...niche, categoryId: catId })) || [];
  });

  const handleStoreSelect = (storeId: string) => {
    setSelectedStore(storeId);
  };

  const handleSave = async (opts?: { silent?: boolean }): Promise<boolean> => {
    try {
      setIsLoading(true);
      await setBusinessSettings({
        ...businessSettings!,
        tradeCategories: selectedCategories.length > 0 ? selectedCategories : undefined,
        tradeNiches: selectedNiches.length > 0 ? selectedNiches : undefined,
        selectedStore: selectedStore,
      });
      initialSnapshotRef.current = JSON.stringify({
        cats: [...selectedCategories].sort(),
        niches: [...selectedNiches].sort(),
        store: selectedStore,
      });
      if (!opts?.silent) setShowSuccessModal(true);
      return true;
    } catch (error) {
      setShowErrorModal(true);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const { unsavedModalProps } = useUnsavedChangesGuard({
    isDirty,
    onSave: () => handleSave({ silent: true }),
  });

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <WebContainer>
          {/* Trade Categories */}
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Trade Categories</Title>
            <Text style={styles.helperText}>
              Select all categories that apply to your business
            </Text>

            <View style={styles.categoryGrid}>
              {TRADE_CATEGORIES.map((category) => {
                const isSelected = selectedCategories.includes(category.id);
                return (
                  <TouchableOpacity
                    key={category.id}
                    style={[
                      styles.categoryCard,
                      isSelected && styles.categoryCardSelected,
                    ]}
                    onPress={() => handleCategoryToggle(category.id)}
                  >
                    {isSelected && (
                      <View style={styles.categoryCheckmark}>
                        <MaterialCommunityIcons name="check-circle" size={20} color={colors.primary} />
                      </View>
                    )}
                    <View style={[styles.categoryIconContainer, { backgroundColor: category.color + '20' }]}>
                      <MaterialCommunityIcons
                        name={category.icon as any}
                        size={28}
                        color={isSelected ? colors.primary : category.color}
                      />
                    </View>
                    <View style={styles.categoryNameContainer}>
                      <Text
                        style={[
                          styles.categoryName,
                          isSelected && styles.categoryNameSelected
                        ]}
                        numberOfLines={3}
                        ellipsizeMode="tail"
                      >
                        {category.name}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Surface>

          {/* Trade Niches */}
          {selectedCategories.length > 0 && availableNiches.length > 0 && (
            <Surface style={styles.card}>
              <Title style={styles.sectionTitle}>Specialties / Niches</Title>
              <Text style={styles.helperText}>
                Select specific areas of expertise within your categories
              </Text>

              <View style={styles.pillContainer}>
                {availableNiches.map((niche) => {
                  const isSelected = selectedNiches.includes(niche.id);
                  return (
                    <Chip
                      key={`${niche.categoryId}-${niche.id}`}
                      selected={isSelected}
                      onPress={() => handleNicheToggle(niche.id, niche.categoryId)}
                      style={[
                        styles.nichePill,
                        isSelected && styles.nichePillSelected
                      ]}
                      textStyle={[
                        isSelected && styles.nichePillTextSelected,
                        isSelected && { color: colors.surface }
                      ]}
                      mode={isSelected ? 'flat' : 'outlined'}
                      icon={({ size }) => (
                        <MaterialCommunityIcons
                          name={niche.icon as any}
                          size={size}
                          color={isSelected ? colors.surface : colors.primary}
                        />
                      )}
                    >
                      {niche.name}
                    </Chip>
                  );
                })}
              </View>
            </Surface>
          )}

          {/* Hardware Store Selection */}
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Hardware Store</Title>
            <Text style={styles.helperText}>
              Select your preferred hardware store for pricing
            </Text>

            {/* Accurate Pricing Section */}
            <View style={styles.storeCategory}>
              <View style={styles.storeCategoryHeader}>
                <MaterialCommunityIcons name="check-circle" size={20} color="#4CAF50" />
                <Text style={styles.storeCategoryTitle}>More Accurate Pricing</Text>
              </View>
              <Text style={styles.storeCategoryDescription}>
                Stores with more reliable web search pricing or API access.
              </Text>

              <TouchableOpacity
                style={[
                  styles.storeRadioOption,
                  selectedStore === 'bunnings' && styles.storeRadioOptionSelected
                ]}
                onPress={() => handleStoreSelect('bunnings')}
              >
                <View style={styles.storeRadioLeft}>
                  <View style={[
                    styles.radioButton,
                    selectedStore === 'bunnings' && styles.radioButtonSelected
                  ]}>
                    {selectedStore === 'bunnings' && (
                      <View style={styles.radioButtonInner} />
                    )}
                  </View>
                  <View style={styles.storeInfo}>
                    <Text style={styles.storeName}>Bunnings</Text>
                    <Text style={styles.storeMethod}>Web Search</Text>
                  </View>
                </View>
                <MaterialCommunityIcons name="check-circle" size={20} color="#4CAF50" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.storeRadioOption,
                  selectedStore === 'reece' && styles.storeRadioOptionSelected,
                ]}
                onPress={() => {
                  if (reeceConnected) {
                    handleStoreSelect('reece');
                  } else {
                    navigation.navigate('ReeceIntegration' as never);
                  }
                }}
              >
                <View style={styles.storeRadioLeft}>
                  <View style={[
                    styles.radioButton,
                    selectedStore === 'reece' && reeceConnected && styles.radioButtonSelected,
                  ]}>
                    {selectedStore === 'reece' && reeceConnected ? (
                      <View style={styles.radioButtonInner} />
                    ) : null}
                  </View>
                  <View style={styles.storeInfo}>
                    <Text style={styles.storeName}>Reece</Text>
                    <Text style={styles.storeMethod}>
                      {reeceConnected ? 'Your real trade prices' : 'Plumbing supplier — connect your maX account'}
                    </Text>
                  </View>
                </View>
                {reeceConnected ? (
                  <MaterialCommunityIcons name="check-circle" size={20} color="#4CAF50" />
                ) : (
                  <View style={styles.connectBadge}>
                    <Text style={styles.connectBadgeText}>Connect</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* Guestimates Section */}
            <View style={styles.storeCategory}>
              <View style={styles.storeCategoryHeader}>
                <MaterialCommunityIcons name="approximately-equal" size={20} color="#FF9800" />
                <Text style={styles.storeCategoryTitle}>Guestimates</Text>
              </View>
              <Text style={styles.storeCategoryDescription}>
                Estimated pricing based on typical product costs
              </Text>

              {['mitre10', 'hth', 'totaltools', 'flexihire', 'sydneysolvents'].map((storeId) => {
                const storeNames: Record<string, string> = {
                  mitre10: 'Mitre 10',
                  hth: 'Home Timber & Hardware',
                  totaltools: 'Total Tools',
                  flexihire: 'Flexihire',
                  sydneysolvents: 'Sydney Solvents',
                };
                return (
                  <TouchableOpacity
                    key={storeId}
                    style={[
                      styles.storeRadioOption,
                      selectedStore === storeId && styles.storeRadioOptionSelected
                    ]}
                    onPress={() => handleStoreSelect(storeId)}
                  >
                    <View style={styles.storeRadioLeft}>
                      <View style={[
                        styles.radioButton,
                        selectedStore === storeId && styles.radioButtonSelected
                      ]}>
                        {selectedStore === storeId && (
                          <View style={styles.radioButtonInner} />
                        )}
                      </View>
                      <View style={styles.storeInfo}>
                        <Text style={styles.storeName}>{storeNames[storeId]}</Text>
                        <Text style={styles.storeMethod}>Price Estimate</Text>
                      </View>
                    </View>
                    <MaterialCommunityIcons name="approximately-equal" size={20} color="#FF9800" />
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.infoBox}>
              <MaterialCommunityIcons name="information" size={20} color={colors.primary} />
              <Text style={styles.infoBoxText}>
                {selectedStore === 'reece'
                  ? "Reece is selected. Quotes will use your real maX trade prices."
                  : selectedStore === 'bunnings'
                  ? "Bunnings is selected. Real prices will be fetched using the Bunnings web search when available."
                  : "Using estimated typical product pricing."
                }
              </Text>
            </View>
          </Surface>
        </WebContainer>
      </ScrollView>

      <FixedBottomButton
        mode="contained"
        label="Save"
        onPress={() => handleSave()}
        disabled={isLoading}
        loading={isLoading}
      />

      <AlertModal
        visible={showSuccessModal}
        onDismiss={() => setShowSuccessModal(false)}
        type="success"
        title="Saved!"
        message="Your trade and pricing settings have been updated."
      />

      <AlertModal
        visible={showErrorModal}
        onDismiss={() => setShowErrorModal(false)}
        type="error"
        title="Save Failed"
        message="Failed to save settings. Please try again."
      />

      <AlertModal {...unsavedModalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  helperText: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 16,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  categoryCard: {
    width: Platform.OS === 'web' ? 'calc(25% - 9px)' as any : '30.5%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 8,
    paddingTop: 12,
    paddingBottom: 12,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.outline + '30',
    height: 120,
    flexDirection: 'column',
  },
  categoryCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primary + '10',
  },
  categoryCheckmark: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 1,
  },
  categoryIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    flexShrink: 0,
  },
  categoryNameContainer: {
    width: '100%',
    paddingHorizontal: 4,
    flexShrink: 1,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  categoryName: {
    fontSize: 10,
    textAlign: 'center',
    color: colors.text,
    lineHeight: 13,
    flexShrink: 1,
  },
  categoryNameSelected: {
    fontWeight: '600',
    color: colors.primary,
  },
  pillContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  nichePill: {
    marginRight: 0,
    marginBottom: 0,
  },
  nichePillSelected: {
    backgroundColor: colors.primary,
  },
  nichePillTextSelected: {
    color: colors.surface,
    fontWeight: '600',
  },
  storeCategory: {
    marginTop: 16,
    marginBottom: 16,
  },
  storeCategoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  storeCategoryTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
    color: colors.text,
  },
  storeCategoryDescription: {
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 12,
    marginLeft: 28,
  },
  storeRadioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.outline + '30',
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  storeRadioOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  storeRadioOptionDisabled: {
    opacity: 0.5,
    backgroundColor: colors.surface,
  },
  storeRadioLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  radioButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.outline,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioButtonSelected: {
    borderColor: colors.primary,
  },
  radioButtonInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  radioButtonDisabled: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.outline,
  },
  storeInfo: {
    flex: 1,
  },
  storeName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  storeNameDisabled: {
    color: colors.onSurface,
  },
  storeMethod: {
    fontSize: 12,
    color: colors.onSurface,
  },
  comingSoonBadge: {
    backgroundColor: colors.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  comingSoonText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  connectBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  connectBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.surface,
    letterSpacing: 0.4,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  infoBoxText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
});
