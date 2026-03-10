/**
 * Insights Screen
 * Revenue trends, pipeline, cost breakdown, and month comparison
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { MonthComparisonChart } from '../components/MonthComparisonChart';
import { QuotePipelineChart } from '../components/QuotePipelineChart';
import { RevenueChart } from '../components/RevenueChart';
import { CostBreakdownChart } from '../components/CostBreakdownChart';
import { WebContainer } from '../components/WebContainer';

export function InsightsScreen() {
  const { quotes } = useStore();

  return (
    <ScrollView style={styles.container}>
      <WebContainer>
        <View style={styles.content}>
          <MonthComparisonChart quotes={quotes} />
          <QuotePipelineChart quotes={quotes} />
          <RevenueChart quotes={quotes} />
          <CostBreakdownChart quotes={quotes} />
        </View>
      </WebContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
});
