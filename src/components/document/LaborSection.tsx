import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text, Title, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { documentStyles as styles } from './documentStyles';

interface LaborSectionProps {
  laborHours: number;
  laborRate: number;
  laborTotal: number;
  showLaborHours?: boolean;
  onEdit?: () => void;
}

export function LaborSection({
  laborHours,
  laborRate,
  laborTotal,
  showLaborHours,
  onEdit,
}: LaborSectionProps) {
  const content = (
    <Surface style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <View style={[styles.sectionIconCircle, { backgroundColor: colors.successBg }]}>
            <MaterialCommunityIcons name="clock-outline" size={18} color={colors.success} />
          </View>
          <Title style={styles.sectionTitle}>Labor</Title>
        </View>
        {onEdit && (
          <View style={styles.editButton}>
            <MaterialCommunityIcons name="pencil" size={16} color={colors.primary} />
          </View>
        )}
      </View>
      <View style={styles.summaryRow}>
        <Text style={styles.text}>
          {showLaborHours
            ? `${laborHours} hours @ ${formatCurrency(laborRate)}/hr`
            : 'Labor'}
        </Text>
        <Text style={styles.summaryValue}>{formatCurrency(laborTotal)}</Text>
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
