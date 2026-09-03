/**
 * TapToPayAwarenessBanner
 *
 * Apple review requirements 3.1 and 3.3: highly visible, easily discoverable
 * communication that Tap to Pay on iPhone exists, shown at least once to every
 * eligible merchant. This is the awareness moment in Apple's "Existing User
 * Flow" recording.
 *
 * Plain text and Apple's own SF Symbol, deliberately. The Developer Marketing
 * Guidelines forbid custom illustrations, photography or icons depicting iPhone
 * or the feature, and the Marketing Toolkit assets are not in hand. `SymbolView`
 * falls back to the app's icon set where the symbol is unavailable, which on a
 * non-iOS device never renders anyway — the banner is iOS-only by design.
 *
 * Tapping it opens Apple's Terms and Conditions and then Apple's own education
 * (reqs 3.5 / 4.2), the same path as the onboarding setup button (3.4).
 */

import React, { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolView } from 'expo-symbols';

import { makeStyles, useThemeColors } from '../theme';
import { acceptTapToPayTermsAndEducate } from '../services/squarePayments';
import { TAP_TO_PAY_AWARENESS_COPY } from '../utils/tapToPayAwareness';

interface Props {
  onDismiss: () => void;
  /** Called once setup finishes, so the host can re-evaluate visibility. */
  onSetUp?: () => void;
}

export function TapToPayAwarenessBanner({ onDismiss, onSetUp }: Props) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [busy, setBusy] = useState(false);

  const handleSetUp = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await acceptTapToPayTermsAndEducate();
      onSetUp?.();
    } catch {
      // Declining Apple's terms is a legitimate answer, not an error worth
      // shouting about. The banner stays until they accept or dismiss it.
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      style={styles.banner}
      onPress={handleSetUp}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${TAP_TO_PAY_AWARENESS_COPY.title}. ${TAP_TO_PAY_AWARENESS_COPY.body}`}
    >
      <View style={styles.icon}>
        <SymbolView
          name="wave.3.right.circle"
          size={26}
          tintColor={themeColors.accentText}
          fallback={
            <MaterialCommunityIcons
              name="cellphone-nfc"
              size={26}
              color={themeColors.accentText}
            />
          }
        />
      </View>

      <View style={styles.text}>
        <Text style={styles.title}>{TAP_TO_PAY_AWARENESS_COPY.title}</Text>
        <Text style={styles.body}>{TAP_TO_PAY_AWARENESS_COPY.body}</Text>
        <Text style={styles.cta}>
          {busy ? 'Opening…' : TAP_TO_PAY_AWARENESS_COPY.cta}
        </Text>
      </View>

      <TouchableOpacity
        onPress={onDismiss}
        style={styles.dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <MaterialCommunityIcons
          name="close"
          size={18}
          color={themeColors.textMuted}
        />
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
