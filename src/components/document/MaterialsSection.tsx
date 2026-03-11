import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text, Title, Surface, Divider } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme';
import { Material } from '../../types';
import { formatCurrency } from '../../utils/quoteCalculator';
import { documentStyles as styles } from './documentStyles';

interface MaterialsSectionProps {
  materials: Material[];
  materialsSubtotal: number;
  onEdit?: () => void;
  emptyMessage?: string;
}

export function MaterialsSection({
  materials,
  materialsSubtotal,
  onEdit,
  emptyMessage = 'No materials required - Labor only',
}: MaterialsSectionProps) {
  const content = (
    <Surface style={styles.section}>
      <View style={styles.sectionHeader}>
        <Title style={styles.sectionTitle}>Materials ({materials.length})</Title>
        {onEdit && <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />}
      </View>
      {materials.length === 0 ? (
        <Text style={styles.subtext}>{emptyMessage}</Text>
      ) : (
        materials.map((material) => (
          <View key={material.id} style={styles.itemRow}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemName}>{material.name}</Text>
              <Text style={styles.itemDetails}>
                {material.quantity} {material.unit} × {formatCurrency(material.price)}
              </Text>
            </View>
            <Text style={styles.itemTotal}>{formatCurrency(material.totalPrice)}</Text>
          </View>
        ))
      )}
      <Divider style={styles.divider} />
      <View style={styles.summaryRow}>
        <Text style={styles.summaryLabel}>Materials Subtotal</Text>
        <Text style={styles.summaryValue}>{formatCurrency(materialsSubtotal)}</Text>
      </View>
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
