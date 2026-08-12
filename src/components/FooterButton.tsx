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
import { makeStyles, useThemeColors } from '../theme';
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
  const styles = useStyles();
  const themeColors = useThemeColors();
  const isOutlined = mode === 'outlined';
  const isContained = mode === 'contained';
  return (
    <Button
      mode={mode}
      // Paper's `primary` is the FOREGROUND colour (see buildPaperTheme), so a
      // contained button has to be handed the vivid fill and its ink label
      // explicitly. Without this it renders in the darker text orange.
      buttonColor={isContained ? themeColors.accent : undefined}
      textColor={isContained ? themeColors.onAccent : undefined}
      onPress={() => {
        if (!noHaptic) lightTap();
        onPress();
      }}
      icon={icon}
      loading={loading}
      disabled={disabled}
      style={[
        styles.button,
        isOutlined && { borderWidth: 2, borderColor: outlineColor ?? themeColors.accentBorder },
        style,
      ]}
      contentStyle={styles.buttonContent}
      labelStyle={[
        styles.buttonLabel,
        isOutlined && { color: outlineColor ?? themeColors.accentText },
        labelStyle,
      ]}
    >
      {loading ? '' : label}
    </Button>
  );
}

const useStyles = makeStyles((t) => ({
  button: {
    flex: 1,
    margin: 0,
    borderRadius: 12,
  },
  buttonContent: {
    paddingVertical: 14,
    gap: 8,
  },
  buttonLabel: {
    fontSize: 15,
    fontFamily: 'Archivo-Bold',
    marginVertical: 0,
  },
}));
