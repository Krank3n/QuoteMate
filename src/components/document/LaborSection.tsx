import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text, Title, Surface, Divider } from 'react-native-paper';
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
  // When the markup line is hidden, fold the labor markup into the displayed labor total
  // so the displayed numbers reconcile to the grand total.
  laborMarkupPercent?: number;
  rollMarkupIntoLabor?: boolean;
  // Extra labour hours added on top of (or subtracted from) the section sums.
  // Rendered as a separate row inside the Pricing card when non-zero.
  laborExtraHours?: number;
}

export function LaborSection({
  laborHours,
  laborRate,
  laborTotal,
  laborUnit,
  sections,
  showLaborHours,
  onEdit,
  laborMarkupPercent = 0,
  rollMarkupIntoLabor = false,
  laborExtraHours = 0,
}: LaborSectionProps) {
  const unit = laborUnit || 'hours';
  const unitLabel = unit === 'days' ? 'days' : 'hours';
  const rateLabel = unit === 'days' ? '/day' : '/hr';
  const hasSections = sections && sections.length > 0;
  const laborMultiplier =
    rollMarkupIntoLabor && laborMarkupPercent > 0 ? 1 + laborMarkupPercent / 100 : 1;
  const displayLaborRate = laborRate * laborMultiplier;
  const displayLaborTotal = laborTotal * laborMultiplier;
  const markupRolledIn = rollMarkupIntoLabor && laborMarkupPercent > 0;

  const content = (
    <Surface style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <View style={[styles.sectionIconCircle, { backgroundColor: colors.successBg }]}>
            <MaterialCommunityIcons name="cash-multiple" size={18} color={colors.success} />
          </View>
          <Title style={styles.sectionTitle}>Pricing</Title>
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
            const sDisplayRate = section.laborRate * laborMultiplier;
            const sDisplayTotal = section.laborTotal * laborMultiplier;
            return (
              <View key={section.id} style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{section.name}</Text>
                  {showLaborHours && (
                    <Text style={styles.itemDetails}>
                      {section.laborHours} {sUnitLabel} × {formatCurrency(sDisplayRate)}{sRateLabel}
                    </Text>
                  )}
                </View>
                <Text style={styles.itemTotal}>{formatCurrency(sDisplayTotal)}</Text>
              </View>
            );
          })}
          {laborExtraHours !== 0 && (
            <View style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>
                  {laborExtraHours > 0 ? 'Extra labour' : 'Labour adjustment'}
                </Text>
                {showLaborHours && (
                  <Text style={styles.itemDetails}>
                    {laborExtraHours > 0 ? '+' : ''}
                    {laborExtraHours} {unitLabel} × {formatCurrency(displayLaborRate)}{rateLabel}
                  </Text>
                )}
              </View>
              <Text style={styles.itemTotal}>
                {formatCurrency(laborExtraHours * displayLaborRate)}
              </Text>
            </View>
          )}
          <Divider style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Labour Subtotal</Text>
            <Text style={styles.summaryValue}>{formatCurrency(displayLaborTotal)}</Text>
          </View>
        </>
      ) : (
        <View style={styles.itemRow}>
          <View style={styles.itemInfo}>
            <Text style={styles.itemName}>Labour</Text>
            {showLaborHours && (
              <Text style={styles.itemDetails}>
                {laborHours} {unitLabel} × {formatCurrency(displayLaborRate)}{rateLabel}
              </Text>
            )}
          </View>
          <Text style={styles.itemTotal}>{formatCurrency(displayLaborTotal)}</Text>
        </View>
      )}

      {markupRolledIn && (
        <Text
          style={{
            fontSize: 11,
            color: colors.textMuted,
            textAlign: 'right',
            marginTop: 2,
          }}
        >
          (incl. {laborMarkupPercent}% markup)
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
