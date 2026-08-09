import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text, Title, Surface, Divider } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { LaborUnit, QuoteSection } from '../../types';
import { hoursForDisplay, rateForDisplay, valueToHours, rateToHourly } from '../../../shared/document/labourUnits';
import { documentStyles as styles } from './documentStyles';

interface LaborSectionProps {
  laborHours: number;
  laborRate: number;
  laborTotal: number;
  /** Legacy unit of the passed values — day-shaped input is converted here. */
  laborUnit?: LaborUnit;
  /** How to present labour. Display only; never changes a dollar figure. */
  labourDisplayUnit?: LaborUnit;
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
  // Editor surfaces (e.g. JobScopeCard expanded view) want the markup %
  // visible even when the markup is broken out as its own totals row.
  alwaysShowMarkupNote?: boolean;
  style?: any;
}

export function LaborSection({
  laborHours,
  laborRate,
  laborTotal,
  laborUnit,
  labourDisplayUnit,
  sections,
  showLaborHours,
  onEdit,
  laborMarkupPercent = 0,
  rollMarkupIntoLabor = false,
  laborExtraHours = 0,
  alwaysShowMarkupNote = false,
  style,
}: LaborSectionProps) {
  // Canonical hours in, chosen unit out — the conversion happens once, here,
  // rather than being inferred from whatever unit each value claims to be in.
  const displayUnit: LaborUnit = labourDisplayUnit === 'days' ? 'days' : 'hours';
  const unitLabel = displayUnit === 'days' ? 'days' : 'hours';
  const rateLabel = displayUnit === 'days' ? '/day' : '/hr';
  const qty = (hours: number) => Math.round(hoursForDisplay(hours, displayUnit) * 100) / 100;
  const hasSections = sections && sections.length > 0;
  const laborMultiplier =
    rollMarkupIntoLabor && laborMarkupPercent > 0 ? 1 + laborMarkupPercent / 100 : 1;
  const hourlyRate = rateToHourly(laborRate, laborUnit);
  const displayLaborRate = rateForDisplay(hourlyRate, displayUnit) * laborMultiplier;
  const displayLaborTotal = laborTotal * laborMultiplier;
  const extraHours = valueToHours(laborExtraHours, laborUnit);
  const markupRolledIn = rollMarkupIntoLabor && laborMarkupPercent > 0;
  const showMarkupNote =
    laborMarkupPercent > 0 && (markupRolledIn || alwaysShowMarkupNote);

  const content = (
    <Surface style={[styles.section, style]}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <View style={[styles.sectionIconCircle, { backgroundColor: colors.primaryBg }]}>
            <MaterialCommunityIcons name="hammer-wrench" size={18} color={colors.primary} />
          </View>
          <Title style={styles.sectionTitle}>Labour & Markup</Title>
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
            const sDisplayRate =
              rateForDisplay(rateToHourly(section.laborRate, section.laborUnit), displayUnit) * laborMultiplier;
            const sDisplayTotal = section.laborTotal * laborMultiplier;
            // Show TOTAL hours/days for the section, not the per-unit value.
            // Per-unit was confusing: a 50 m² deck section with 0.076 days/m²
            // displays "0.076 days × $800/day = $3,040" which doesn't reconcile.
            // Total = laborHours × multiplier rounds to a sane number.
            const sMultiplier = section.multiplier || 1;
            const sTotalUnits = qty(valueToHours(section.laborHours * sMultiplier, section.laborUnit));
            return (
              <View key={section.id} style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{section.name}</Text>
                  {showLaborHours && (
                    <Text style={styles.itemDetails}>
                      {sTotalUnits} {unitLabel} × {formatCurrency(sDisplayRate)}{rateLabel}
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
                    {qty(extraHours)} {unitLabel} × {formatCurrency(displayLaborRate)}{rateLabel}
                  </Text>
                )}
              </View>
              <Text style={styles.itemTotal}>
                {formatCurrency(extraHours * hourlyRate * laborMultiplier)}
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
                {qty(valueToHours(laborHours, laborUnit))} {unitLabel} × {formatCurrency(displayLaborRate)}{rateLabel}
              </Text>
            )}
          </View>
          <Text style={styles.itemTotal}>{formatCurrency(displayLaborTotal)}</Text>
        </View>
      )}

      {showMarkupNote && (
        <Text
          style={{
            fontSize: 11,
            color: colors.textMuted,
            textAlign: 'right',
            marginTop: 2,
          }}
        >
          {markupRolledIn
            ? `(incl. ${laborMarkupPercent}% markup)`
            : `+ ${laborMarkupPercent}% markup applied at total`}
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
