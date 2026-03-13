/**
 * ActionSheet Component
 * Dark-themed bottom sheet menu for card actions.
 * Matches the app's gritty dark aesthetic with staggered entry animations.
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { Portal, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { GrainOverlay } from './GrainOverlay';

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
}

const SCREEN_HEIGHT = Dimensions.get('window').height;

export function ActionSheet({
  visible,
  onDismiss,
  title,
  options,
}: ActionSheetProps) {
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const optionAnims = useRef<Animated.Value[]>([]);

  if (optionAnims.current.length !== options.length) {
    optionAnims.current = options.map(() => new Animated.Value(0));
  }

  useEffect(() => {
    if (visible) {
      optionAnims.current.forEach((a) => a.setValue(0));

      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(80),
          Animated.stagger(
            35,
            optionAnims.current.map((anim) =>
              Animated.spring(anim, {
                toValue: 1,
                tension: 80,
                friction: 8,
                useNativeDriver: true,
              })
            )
          ),
        ]),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const handleSelect = (option: ActionSheetOption) => {
    selectionTap();
    onDismiss();
    setTimeout(() => option.onPress(), 100);
  };

  if (!visible) return null;

  return (
    <Portal>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      </Animated.View>

      {/* Sheet wrapper — centers on wide screens */}
      <View style={styles.sheetWrapper} pointerEvents="box-none">
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
      >
        {/* Handle */}
        <View style={styles.handleContainer}>
          <View style={styles.handle} />
        </View>

        {title && <Text style={styles.title}>{title}</Text>}

        <View style={styles.optionsContainer}>
          {options.map((option, index) => {
            const anim = optionAnims.current[index];
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

        <GrainOverlay density={160} intensity={0.07} borderRadius={24} />

        {/* Safe area padding */}
        <View style={styles.bottomPadding} />
      </Animated.View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    zIndex: 1000,
  },
  sheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1001,
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#141C2B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.45,
        shadowRadius: 24,
      },
      android: {
        elevation: 28,
      },
    }),
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceGray,
    opacity: 0.5,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textMuted,
    textAlign: 'center',
    paddingTop: 6,
    paddingBottom: 12,
    letterSpacing: 0.3,
  },
  optionsContainer: {
    paddingHorizontal: 14,
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
  bottomPadding: {
    height: 34,
  },
});
