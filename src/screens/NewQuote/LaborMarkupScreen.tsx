/**
 * Labor & Markup Screen
 * Set labor hours, rates, and markup percentage
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Surface,
  Title,
  Divider,
} from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { formatCurrency, calculateQuote } from '../../utils/quoteCalculator';

export function LaborMarkupScreen() {
  const navigation = useNavigation<any>();
  const { currentQuote, updateQuote } = useStore();

  const [laborHours, setLaborHours] = useState('');
  const [laborRate, setLaborRate] = useState('');
  const [markup, setMarkup] = useState('');

  useEffect(() => {
    if (currentQuote) {
      setLaborHours(currentQuote.laborHours.toString());
      setLaborRate(currentQuote.laborRate.toString());
      setMarkup(currentQuote.markup.toString());
    }
  }, [currentQuote]);

  if (!currentQuote) {
    return null;
  }

  // Calculate totals in real-time
  const hours = parseFloat(laborHours) || 0;
  const rate = parseFloat(laborRate) || 0;
  const markupPercent = parseFloat(markup) || 0;

  const calculation = calculateQuote(
    currentQuote.materials,
    rate,
    hours,
    markupPercent
  );

  const handleNext = () => {
    // Update quote with labor details
    const updatedQuote = {
      ...currentQuote,
      laborHours: hours,
      laborRate: rate,
      markup: markupPercent,
      laborTotal: calculation.laborTotal,
      materialsSubtotal: calculation.materialsSubtotal,
      subtotal: calculation.subtotal,
      markupAmount: calculation.markupAmount,
      gst: calculation.gst,
      total: calculation.total,
    };

    updateQuote(updatedQuote);
    navigation.navigate('QuotePreview');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Title style={styles.sectionTitle}>Labor</Title>

        <TextInput
          label="Estimated Hours"
          value={laborHours}
          onChangeText={setLaborHours}
          mode="outlined"
          keyboardType="decimal-pad"
          right={<TextInput.Affix text="hrs" />}
          style={styles.input}
        />

        <TextInput
          label="Hourly Rate"
          value={laborRate}
          onChangeText={setLaborRate}
          mode="outlined"
          keyboardType="decimal-pad"
          left={<TextInput.Affix text="$" />}
          right={<TextInput.Affix text="/hr" />}
          style={styles.input}
        />

        <Surface style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Labor Total</Text>
          <Text style={styles.calculationValue}>
            {formatCurrency(calculation.laborTotal)}
          </Text>
        </Surface>
      </View>

      <Divider />

      <View style={styles.section}>
        <Title style={styles.sectionTitle}>Markup</Title>

        <TextInput
          label="Markup Percentage"
          value={markup}
          onChangeText={setMarkup}
          mode="outlined"
          keyboardType="decimal-pad"
          right={<TextInput.Affix text="%" />}
          style={styles.input}
        />

        <Surface style={styles.calculationRow}>
          <Text style={styles.calculationLabel}>Markup Amount</Text>
          <Text style={styles.calculationValue}>
            {formatCurrency(calculation.markupAmount)}
          </Text>
        </Surface>
      </View>

      <Divider />

      {/* Quote Summary */}
      <Surface style={styles.summarySection}>
        <Title style={styles.sectionTitle}>Quote Summary</Title>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Materials</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(calculation.materialsSubtotal)}
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Labor</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(calculation.laborTotal)}
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(calculation.subtotal)}
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Markup ({markupPercent}%)</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(calculation.markupAmount)}
          </Text>
        </View>

        <Divider style={styles.divider} />

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal (Inc. Markup)</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(calculation.subtotal + calculation.markupAmount)}
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>GST (10%)</Text>
          <Text style={styles.summaryValue}>
            {formatCurrency(calculation.gst)}
          </Text>
        </View>

        <Divider style={styles.divider} />

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalValue}>
            {formatCurrency(calculation.total)}
          </Text>
        </View>
      </Surface>

      <Button
        mode="contained"
        onPress={handleNext}
        style={styles.nextButton}
      >
        Next: Preview Quote
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  input: {
    marginBottom: 12,
  },
  calculationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 8,
    marginTop: 12,
  },
  calculationLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  calculationValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
  },
  summarySection: {
    margin: 20,
    padding: 20,
    borderRadius: 8,
    elevation: 3,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 14,
    color: colors.onSurface,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    marginVertical: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
  },
  nextButton: {
    marginHorizontal: 20,
    marginBottom: 40,
    paddingVertical: 8,
  },
});
