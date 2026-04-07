import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface, Divider } from 'react-native-paper';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { documentStyles } from './documentStyles';

interface TotalsSectionProps {
  subtotal: number;
  markup: number;
  markupAmount: number;
  gst: number;
  total: number;
  hideZeroMarkup?: boolean;
  hideMarkup?: boolean;
  paidAmount?: number;
  balanceDue?: number;
  travelAdjustmentAmount?: number;
  travelAdjustmentPercent?: number;
}

export function TotalsSection({
  subtotal,
  markup,
  markupAmount,
  gst,
  total,
  hideZeroMarkup,
  hideMarkup,
  paidAmount,
  balanceDue,
  travelAdjustmentAmount = 0,
  travelAdjustmentPercent = 0,
}: TotalsSectionProps) {
  const showMarkup = hideMarkup ? false : (hideZeroMarkup ? markup > 0 : true);
  const showTravel = travelAdjustmentAmount > 0;

  return (
    <Surface style={documentStyles.totalSection}>
      <View style={documentStyles.summaryRow}>
        <Text style={documentStyles.summaryLabel}>Subtotal</Text>
        <Text style={documentStyles.summaryValue}>{formatCurrency(subtotal)}</Text>
      </View>
      {showMarkup && (
        <View style={documentStyles.summaryRow}>
          <Text style={documentStyles.summaryLabel}>Markup</Text>
          <Text style={documentStyles.summaryValue}>{formatCurrency(markupAmount)}</Text>
        </View>
      )}
      {showTravel && (
        <View style={documentStyles.summaryRow}>
          <Text style={documentStyles.summaryLabel}>
            {travelAdjustmentPercent > 0
              ? `Travel adjustment (+${travelAdjustmentPercent}%)`
              : 'Travel adjustment'}
          </Text>
          <Text style={documentStyles.summaryValue}>{formatCurrency(travelAdjustmentAmount)}</Text>
        </View>
      )}
      <View style={documentStyles.summaryRow}>
        <Text style={documentStyles.summaryLabel}>GST (10%)</Text>
        <Text style={documentStyles.summaryValue}>{formatCurrency(gst)}</Text>
      </View>
      <Divider style={documentStyles.divider} />
      <View style={documentStyles.totalRow}>
        <Text style={documentStyles.totalLabel}>TOTAL</Text>
        <Text style={documentStyles.totalValue}>{formatCurrency(total)}</Text>
      </View>
      {paidAmount !== undefined && paidAmount > 0 && (
        <>
          <View style={[documentStyles.summaryRow, { marginTop: 8 }]}>
            <Text style={documentStyles.summaryLabel}>Amount Paid</Text>
            <Text style={[documentStyles.summaryValue, { color: colors.success }]}>
              -{formatCurrency(paidAmount)}
            </Text>
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>BALANCE DUE</Text>
            <Text style={styles.balanceValue}>{formatCurrency(balanceDue ?? 0)}</Text>
          </View>
        </>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  balanceLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.warning,
  },
  balanceValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.warning,
  },
});
