/**
 * JobWonSheet — the "job won" moment.
 *
 * Shown once, right after a tradie marks a quote accepted (see ViewJobScreen).
 * This is the first point in the funnel where the app has visibly earned
 * something, so it's the honest moment to offer Pro: the next thing the tradie
 * does on a won job is invoice it and get paid, which is exactly what Pro
 * unlocks.
 *
 * Dismissible and non-blocking — the stage change has already landed before
 * this appears. Frequency is gated by the caller (shouldShowWonPrompt +
 * AsyncStorage); this component just renders and reports.
 */

import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

import { makeStyles } from '../theme';
import { BottomSheet } from './BottomSheet';
import { formatCurrency } from '../utils/quoteCalculator';
import { trackEvent } from '../services/analyticsService';
import { selectionTap, lightTap } from '../utils/haptics';

interface JobWonSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** Customer name, falling back to the job name. */
  name: string;
  /** The quote total just accepted — the value delivered. */
  total: number;
}

export function JobWonSheet({ visible, onDismiss, name, total }: JobWonSheetProps) {
  const styles = useStyles();
  const navigation = useNavigation<any>();

  // One impression per open. Keyed on `visible` so a re-render mid-sheet
  // doesn't re-fire, and the close animation (visible=false) never counts.
  useEffect(() => {
    if (visible) trackEvent('won_prompt_shown');
  }, [visible]);

  const handleSeePro = () => {
    selectionTap();
    trackEvent('won_prompt_tapped', { outcome: 'see_pro' });
    onDismiss();
    navigation.navigate('Paywall', { source: 'job_won' });
  };

  const handleNotNow = () => {
    lightTap();
    trackEvent('won_prompt_tapped', { outcome: 'not_now' });
    onDismiss();
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Job won" subtitle={name}>
      <View style={styles.container}>
        <Text style={styles.total}>{formatCurrency(total)}</Text>
        <Text style={styles.totalLabel}>accepted</Text>

        <Text style={styles.body}>
          Pro lets you invoice this job and get paid any way — bank, PayID,
          PayPal or Square.
        </Text>

        <Button
          mode="contained"
          onPress={handleSeePro}
          style={styles.primaryButton}
          contentStyle={styles.primaryButtonContent}
        >
          See Pro
        </Button>
        <Button mode="text" onPress={handleNotNow} style={styles.secondaryButton}>
          Not now
        </Button>
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    alignItems: 'center',
    gap: 4,
    paddingBottom: 8,
  },
  total: {
    fontSize: 34,
    fontWeight: '800',
    color: t.colors.money,
  },
  totalLabel: {
    fontSize: 13,
    color: t.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    color: t.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  primaryButton: {
    alignSelf: 'stretch',
    borderRadius: 12,
  },
  primaryButtonContent: {
    paddingVertical: 8,
  },
  secondaryButton: {
    marginTop: 4,
  },
}));
