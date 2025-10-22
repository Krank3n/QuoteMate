/**
 * Labor & Markup Screen
 * Set labor hours, rates, and markup percentage
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Surface,
  Title,
  Divider,
  Dialog,
  Portal,
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
  const [warningDialogVisible, setWarningDialogVisible] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');

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
    // Validate labor hours and rate
    if (hours === 0 || rate === 0) {
      setWarningMessage(
        'Labor hours or rate is set to $0. This means no labor cost will be included in the quote.\n\nDo you want to continue?'
      );
      setWarningDialogVisible(true);
      return;
    }

    proceedToPreview();
  };

  const proceedToPreview = () => {
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
    setWarningDialogVisible(false);
    navigation.navigate('QuotePreview');
  };

  const scrollContent = (
    <>
      <Portal>
        <Dialog visible={warningDialogVisible} onDismiss={() => setWarningDialogVisible(false)}>
          <Dialog.Title>Zero Labor Cost</Dialog.Title>
          <Dialog.Content>
            <Text>{warningMessage}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setWarningDialogVisible(false)}>Cancel</Button>
            <Button onPress={proceedToPreview}>Continue</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
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
    </View>
    </>
  );

  // On web, return ScrollView directly. On mobile, wrap with KeyboardAvoidingView
  if (Platform.OS === 'web') {
    return scrollContent;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {scrollContent}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' && {
      display: 'flex' as any,
      flexDirection: 'column' as any,
      height: '100vh',
      overflow: 'hidden',
    }),
  },
  scrollView: {
    flex: 1,
    ...(Platform.OS === 'web' && {
      overflow: 'auto' as any,
      flexShrink: 1,
    }),
  },
  scrollContent: {
    paddingBottom: 220,
    flexGrow: 1,
    ...(Platform.OS === 'web' && {
      maxWidth: 800,
      margin: 'auto' as any,
      width: '100%',
      paddingBottom: 20,
      height: '0px',
    }),
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
    marginBottom: 20,
  },
  calculationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 8,
    marginTop: 12,
    backgroundColor: colors.surface,
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
    backgroundColor: colors.surface,
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
    marginTop: 24,
    marginBottom: 80,
    paddingVertical: 8,
  },
});
