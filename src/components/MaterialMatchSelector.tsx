/**
 * Material Match Selector Component
 *
 * Modal that displays multiple product matches from hardware stores
 * and allows users to select the best one for their material.
 * Supports saving as a favorite for future quotes.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Linking,
} from 'react-native';
import { ProductMatch, QuantityAdjustment } from '../services/webScrapingPricing';
import { makeStyles, useThemeColors } from '../theme';

interface Props {
  visible: boolean;
  materialName: string;
  matches: ProductMatch[];
  quantityAdjustment?: QuantityAdjustment;
  onSelect: (match: ProductMatch, saveAsFavorite: boolean) => void;
  onCancel: () => void;
}

export default function MaterialMatchSelector({
  visible,
  materialName,
  matches,
  quantityAdjustment,
  onSelect,
  onCancel,
}: Props) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [selectedMatch, setSelectedMatch] = useState<ProductMatch | null>(null);
  const [saveAsFavorite, setSaveAsFavorite] = useState(true);

  const handleConfirm = () => {
    if (selectedMatch) {
      onSelect(selectedMatch, saveAsFavorite);
      setSelectedMatch(null);
      setSaveAsFavorite(true);
    }
  };

  const getStockColor = (stockLevel?: ProductMatch['stockLevel']) => {
    switch (stockLevel) {
      case 'in-stock':
        return themeColors.money;
      case 'low-stock':
        return themeColors.warning;
      case 'out-of-stock':
        return themeColors.error;
      default:
        return themeColors.textMuted;
    }
  };

  const getConfidenceBadge = (confidence: 'high' | 'medium' | 'low') => {
    const badge = {
      high: { bg: themeColors.moneySubtle, text: themeColors.money },
      medium: { bg: themeColors.warningSubtle, text: themeColors.warning },
      low: { bg: themeColors.errorSubtle, text: themeColors.error },
    };
    return badge[confidence];
  };

  // Without onRequestClose, Android's Back skipped this modal and closed the
  // app instead of cancelling the pick.
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Select Product</Text>
            <Text style={styles.subtitle}>{materialName}</Text>
          </View>

          {/* Quantity Adjustment Notice */}
          {quantityAdjustment && (
            <View style={styles.adjustmentNotice}>
              <Text style={styles.adjustmentIcon}>⚠️</Text>
              <View style={styles.adjustmentText}>
                <Text style={styles.adjustmentTitle}>Quantity Adjusted</Text>
                <Text style={styles.adjustmentReason}>{quantityAdjustment.reason}</Text>
              </View>
            </View>
          )}

          {/* Product List */}
          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={true}>
            {matches.map((match, index) => {
              const isSelected = selectedMatch?.productName === match.productName;
              const confidenceBadge = getConfidenceBadge(match.confidence);

              return (
                <TouchableOpacity
                  key={index}
                  style={[styles.productCard, isSelected && styles.productCardSelected]}
                  onPress={() => setSelectedMatch(match)}
                  activeOpacity={0.7}
                >
                  {/* Product Name & Confidence */}
                  <View style={styles.productHeader}>
                    <Text style={styles.productName} numberOfLines={2}>
                      {match.productName}
                    </Text>
                    <View
                      style={[styles.confidenceBadge, { backgroundColor: confidenceBadge.bg }]}
                    >
                      <Text style={[styles.confidenceText, { color: confidenceBadge.text }]}>
                        {match.confidence.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  {/* Description */}
                  {match.description && (
                    <Text style={styles.productDescription} numberOfLines={2}>
                      {match.description}
                    </Text>
                  )}

                  {/* Details Grid */}
                  <View style={styles.detailsGrid}>
                    {/* Price */}
                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>Price</Text>
                      <Text style={styles.priceValue}>${match.price.toFixed(2)}</Text>
                      {match.pricePerUnit && (
                        <Text style={styles.pricePerUnit}>{match.pricePerUnit}</Text>
                      )}
                    </View>

                    {/* Dimensions */}
                    {match.dimensions && (
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Dimensions</Text>
                        <Text style={styles.detailValue}>{match.dimensions}</Text>
                      </View>
                    )}

                    {/* Brand */}
                    {match.brand && (
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Brand</Text>
                        <Text style={styles.detailValue}>{match.brand}</Text>
                      </View>
                    )}

                    {/* Item Number */}
                    {match.itemNumber && (
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Item #</Text>
                        <Text style={styles.detailValue}>{match.itemNumber}</Text>
                      </View>
                    )}
                  </View>

                  {/* Stock Level */}
                  <View style={styles.footer}>
                    <View style={styles.stockBadge}>
                      <View
                        style={[
                          styles.stockDot,
                          { backgroundColor: getStockColor(match.stockLevel) },
                        ]}
                      />
                      <Text style={styles.stockText}>
                        {match.stockLevel
                          ? match.stockLevel.replace('-', ' ').toUpperCase()
                          : 'UNKNOWN'}
                      </Text>
                    </View>

                    {/* Store */}
                    <Text style={styles.storeText}>{match.store}</Text>
                  </View>

                  {/* Product URL */}
                  {match.productUrl && (
                    <TouchableOpacity
                      onPress={() => Linking.openURL(match.productUrl!)}
                      style={styles.linkButton}
                    >
                      <Text style={styles.linkText}>View on website →</Text>
                    </TouchableOpacity>
                  )}

                  {/* Selection Indicator */}
                  {isSelected && (
                    <View style={styles.selectedIndicator}>
                      <Text style={styles.checkmark}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Save as Favorite Toggle */}
          <View style={styles.favoriteToggle}>
            <View style={styles.favoriteLabel}>
              <Text style={styles.favoriteText}>Save as favorite</Text>
              <Text style={styles.favoriteSubtext}>Remember this choice for future quotes</Text>
            </View>
            <Switch value={saveAsFavorite} onValueChange={setSaveAsFavorite} />
          </View>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmButton, !selectedMatch && styles.confirmButtonDisabled]}
              onPress={handleConfirm}
              disabled={!selectedMatch}
            >
              <Text style={styles.confirmButtonText}>
                {selectedMatch ? 'Confirm Selection' : 'Select a Product'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  overlay: {
    flex: 1,
    backgroundColor: t.colors.backdrop,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '90%',
    maxHeight: '85%',
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 16,
    overflow: 'hidden',
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: t.colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: t.colors.textMuted,
  },
  adjustmentNotice: {
    flexDirection: 'row',
    backgroundColor: t.colors.warningSubtle,
    padding: 16,
    margin: 16,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: t.colors.warning,
  },
  adjustmentIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  adjustmentText: {
    flex: 1,
  },
  adjustmentTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.warning,
    marginBottom: 4,
  },
  adjustmentReason: {
    fontSize: 13,
    color: t.colors.warning,
    lineHeight: 18,
  },
  scrollView: {
    maxHeight: 400,
    padding: 16,
  },
  productCard: {
    backgroundColor: t.colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: t.colors.border,
    position: 'relative',
  },
  productCardSelected: {
    borderColor: t.colors.accent,
    backgroundColor: t.colors.accentSubtle,
  },
  productHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  productName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.text,
    marginRight: 8,
  },
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  confidenceText: {
    fontSize: 10,
    fontWeight: '700',
  },
  productDescription: {
    fontSize: 13,
    color: t.colors.textMuted,
    marginBottom: 12,
    lineHeight: 18,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  detailItem: {
    width: '50%',
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 11,
    color: t.colors.textDisabled,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    color: t.colors.text,
    fontWeight: '500',
  },
  priceValue: {
    fontSize: 18,
    color: t.colors.money,
    fontWeight: '700',
  },
  pricePerUnit: {
    fontSize: 11,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  stockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stockDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  stockText: {
    fontSize: 11,
    color: t.colors.textMuted,
    fontWeight: '600',
  },
  storeText: {
    fontSize: 12,
    color: t.colors.textDisabled,
  },
  linkButton: {
    marginTop: 8,
  },
  linkText: {
    fontSize: 13,
    color: t.colors.accentText,
    fontWeight: '600',
  },
  selectedIndicator: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: t.colors.onAccent,
    fontSize: 18,
    fontWeight: '700',
  },
  favoriteToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: t.colors.surface,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  favoriteLabel: {
    flex: 1,
    marginRight: 12,
  },
  favoriteText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
    marginBottom: 2,
  },
  favoriteSubtext: {
    fontSize: 12,
    color: t.colors.textMuted,
  },
  actions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    backgroundColor: t.colors.surfacePressed,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
  confirmButton: {
    flex: 2,
    padding: 14,
    borderRadius: 8,
    backgroundColor: t.colors.accent,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: t.colors.textDisabled,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.onAccent,
  },
}));
