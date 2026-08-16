import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text, Title, Surface, Divider } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useThemeColors} from '../../theme';
import { Material } from '../../types';
import { formatCurrency } from '../../utils/quoteCalculator';
import { isScopeQuote } from '../../../shared/pdf';
import {
  lineMarkupMultiplier,
  markupableMaterialsTotal,
  workItemsTotal,
} from '../../../shared/document/lumpSum';
import { useDocumentStyles } from './documentStyles';

interface MaterialsSectionProps {
  materials: Material[];
  materialsSubtotal: number;
  onEdit?: () => void;
  emptyMessage?: string;
  markupPercent?: number;
  rollMarkupIntoMaterials?: boolean;
  style?: any;
}

export function MaterialsSection({
  materials,
  materialsSubtotal,
  onEdit,
  emptyMessage = 'No materials required - Labour only',
  markupPercent = 0,
  rollMarkupIntoMaterials = false,
  style,
}: MaterialsSectionProps) {
  const styles = useDocumentStyles();
  const themeColors = useThemeColors();
  const multiplier = rollMarkupIntoMaterials && markupPercent > 0 ? (1 + markupPercent / 100) : 1;
  // Work items never take markup, so the preview must agree with the PDF line
  // for line — see shared/document/lumpSum.ts. A quote that is all scope lines
  // has nothing markupable in it, so the "(incl. X% markup)" note goes too.
  const displaySubtotal =
    workItemsTotal(materials) + markupableMaterialsTotal(materialsSubtotal, materials) * multiplier;
  const showMarkedUp = multiplier > 1 && markupableMaterialsTotal(materialsSubtotal, materials) > 0;
  // The same derived rule the PDF uses: when every line is a lump-sum scope
  // line the customer's document is a Project Scope table, so the in-app
  // preview says the same thing rather than "Materials".
  const isScopeOnly = isScopeQuote(materials);

  const content = (
    <Surface style={[styles.section, style]}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <View style={[styles.sectionIconCircle, { backgroundColor: themeColors.accentSubtle }]}>
            <MaterialCommunityIcons name="package-variant" size={18} color={themeColors.accentText} />
          </View>
          <Title style={styles.sectionTitle}>
            {isScopeOnly ? 'Project Scope' : 'Materials'} ({materials.length})
          </Title>
        </View>
        {onEdit && (
          <View style={styles.editButton}>
            <MaterialCommunityIcons name="pencil" size={16} color={themeColors.accentText} />
          </View>
        )}
      </View>
      {materials.length === 0 ? (
        <Text style={styles.subtext}>{emptyMessage}</Text>
      ) : (
        materials.map((material) => (
          <View key={material.id} style={styles.itemRow}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemName}>{material.name}</Text>
              {material.kind === 'work' ? (
                // A lump-sum scope line has no unit price and no meaningful
                // quantity — the scope paragraph is what the customer reads.
                material.scope?.trim() ? (
                  <Text style={styles.itemDetails}>{material.scope.trim()}</Text>
                ) : null
              ) : showMarkedUp ? (
                <Text style={styles.itemDetails}>
                  {material.quantity} {material.unit} ×{' '}
                  <Text style={{ textDecorationLine: 'line-through', color: themeColors.textMuted }}>
                    {formatCurrency(material.price)}
                  </Text>
                  {' → '}
                  {formatCurrency(material.price * multiplier)}
                </Text>
              ) : (
                <Text style={styles.itemDetails}>
                  {material.quantity} {material.unit} × {formatCurrency(material.price)}
                </Text>
              )}
            </View>
            <Text style={styles.itemTotal}>
              {formatCurrency(material.totalPrice * lineMarkupMultiplier(material, multiplier))}
            </Text>
          </View>
        ))
      )}
      <Divider style={styles.divider} />
      <View style={styles.summaryRow}>
        <Text style={styles.summaryLabel}>{isScopeOnly ? 'Subtotal' : 'Materials Subtotal'}</Text>
        <Text style={styles.summaryValue}>{formatCurrency(displaySubtotal)}</Text>
      </View>
      {showMarkedUp && (
        <Text style={{ fontSize: 11, color: themeColors.textMuted, textAlign: 'right', marginTop: 2 }}>
          (incl. {markupPercent}% markup)
        </Text>
      )}
    </Surface>
  );

  if (onEdit) {
    return (
      <TouchableOpacity onPress={onEdit} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}
