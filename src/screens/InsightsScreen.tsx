/**
 * Insights Screen
 * Revenue trends, pipeline, cost breakdown, and month comparison
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useStore } from '../store/useStore';
import { makeStyles } from '../theme';
import { MonthComparisonChart } from '../components/MonthComparisonChart';
import { QuotePipelineChart } from '../components/QuotePipelineChart';
import { RevenueChart } from '../components/RevenueChart';
import { CostBreakdownChart } from '../components/CostBreakdownChart';
import { WebContainer } from '../components/WebContainer';
import { GridBackground } from '../components/GridBackground';

export function InsightsScreen() {
  const styles = useStyles();

  const { quotes } = useStore();

  return (
    <View style={styles.gridHost}>
    <GridBackground />
    <ScrollView style={styles.scroller}>
      <WebContainer>
        <View style={styles.content}>
          <MonthComparisonChart quotes={quotes} />
          <QuotePipelineChart quotes={quotes} />
          <RevenueChart quotes={quotes} />
          <CostBreakdownChart quotes={quotes} />
        </View>
      </WebContainer>
    </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  gridHost: { flex: 1, backgroundColor: t.colors.bg },
  scroller: { flex: 1, backgroundColor: 'transparent' },
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  content: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
}));
