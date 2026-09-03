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
 * this appears. Who sees it and how often is gated by the caller
 * (maybeShowWonPrompt); this component just renders and reports. It is only
 * mounted while it's up, so the close animation never renders a stale total.
 */

import React, { useEffect, useRef } from 'react';
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
  /**
   * Whole days left in an ending trial, or null for a free user. A trial user
   * already has what Pro does, so the line names what they're about to lose
   * instead of selling them something they have.
   */
  trialDaysRemaining: number | null;
}

/** The one line on what Pro does next, told from where the tradie stands. */
function proLine(trialDaysRemaining: number | null): string {
  if (trialDaysRemaining === null) {
    return 'Pro lets you invoice this job and get paid any way — bank, PayID, PayPal or Square.';
  }
  const ending =
    trialDaysRemaining <= 0
      ? 'Your trial ends today'
      : `Your trial ends in ${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'}`;
  return `${ending} — keep invoicing and getting paid with Pro.`;
}

export function JobWonSheet({
  visible,
  onDismiss,
  name,
  total,
  trialDaysRemaining,
}: JobWonSheetProps) {
  const styles = useStyles();
  const navigation = useNavigation<any>();
  // One outcome per sheet. The buttons stay live through BottomSheet's close
  // animation, so a double-tap would otherwise report two won_prompt_tapped
  // events (and navigate on top of a dismiss).
  const decided = useRef(false);

  // One impression per open. Keyed on `visible` so a re-render mid-sheet
  // doesn't re-fire, and the close animation (visible=false) never counts.
  useEffect(() => {
    if (visible) {
      decided.current = false;
      trackEvent('won_prompt_shown');
    }
  }, [visible]);

  const handleSeePro = () => {
    if (decided.current) return;
    decided.current = true;
    selectionTap();
    trackEvent('won_prompt_tapped', { outcome: 'see_pro' });
    onDismiss();
    navigation.navigate('Paywall', { source: 'job_won' });
  };

  const handleNotNow = () => {
    if (decided.current) return;
    decided.current = true;
    lightTap();
    trackEvent('won_prompt_tapped', { outcome: 'not_now' });
    onDismiss();
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Job won" subtitle={name}>
      <View style={styles.container}>
        <Text style={styles.total}>{formatCurrency(total)}</Text>
        <Text style={styles.totalLabel}>accepted</Text>

        <Text style={styles.body}>{proLine(trialDaysRemaining)}</Text>

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
