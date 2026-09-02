/**
 * Trade & Pricing Settings Screen
 * Trade categories, niches, and hardware store selection
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
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
import {
  NestableScrollContainer,
  NestableDraggableFlatList,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';

import { useStore } from '../../store/useStore';
import { makeStyles, useThemeColors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { AlertModal } from '../../components/AlertModal';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import {
  TRADE_CATEGORIES,
  getTradeCategoryById,
} from '../../constants/tradeCategories';
import { getReeceConnectionStatus } from '../../services/reeceApi';
import { loadGroups } from '../../services/supplierGroupService';
import { composeSupplierList, type SupplierEntry } from '../../services/supplierPriority';
import type { SupplierGroup } from '../../types';
import { GridBackground } from '../../components/GridBackground';
import { rateSummary, removePreference, removeRate } from '../../services/quotingProfile';

export function TradePricingScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const { businessSettings, setBusinessSettings } = useStore();

  const navigation = useNavigation<any>();

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedNiches, setSelectedNiches] = useState<string[]>([]);
  const [reeceConnected, setReeceConnected] = useState<boolean>(false);
  const [supplierGroups, setSupplierGroups] = useState<SupplierGroup[]>([]);
  const [supplierPriority, setSupplierPriority] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);

  // Compose the unified ordered supplier list any time inputs change. Drives
  // both the visible list and the saved priority that gets persisted.
  const orderedSuppliers: SupplierEntry[] = useMemo(
    () =>
      composeSupplierList({
        savedPriority: supplierPriority,
        reeceConnected,
        localGroups: supplierGroups,
      }),
    [supplierPriority, reeceConnected, supplierGroups],
  );

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
      const priority = businessSettings.supplierPriority || [];
      setSelectedCategories(cats);
      setSelectedNiches(niches);
      setSupplierPriority(priority);
      setInitialSnapshot(JSON.stringify({
        cats: [...cats].sort(),
        niches: [...niches].sort(),
        priority,
      }));
    }
  }, [businessSettings]);

  // Load the user's local supplier groups (for the draggable list). Refresh
  // on focus so adding/editing a supplier in the Supplier Book reflects
  // immediately when the user comes back.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadGroups()
        .then((groups) => {
          if (!cancelled) setSupplierGroups(groups || []);
        })
        .catch(() => {
          if (!cancelled) setSupplierGroups([]);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const isDirty = useMemo(() => {
    if (!initialSnapshot) return false;
    const current = JSON.stringify({
      cats: [...selectedCategories].sort(),
      niches: [...selectedNiches].sort(),
      priority: supplierPriority,
    });
    return current !== initialSnapshot;
  }, [selectedCategories, selectedNiches, supplierPriority, initialSnapshot]);

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

  // "How you quote" — rules and rates Mate saved from chat. Removing one
  // saves straight away: it is not part of this screen's draft/Save cycle
  // (the snapshot above tracks categories, niches and priority only), and a
  // wrong rule left in place is applied to the very next quote.
  const quotingPreferences = businessSettings?.quotingPreferences ?? [];
  const rateCard = businessSettings?.rateCard ?? [];
  const handleRemovePreference = useCallback(async (text: string) => {
    if (!businessSettings) return;
    try {
      const next = removePreference(businessSettings.quotingPreferences, text);
      await setBusinessSettings({ ...businessSettings, quotingPreferences: next.length ? next : undefined });
    } catch {
      setShowErrorModal(true);
    }
  }, [businessSettings, setBusinessSettings]);
  const handleRemoveRate = useCallback(async (id: string) => {
    if (!businessSettings) return;
    try {
      const next = removeRate(businessSettings.rateCard, id);
      await setBusinessSettings({ ...businessSettings, rateCard: next.length ? next : undefined });
    } catch {
      setShowErrorModal(true);
    }
  }, [businessSettings, setBusinessSettings]);

  const handleSave = async (opts?: { silent?: boolean }): Promise<boolean> => {
    try {
      setIsLoading(true);
      await setBusinessSettings({
        ...businessSettings!,
        tradeCategories: selectedCategories.length > 0 ? selectedCategories : undefined,
        tradeNiches: selectedNiches.length > 0 ? selectedNiches : undefined,
        supplierPriority: supplierPriority.length > 0 ? supplierPriority : undefined,
      });
      setInitialSnapshot(JSON.stringify({
        cats: [...selectedCategories].sort(),
        niches: [...selectedNiches].sort(),
        priority: supplierPriority,
      }));
      if (!opts?.silent) setShowSuccessModal(true);
      return true;
    } catch (error) {
      setShowErrorModal(true);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // Drag-end handler for the supplier priority list. The composed list is
  // canonical (already accounts for connection + new groups), so we capture
  // its IDs in their new order.
  const handleSupplierReorder = useCallback((data: SupplierEntry[]) => {
    setSupplierPriority(data.map((entry) => entry.id));
  }, []);

  const { unsavedModalProps } = useUnsavedChangesGuard({
    isDirty,
    onSave: () => handleSave({ silent: true }),
  });

  const renderSupplierItem = ({ item, drag, isActive }: RenderItemParams<SupplierEntry>) => {
    const iconName: any =
      item.kind === 'bunnings' ? 'hammer-wrench'
      : item.kind === 'reece' ? 'pipe'
      : 'storefront-outline';
    const iconColor =
      item.kind === 'reece' ? themeColors.money
      : item.kind === 'bunnings' ? themeColors.warning
      : themeColors.accent;

    const tapAction = () => {
      if (item.kind === 'reece' && !reeceConnected) {
        navigation.navigate('ReeceIntegration');
      } else if (item.kind === 'local' && item.group) {
        navigation.navigate('EditSupplier', { groupId: item.group.id });
      }
    };
    const isTappable = (item.kind === 'reece' && !reeceConnected) || item.kind === 'local';

    return (
      <View style={[styles.supplierRow, isActive && styles.supplierRowActive]}>
        {/* Drag handle. Using Pressable (not TouchableOpacity) to match the
            JobChecklist pattern — TouchableOpacity's tap-feedback animation
            bubbles up to the parent NestableScrollContainer and triggers a
            scroll-to-top when the handle is tapped without a long-press.
            Hidden on web, where reordering isn't available (see web branch below). */}
        {Platform.OS !== 'web' ? (
          <Pressable
            onLongPress={drag}
            delayLongPress={150}
            disabled={isActive}
            style={styles.supplierDragHandle}
            hitSlop={6}
          >
            <MaterialCommunityIcons name="drag-vertical" size={20} color={themeColors.textMuted} />
          </Pressable>
        ) : null}
        <MaterialCommunityIcons name={iconName} size={22} color={iconColor} style={{ marginRight: 12 }} />
        {/* Body — tap to navigate where applicable; built-in always-on
            suppliers (Bunnings, connected Reece) just sit there. */}
        <TouchableOpacity
          style={{ flex: 1 }}
          activeOpacity={isTappable ? 0.7 : 1}
          onPress={isTappable ? tapAction : undefined}
          disabled={!isTappable}
        >
          <Text style={styles.supplierName}>{item.name}</Text>
          <Text style={styles.supplierSubtitle}>{item.subtitle}</Text>
        </TouchableOpacity>
        {item.kind === 'reece' && !reeceConnected ? (
          <TouchableOpacity onPress={tapAction} style={styles.connectBadge}>
            <Text style={styles.connectBadgeText}>Connect</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  // react-native-draggable-flatlist's cells call findNodeHandle on mount,
  // which react-native-web@0.20 removed and throws on. So on web we swap the
  // Nestable containers for a plain ScrollView + a static (non-draggable) list
  // — nothing from the draggable-flatlist library mounts there. Native keeps
  // the drag-reorder experience unchanged. Mirrors JobChecklist's web gate.
  const ScrollContainer = Platform.OS !== 'web' ? NestableScrollContainer : ScrollView;

  return (
    <View style={styles.container}>
      <GridBackground />
      <ScrollContainer
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
                        <MaterialCommunityIcons name="check-circle" size={20} color={themeColors.accentText} />
                      </View>
                    )}
                    <View style={[styles.categoryIconContainer, { backgroundColor: category.color + '20' }]}>
                      <MaterialCommunityIcons
                        name={category.icon as any}
                        size={28}
                        color={isSelected ? themeColors.accent : category.color}
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
                        isSelected && { color: themeColors.surfaceRaised }
                      ]}
                      mode={isSelected ? 'flat' : 'outlined'}
                      icon={({ size }) => (
                        <MaterialCommunityIcons
                          name={niche.icon as any}
                          size={size}
                          color={isSelected ? themeColors.surfaceRaised : themeColors.accent}
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

          {/* How you quote — only once Mate has saved something, so the 95%
              who never state a rule or a rate never see an empty card. */}
          {(quotingPreferences.length > 0 || rateCard.length > 0) && (
            <Surface style={styles.card}>
              <Title style={styles.sectionTitle}>How you quote</Title>
              <Text style={styles.helperText}>
                Rules and rates Mate has saved from your chats. Every quote follows them — remove anything that's off.
              </Text>
              {quotingPreferences.map((pref) => (
                <View key={pref} style={styles.profileRow}>
                  <Text style={styles.profileText}>{pref}</Text>
                  <TouchableOpacity
                    style={styles.profileRemove}
                    onPress={() => handleRemovePreference(pref)}
                    accessibilityLabel={`Remove preference: ${pref}`}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialCommunityIcons name="close-circle-outline" size={20} color={themeColors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
              {rateCard.map((rate) => (
                <View key={rate.id} style={styles.profileRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.supplierName}>{rate.label}</Text>
                    <Text style={styles.supplierSubtitle}>{rateSummary(rate)}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.profileRemove}
                    onPress={() => handleRemoveRate(rate.id)}
                    accessibilityLabel={`Remove rate: ${rate.label}`}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialCommunityIcons name="close-circle-outline" size={20} color={themeColors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </Surface>
          )}

          {/* Hardware Store Priority */}
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Hardware Stores</Title>
            <Text style={styles.helperText}>
              {Platform.OS !== 'web'
                ? "Quotes search these suppliers in order. Long-press and drag to change priority — whoever's at the top is tried first."
                : "Quotes search these suppliers in order — whoever's at the top is tried first. Reorder them in the app."}
            </Text>

            <TouchableOpacity
              style={styles.addSupplierButton}
              onPress={() => navigation.navigate('AddMaterialStandalone', { supplierBookOnly: true })}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="plus-circle-outline" size={20} color={themeColors.accentText} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.addSupplierTitle}>Add another supplier</Text>
                <Text style={styles.addSupplierSubtitle}>
                  Drop in your own price list — opens the Supplier Book.
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={themeColors.textMuted} />
            </TouchableOpacity>

            {Platform.OS !== 'web' ? (
              <NestableDraggableFlatList
                data={orderedSuppliers}
                keyExtractor={(item) => item.id}
                renderItem={renderSupplierItem}
                onDragEnd={({ data }) => handleSupplierReorder(data)}
                activationDistance={8}
                containerStyle={{ marginTop: 12 }}
              />
            ) : (
              <View style={{ marginTop: 12 }}>
                {orderedSuppliers.map((item) => (
                  <React.Fragment key={item.id}>
                    {renderSupplierItem({ item, drag: () => {}, isActive: false, getIndex: () => undefined })}
                  </React.Fragment>
                ))}
              </View>
            )}
          </Surface>
        </WebContainer>
      </ScrollContainer>

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

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
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
    backgroundColor: t.colors.surfaceRaised,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  helperText: {
    fontSize: 14,
    color: t.colors.textSecondary,
    marginBottom: 16,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  categoryCard: {
    width: Platform.OS === 'web' ? 'calc(25% - 9px)' as any : '30.5%',
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 12,
    padding: 8,
    paddingTop: 12,
    paddingBottom: 12,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: t.colors.border,
    height: 120,
    flexDirection: 'column',
  },
  categoryCardSelected: {
    borderColor: t.colors.accent,
    borderWidth: 2,
    backgroundColor: t.colors.accentSubtle,
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
    color: t.colors.text,
    lineHeight: 13,
    flexShrink: 1,
  },
  categoryNameSelected: {
    fontWeight: '600',
    color: t.colors.accentText,
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
    backgroundColor: t.colors.accent,
  },
  nichePillTextSelected: {
    color: t.colors.onAccent,
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
    color: t.colors.text,
  },
  storeCategoryDescription: {
    fontSize: 13,
    color: t.colors.textSecondary,
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
    borderColor: t.colors.border,
    marginBottom: 8,
    backgroundColor: t.colors.surfaceRaised,
  },
  storeRadioOptionSelected: {
    borderColor: t.colors.accent,
    backgroundColor: t.colors.accentSubtle,
  },
  storeRadioOptionDisabled: {
    opacity: 0.5,
    backgroundColor: t.colors.surfaceRaised,
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
    borderColor: t.colors.borderStrong,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioButtonSelected: {
    borderColor: t.colors.accent,
  },
  radioButtonInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: t.colors.accent,
  },
  radioButtonDisabled: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: t.colors.borderStrong,
  },
  storeInfo: {
    flex: 1,
  },
  storeName: {
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.text,
    marginBottom: 2,
  },
  storeNameDisabled: {
    color: t.colors.textSecondary,
  },
  storeMethod: {
    fontSize: 12,
    color: t.colors.textSecondary,
  },
  comingSoonBadge: {
    backgroundColor: t.colors.accentSubtle,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  comingSoonText: {
    fontSize: 11,
    fontWeight: '600',
    color: t.colors.accentText,
  },
  connectBadge: {
    backgroundColor: t.colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  connectBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.colors.onAccent,
    letterSpacing: 0.4,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  profileText: {
    flex: 1,
    fontSize: 14,
    color: t.colors.text,
    lineHeight: 20,
  },
  profileRemove: {
    paddingLeft: 12,
    paddingVertical: 4,
  },
  addSupplierButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderStyle: 'dashed',
  },
  supplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingVertical: 12,
    paddingLeft: 4,
    paddingRight: 12,
    marginBottom: 8,
  },
  supplierDragHandle: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginRight: 4,
  },
  supplierRowActive: {
    borderColor: t.colors.accent,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  supplierName: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
  },
  supplierSubtitle: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  addSupplierTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
  },
  addSupplierSubtitle: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: t.colors.surfaceRaised,
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  infoBoxText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: t.colors.text,
    lineHeight: 18,
  },
}));
