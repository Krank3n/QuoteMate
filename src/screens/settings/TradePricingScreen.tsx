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

  const navigation = useNavigation<any>();

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedNiches, setSelectedNiches] = useState<string[]>([]);
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
      setSelectedCategories(cats);
      setSelectedNiches(niches);
      initialSnapshotRef.current = JSON.stringify({ cats: [...cats].sort(), niches: [...niches].sort() });
    }
  }, [businessSettings]);

  const isDirty = useMemo(() => {
    if (!initialSnapshotRef.current) return false;
    const current = JSON.stringify({
      cats: [...selectedCategories].sort(),
      niches: [...selectedNiches].sort(),
    });
    return current !== initialSnapshotRef.current;
  }, [selectedCategories, selectedNiches]);

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

  const handleSave = async (opts?: { silent?: boolean }): Promise<boolean> => {
    try {
      setIsLoading(true);
      await setBusinessSettings({
        ...businessSettings!,
        tradeCategories: selectedCategories.length > 0 ? selectedCategories : undefined,
        tradeNiches: selectedNiches.length > 0 ? selectedNiches : undefined,
      });
      initialSnapshotRef.current = JSON.stringify({
        cats: [...selectedCategories].sort(),
        niches: [...selectedNiches].sort(),
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
            <Title style={styles.sectionTitle}>Hardware Stores</Title>
            <Text style={styles.helperText}>
              Quotes search Bunnings as the default backbone. When Reece is connected, plumbing supplies are priced from Reece first and fall back to Bunnings if there's no match.
            </Text>

            {/* Bunnings — always on, not selectable */}
            <View style={[styles.storeRadioOption, styles.storeRadioOptionSelected]}>
              <View style={styles.storeRadioLeft}>
                <MaterialCommunityIcons name="check-circle" size={22} color={colors.success} style={{ marginRight: 12 }} />
                <View style={styles.storeInfo}>
                  <Text style={styles.storeName}>Bunnings</Text>
                  <Text style={styles.storeMethod}>Always on — searched on every quote</Text>
                </View>
              </View>
            </View>

            {/* Reece — always on when connected, otherwise tap to connect */}
            <TouchableOpacity
              style={[
                styles.storeRadioOption,
                reeceConnected && styles.storeRadioOptionSelected,
              ]}
              onPress={() => {
                if (!reeceConnected) {
                  navigation.navigate('ReeceIntegration' as never);
                }
              }}
              activeOpacity={reeceConnected ? 1 : 0.7}
            >
              <View style={styles.storeRadioLeft}>
                <MaterialCommunityIcons
                  name={reeceConnected ? 'check-circle' : 'pipe'}
                  size={22}
                  color={reeceConnected ? colors.success : colors.primary}
                  style={{ marginRight: 12 }}
                />
                <View style={styles.storeInfo}>
                  <Text style={styles.storeName}>Reece</Text>
                  <Text style={styles.storeMethod}>
                    {reeceConnected
                      ? 'Always on — your trade prices are preferred for plumbing'
                      : 'Plumbing supplier — connect your maX account for trade prices'}
                  </Text>
                </View>
              </View>
              {reeceConnected ? null : (
                <View style={styles.connectBadge}>
                  <Text style={styles.connectBadgeText}>Connect</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.addSupplierButton}
              onPress={() => navigation.navigate('AddMaterialStandalone', { supplierBookOnly: true })}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="plus-circle-outline" size={20} color={colors.primary} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.addSupplierTitle}>Add another supplier</Text>
                <Text style={styles.addSupplierSubtitle}>
                  Drop in your own price list — opens the Supplier Book.
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
            </TouchableOpacity>
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
  addSupplierButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  addSupplierTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  addSupplierSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
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
