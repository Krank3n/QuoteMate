/**
 * ReturnTrialBanner
 *
 * The welcome-back card for the return-triggered second trial. Rendered by
 * the dashboard while the re-opened window runs (see utils/returnTrialNotice
 * for the visibility rule and copy). Tapping the card or its CTA goes
 * straight into quoting — the point is a fresh usage moment, not a notice.
 */

import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { makeStyles, useThemeColors } from '../theme';
import { returnTrialNoticeCopy, type ReturnTrialNoticeSource } from '../utils/returnTrialNotice';

interface Props {
  trial: ReturnTrialNoticeSource;
  /** Tap-through: start quoting. The host also records the card as seen. */
  onQuote: () => void;
  onDismiss: () => void;
}

export function ReturnTrialBanner({ trial, onQuote, onDismiss }: Props) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const copy = returnTrialNoticeCopy(trial);

  return (
    <TouchableOpacity
      style={styles.banner}
      onPress={onQuote}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${copy.title}. ${copy.body}`}
      testID="return-trial-banner"
    >
      <View style={styles.icon}>
        <MaterialCommunityIcons name="hand-wave-outline" size={26} color={themeColors.accentText} />
      </View>

      <View style={styles.text}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
        <Text style={styles.cta}>{copy.cta}</Text>
      </View>

      <TouchableOpacity
        onPress={onDismiss}
        style={styles.dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <MaterialCommunityIcons name="close" size={18} color={themeColors.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((t) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.accentSubtle,
    borderLeftWidth: 4,
    borderLeftColor: t.colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 10,
  },
  icon: {
    marginRight: 12,
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.accentText,
  },
  body: {
    fontSize: 13,
    color: t.colors.textSecondary,
    marginTop: 2,
  },
  cta: {
    fontSize: 13,
    fontWeight: '700',
    color: t.colors.accentText,
    marginTop: 6,
  },
  dismiss: {
    padding: 4,
    marginLeft: 8,
  },
}));
