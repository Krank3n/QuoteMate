/**
 * Trial Banner Component
 * Shared trial status card with progressive Aussie humor
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Surface, Button } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { makeStyles, useThemeColors } from '../theme';
import { TRIAL_MS } from '../utils/trialConfig';

interface TrialBannerProps {
  trialStartedAt: string | Date;
  quoteCount: number;
  /** Compact mode for settings screen (no upgrade button, slightly different layout) */
  compact?: boolean;
}

function getTrialMessage(daysRemaining: number, quoteCount: number, trialExpired: boolean): { title: string; subtitle: string } {
  if (trialExpired) {
    const expiredMessages = [
      { title: "Time's up, legend", subtitle: quoteCount > 0 ? `You smashed out ${quoteCount} quotes — don't let that momentum die on the vine` : "Your free trial's gone the way of the dodo" },
      { title: "She's cooked, mate", subtitle: "Trial's done and dusted. Upgrade before your quotes go walkabout" },
      { title: "Trial's cactus", subtitle: "Dead as a doornail. Time to go Pro or go home" },
    ];
    return expiredMessages[quoteCount % expiredMessages.length];
  }

  if (daysRemaining <= 1) {
    const urgentMessages = [
      { title: "Last day — no pressure", subtitle: quoteCount > 0 ? `${quoteCount} quotes deep and you're gonna bail now? Fair dinkum?` : "Last chance to jump on board before the ute leaves without ya" },
      { title: "Oi, it's the final countdown", subtitle: "Less than 24 hours before this free ride hits a roo" },
      { title: "Mate. MATE.", subtitle: quoteCount >= 3 ? `You've done ${quoteCount} quotes already — you clearly need this` : "Tomorrow this turns into a pumpkin. Just sayin'" },
    ];
    return urgentMessages[quoteCount % urgentMessages.length];
  }

  if (daysRemaining <= 2) {
    const twoDay = [
      { title: `${daysRemaining} days left — tick tock`, subtitle: quoteCount >= 3 ? `${quoteCount} quotes and counting. You're hooked and we both know it` : "The clock's ticking louder than a kookaburra at sunrise" },
      { title: "Almost knock-off time", subtitle: "Your trial's finishing up faster than a snag at a Bunnings sausage sizzle" },
    ];
    return twoDay[quoteCount % twoDay.length];
  }

  if (daysRemaining <= 3) {
    const threeDay = [
      { title: `${daysRemaining} days left — getting spicy`, subtitle: quoteCount > 0 ? `${quoteCount} quotes sent. At this rate you'll need Pro before Wednesday` : "Half your trial's gone. Time flies when you're quoting" },
      { title: `Only ${daysRemaining} days to go`, subtitle: "Your trial's disappearing faster than a cold beer on a hot arvo" },
    ];
    return threeDay[quoteCount % threeDay.length];
  }

  if (daysRemaining <= 5) {
    const midTrial = [
      { title: `${daysRemaining} days left in trial`, subtitle: quoteCount > 0 ? `Already ${quoteCount} quotes in. You're a natural, mate` : "Heaps of time to give it a proper burl" },
      { title: `${daysRemaining} days remaining`, subtitle: "She'll be right — but don't leave it too late, yeah?" },
    ];
    return midTrial[quoteCount % midTrial.length];
  }

  if (daysRemaining <= 7) {
    const weekLeft = [
      { title: `${daysRemaining} days left`, subtitle: quoteCount > 0 ? `${quoteCount} quotes deep — over the halfway mark` : "Halfway through. Plenty of time to give it a proper go" },
      { title: `${daysRemaining} days of free quoting`, subtitle: "Cruising along nicely. Have a crack at a few more quotes" },
    ];
    return weekLeft[quoteCount % weekLeft.length];
  }

  if (daysRemaining <= 10) {
    const midSecondWeek = [
      { title: `${daysRemaining} days left in trial`, subtitle: quoteCount > 0 ? `${quoteCount} quotes in already — you're flying` : "Loads of time. Smash out a quote or two" },
      { title: `${daysRemaining} days of free quoting`, subtitle: "She's looking good — keep the wheels turning" },
    ];
    return midSecondWeek[quoteCount % midSecondWeek.length];
  }

  // 11-14 days (fresh trial)
  const freshMessages = [
    { title: `${daysRemaining} days left in trial`, subtitle: "Welcome aboard! Have a crack at your first quote — she's free as a bird" },
    { title: `${daysRemaining} days of free quoting`, subtitle: "No wukkas, plenty of time. Get amongst it!" },
  ];
  return freshMessages[quoteCount % freshMessages.length];
}

export function TrialBanner({ trialStartedAt, quoteCount, compact = false }: TrialBannerProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();

  const trialStart = new Date(trialStartedAt);
  const now = new Date();
  const elapsed = now.getTime() - trialStart.getTime();
  const daysRemaining = Math.max(0, Math.ceil((TRIAL_MS - elapsed) / (24 * 60 * 60 * 1000)));
  const trialExpired = elapsed >= TRIAL_MS;
  const progress = Math.max(0, 1 - (elapsed / TRIAL_MS));

  const { title, subtitle } = getTrialMessage(daysRemaining, quoteCount, trialExpired);

  const barColor = trialExpired
    ? themeColors.error
    : daysRemaining <= 1
    ? themeColors.warning
    : daysRemaining <= 3
    ? themeColors.warning
    : themeColors.accent;

  if (compact) {
    return (
      <View>
        <Text style={styles.compactTitle}>{title}</Text>
        <Text style={styles.compactSubtitle}>{subtitle}</Text>
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${(trialExpired ? 1 : 1 - progress) * 100}%`, backgroundColor: barColor },
              ]}
            />
          </View>
        </View>
      </View>
    );
  }

  const iconName = trialExpired
    ? 'clock-alert-outline'
    : daysRemaining <= 2
    ? 'clock-fast'
    : 'clock-outline';

  const accentColor = barColor;

  const handlePress = () => {
    navigation.navigate('Paywall' as never, { source: 'trial_banner' } as never);
  };

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
      <Surface style={styles.card}>
        <View style={styles.content}>
          <View style={[styles.iconCircle, { backgroundColor: accentColor + '20' }]}>
            <MaterialCommunityIcons name={iconName} size={20} color={accentColor} />
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            <View style={styles.barContainer}>
              <View style={styles.barBackground}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${progress * 100}%`, backgroundColor: barColor },
                  ]}
                />
              </View>
              <Text style={[styles.daysLabel, { color: accentColor }]}>
                {trialExpired ? 'Expired' : `${daysRemaining}d left`}
              </Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={themeColors.textSecondary} />
        </View>
        {trialExpired && (
          <Button
            mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent}
            compact
            onPress={handlePress}
            style={styles.upgradeButton}
          >
            Upgrade to Pro
          </Button>
        )}
      </Surface>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: t.colors.surfaceRaised,
    elevation: 2,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    flexDirection: 'column',
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: t.colors.textSecondary,
    marginTop: 1,
  },
  barContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  barBackground: {
    flex: 1,
    height: 5,
    backgroundColor: t.colors.surfaceOverlay,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  daysLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  upgradeButton: {
    marginTop: 12,
  },
  // Compact styles (for settings screen)
  compactTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  compactSubtitle: {
    fontSize: 13,
    color: t.colors.textSecondary,
    marginBottom: 12,
  },
  progressBarContainer: {
    marginTop: 0,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: t.colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
}));
