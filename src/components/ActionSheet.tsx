/**
 * ActionSheet Component
 * Dark-themed bottom sheet menu for card actions.
 * Matches the app's gritty dark aesthetic with staggered entry animations.
 */

import React from 'react';
import { View, StyleSheet, Pressable, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { GrainOverlay } from './GrainOverlay';
import { BottomSheet, useStaggeredEntrance } from './BottomSheet';

export interface ActionSheetOption {
  icon: string;
  label: string;
  onPress: () => void;
  /** Icon and label accent colour */
  color?: string;
  /** Whether to show a divider above this item */
  divider?: boolean;
}

/** Default colour per icon name — gives each action a distinct tint */
const ICON_COLOR_MAP: Record<string, { color: string; bg: string }> = {
  'pencil':                  { color: colors.info, bg: colors.infoBg },
  'email-outline':           { color: colors.warning, bg: colors.warningBg },
  'send-outline':            { color: colors.warning, bg: colors.warningBg },
  'content-copy':            { color: '#8B5CF6', bg: '#2E1065' },      // violet
  'share-variant':           { color: colors.info, bg: colors.infoBg },
  'file-pdf-box':            { color: '#F97316', bg: '#431407' },       // orange
  'file-replace':            { color: colors.primary, bg: colors.primaryBg },
  'cash':                    { color: colors.success, bg: colors.successBg },
  'delete-outline':          { color: colors.error, bg: colors.errorBg },
  'file-document-edit-outline': { color: colors.info, bg: colors.infoBg },
  'check-circle-outline':    { color: colors.success, bg: colors.successBg },
  'close-circle-outline':    { color: colors.error, bg: colors.errorBg },
  'camera':                  { color: colors.info, bg: colors.infoBg },
  'image-multiple':          { color: '#8B5CF6', bg: '#2E1065' },      // violet
};

function getIconStyle(icon: string, explicitColor?: string) {
  if (explicitColor === colors.error) {
    return { color: colors.error, bg: colors.errorBg };
  }
  if (explicitColor) {
    return { color: explicitColor, bg: `${explicitColor}18` };
  }
  return ICON_COLOR_MAP[icon] || { color: colors.text, bg: `${colors.text}15` };
}

interface ActionSheetProps {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  options: ActionSheetOption[];
  /**
   * When true (default), tapping an option auto-dismisses the sheet via
   * `onDismiss` and defers `option.onPress` by 300ms so the exit animation
   * can finish first. Set to false when the caller needs to keep the
   * surrounding surface mounted while swapping to a follow-up modal — the
   * option handler then owns dismissal, typically by flipping its own
   * `visible` state.
   */
  dismissOnSelect?: boolean;
}

export function ActionSheet({
  visible,
  onDismiss,
  title,
  options,
  dismissOnSelect = true,
}: ActionSheetProps) {
  const optionAnims = useStaggeredEntrance(options.length, visible, 80, 35);

  const handleSelect = (option: ActionSheetOption) => {
    selectionTap();
    if (dismissOnSelect) {
      onDismiss();
      setTimeout(() => option.onPress(), 300);
    } else {
      option.onPress();
    }
  };

  const footer = (
    <>
      {/* Cancel button */}
      <View style={styles.cancelContainer}>
        <Pressable
          style={({ pressed }) => [
            styles.cancelButton,
            pressed && styles.cancelPressed,
          ]}
          onPress={onDismiss}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </>
  );

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={title}
      footer={footer}
      scrollable
      maxHeightRatio={0.7}
      overlay={<GrainOverlay density={160} intensity={0.07} borderRadius={24} />}
    >
      <View style={styles.optionsContainer}>
        {options.map((option, index) => {
          const anim = optionAnims[index];
          const { color: iconColor, bg: iconBg } = getIconStyle(option.icon, option.color);
          const isDestructive = option.color === colors.error;

          return (
            <React.Fragment key={`${option.label}-${index}`}>
              {option.divider && <View style={styles.divider} />}
              <Animated.View
                style={{
                  opacity: anim,
                  transform: [
                    {
                      translateY: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [16, 0],
                      }),
                    },
                    {
                      scale: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.96, 1],
                      }),
                    },
                  ],
                }}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                  onPress={() => handleSelect(option)}
                >
                  <View
                    style={[
                      styles.iconCircle,
                      { backgroundColor: iconBg },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={option.icon as any}
                      size={20}
                      color={iconColor}
                    />
                  </View>
                  <Text
                    style={[
                      styles.optionLabel,
                      isDestructive && { color: colors.error },
                    ]}
                  >
                    {option.label}
                  </Text>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={18}
                    color={colors.inactive}
                  />
                </Pressable>
              </Animated.View>
            </React.Fragment>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  optionsContainer: {
    gap: 6,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 13,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  optionPressed: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    transform: [{ scale: 0.98 }],
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  optionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 4,
    marginHorizontal: 8,
  },
  cancelContainer: {
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  cancelButton: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
  },
  cancelPressed: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    transform: [{ scale: 0.98 }],
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textMuted,
  },
});
