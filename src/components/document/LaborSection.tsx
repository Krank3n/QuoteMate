import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text, Title, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { LaborUnit, QuoteSection } from '../../types';
import { documentStyles as styles } from './documentStyles';

interface LaborSectionProps {
  laborHours: number;
  laborRate: number;
  laborTotal: number;
  laborUnit?: LaborUnit;
  sections?: QuoteSection[];
  showLaborHours?: boolean;
  onEdit?: () => void;
}

export function LaborSection({
  laborHours,
  laborRate,
  laborTotal,
  laborUnit,
  sections,
  showLaborHours,
  onEdit,
}: LaborSectionProps) {
  const unit = laborUnit || 'hours';
  const unitLabel = unit === 'days' ? 'days' : 'hours';
  const rateLabel = unit === 'days' ? '/day' : '/hr';
  const hasSections = sections && sections.length > 0;

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
      {hasSections ? (
        <>
          {sections.map((section) => {
            const sUnit = section.laborUnit || 'hours';
            const sUnitLabel = sUnit === 'days' ? 'days' : 'hours';
            const sRateLabel = sUnit === 'days' ? '/day' : '/hr';
            return (
              <View key={section.id} style={styles.summaryRow}>
                <Text style={styles.text}>
                  {showLaborHours
                    ? `${section.name}: ${section.laborHours} ${sUnitLabel} @ ${formatCurrency(section.laborRate)}${sRateLabel}`
                    : section.name}
                </Text>
                <Text style={styles.summaryValue}>{formatCurrency(section.laborTotal)}</Text>
              </View>
            );
          })}
          <View style={[styles.summaryRow, { marginTop: 4 }]}>
            <Text style={[styles.text, { fontWeight: '600' }]}>Labor Total</Text>
            <Text style={[styles.summaryValue, { fontWeight: '700' }]}>{formatCurrency(laborTotal)}</Text>
          </View>
        </>
      ) : (
        <View style={styles.summaryRow}>
          <Text style={styles.text}>
            {showLaborHours
              ? `${laborHours} ${unitLabel} @ ${formatCurrency(laborRate)}${rateLabel}`
              : 'Labor'}
          </Text>
          <Text style={styles.summaryValue}>{formatCurrency(laborTotal)}</Text>
        </View>
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
