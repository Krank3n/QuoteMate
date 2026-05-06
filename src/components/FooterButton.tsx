/**
 * FooterButton — the shared rounded button shape used in every footer
 * (FixedBottomButton flow bar, JobPreviewScreen, ReeceOrderScreen).
 * Wraps react-native-paper's Button so the press ripple/hit animation
 * is preserved, while standardising borderRadius, padding, and label
 * style to match the StickyJobActionBar pill on ViewJobScreen.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';
import { colors } from '../theme';
import { lightTap } from '../utils/haptics';

export interface FooterButtonProps {
  label: string;
  onPress: () => void;
  mode?: 'contained' | 'outlined' | 'text';
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  /** Override container style (e.g. flex weight). Border radius is preserved. */
  style?: any;
  /** Override label style. */
  labelStyle?: any;
  /** Override the outlined border colour. Defaults to primary. */
  outlineColor?: string;
  /** Suppress the default haptic on press. */
  noHaptic?: boolean;
}

export function FooterButton({
  label,
  onPress,
  mode = 'contained',
  icon,
  loading = false,
  disabled = false,
  style,
  labelStyle,
  outlineColor,
  noHaptic = false,
}: FooterButtonProps) {
  const isOutlined = mode === 'outlined';
  return (
    <Button
      mode={mode}
      onPress={() => {
        if (!noHaptic) lightTap();
        onPress();
      }}
      icon={icon}
      loading={loading}
      disabled={disabled}
      style={[
        styles.button,
        isOutlined && { borderWidth: 2, borderColor: outlineColor ?? colors.primary },
        style,
      ]}
      contentStyle={styles.buttonContent}
      labelStyle={[
        styles.buttonLabel,
        isOutlined && { color: outlineColor ?? colors.primary },
        labelStyle,
      ]}
    >
      {loading ? '' : label}
    </Button>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    margin: 0,
    borderRadius: 12,
  },
  buttonContent: {
    paddingVertical: 14,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '700',
    marginVertical: 0,
    marginHorizontal: 10,
  },
});
