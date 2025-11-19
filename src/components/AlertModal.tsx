/**
 * Alert Modal Component
 * Beautiful animated modal for success, warning, error, and info messages
 * Can be used throughout the app for consistent user feedback
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Platform } from 'react-native';
import {
  Portal,
  Modal,
  Text,
  Button,
  IconButton,
} from 'react-native-paper';
import { colors } from '../theme';
import { Quote, BusinessSettings } from '../types';
import { SendQuoteButton } from './SendQuoteButton';

export type AlertType = 'success' | 'warning' | 'error' | 'info';

interface AlertModalProps {
  visible: boolean;
  onDismiss: () => void;
  type?: AlertType;
  title: string;
  message: string;
  icon?: string; // Optional custom icon
  showConfetti?: boolean; // Override confetti display
  primaryButtonText?: string;
  primaryButtonAction?: () => void;
  secondaryButtonText?: string;
  secondaryButtonAction?: () => void;
  secondaryButtonLoading?: boolean;
  // Special props for quote-related modals
  quote?: Quote;
  businessSettings?: BusinessSettings | null;
}

// Simple confetti piece
interface ConfettiPiece {
  id: number;
  x: number;
  color: string;
  size: number;
  delay: number;
  duration: number;
}

// Get theme colors based on alert type
function getThemeColors(type: AlertType) {
  switch (type) {
    case 'success':
      return {
        iconColor: colors.success,
        iconBgColor: colors.successBg,
        buttonColor: colors.success,
      };
    case 'warning':
      return {
        iconColor: colors.warning,
        iconBgColor: colors.warningBg,
        buttonColor: colors.warning,
      };
    case 'error':
      return {
        iconColor: colors.error,
        iconBgColor: colors.errorBg,
        buttonColor: colors.error,
      };
    case 'info':
      return {
        iconColor: colors.info,
        iconBgColor: colors.infoBg,
        buttonColor: colors.info,
      };
  }
}

// Get default icon based on alert type
function getDefaultIcon(type: AlertType): string {
  switch (type) {
    case 'success':
      return 'check-circle';
    case 'warning':
      return 'alert-circle';
    case 'error':
      return 'close-circle';
    case 'info':
      return 'information';
  }
}

export function AlertModal({
  visible,
  onDismiss,
  type = 'success',
  title,
  message,
  icon,
  showConfetti,
  primaryButtonText = 'Done',
  primaryButtonAction,
  secondaryButtonText,
  secondaryButtonAction,
  secondaryButtonLoading = false,
  quote,
  businessSettings,
}: AlertModalProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const checkScaleAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Confetti is enabled for success type by default, can be overridden
  const enableConfetti = showConfetti !== undefined ? showConfetti : type === 'success';

  const [confetti] = useState<ConfettiPiece[]>(() => {
    if (!enableConfetti) return [];
    const confettiColors = [colors.success, colors.secondary, colors.info, colors.primary];
    return Array.from({ length: 25 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
      size: Math.random() * 6 + 4,
      delay: i * 50,
      duration: 2000 + Math.random() * 1000,
    }));
  });

  const confettiAnims = useRef(
    confetti.map(() => ({
      translateY: new Animated.Value(-100),
      rotate: new Animated.Value(0),
      opacity: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    if (visible) {
      // Reset all animations
      scaleAnim.setValue(0);
      fadeAnim.setValue(0);
      checkScaleAnim.setValue(0);
      pulseAnim.setValue(1);

      if (enableConfetti) {
        confettiAnims.forEach(anim => {
          anim.translateY.setValue(-100);
          anim.rotate.setValue(0);
          anim.opacity.setValue(0);
        });
      }

      // Start modal animations
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Icon bounce
        Animated.spring(checkScaleAnim, {
          toValue: 1,
          tension: 100,
          friction: 5,
          useNativeDriver: true,
        }).start();

        // Pulse animation
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1.1,
              duration: 800,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 800,
              useNativeDriver: true,
            }),
          ])
        ).start();

        // Start confetti
        if (enableConfetti) {
          confetti.forEach((piece, index) => {
            const anim = confettiAnims[index];
            Animated.sequence([
              Animated.delay(piece.delay),
              Animated.parallel([
                Animated.timing(anim.translateY, {
                  toValue: 500,
                  duration: piece.duration,
                  useNativeDriver: true,
                }),
                Animated.timing(anim.rotate, {
                  toValue: (Math.random() - 0.5) * 720,
                  duration: piece.duration,
                  useNativeDriver: true,
                }),
                Animated.sequence([
                  Animated.timing(anim.opacity, {
                    toValue: 0.9,
                    duration: 200,
                    useNativeDriver: true,
                  }),
                  Animated.delay(piece.duration * 0.5),
                  Animated.timing(anim.opacity, {
                    toValue: 0,
                    duration: piece.duration * 0.3,
                    useNativeDriver: true,
                  }),
                ]),
              ]),
            ]).start();
          });
        }
      });
    }
  }, [visible]);

  const themeColors = getThemeColors(type);
  const displayIcon = icon || getDefaultIcon(type);

  const handlePrimaryAction = () => {
    if (primaryButtonAction) {
      primaryButtonAction();
    } else {
      onDismiss();
    }
  };

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        dismissable={true}
        contentContainerStyle={styles.modalContainer}
      >
        {/* Confetti */}
        {enableConfetti && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {confetti.map((piece, index) => {
              const anim = confettiAnims[index];
              return (
                <Animated.View
                  key={piece.id}
                  style={[
                    styles.confetti,
                    {
                      left: `${piece.x}%`,
                      width: piece.size,
                      height: piece.size,
                      backgroundColor: piece.color,
                      opacity: anim.opacity,
                      transform: [
                        { translateY: anim.translateY },
                        {
                          rotate: anim.rotate.interpolate({
                            inputRange: [-360, 360],
                            outputRange: ['-360deg', '360deg'],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              );
            })}
          </View>
        )}

        {/* Content */}
        <Animated.View
          style={[
            styles.card,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.iconContainer,
              { backgroundColor: themeColors.iconBgColor },
              {
                transform: [
                  { scale: checkScaleAnim },
                  { scale: pulseAnim },
                ],
              },
            ]}
          >
            <IconButton
              icon={displayIcon}
              iconColor={themeColors.iconColor}
              size={60}
            />
          </Animated.View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.buttonContainer}>
            {/* Quote send button */}
            {quote && businessSettings ? (
              <SendQuoteButton
                quote={quote}
                businessSettings={businessSettings}
                buttonMode="outlined"
                buttonStyle={[styles.button, styles.secondaryButton]}
              />
            ) : secondaryButtonText && secondaryButtonAction ? (
              <Button
                mode="outlined"
                onPress={secondaryButtonAction}
                style={[styles.button, styles.secondaryButton]}
                textColor={colors.primary}
                loading={secondaryButtonLoading}
                disabled={secondaryButtonLoading}
              >
                {secondaryButtonText}
              </Button>
            ) : null}

            {/* Primary action button */}
            <Button
              mode="contained"
              onPress={handlePrimaryAction}
              style={styles.button}
              buttonColor={themeColors.buttonColor}
              textColor={colors.white}
            >
              {primaryButtonText}
            </Button>
          </View>
        </Animated.View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  confetti: {
    position: 'absolute',
    top: -100,
    borderRadius: 2,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    ...Platform.select({
      android: {
        elevation: 8,
        backgroundColor: colors.surface,
      },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      web: {
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      },
    }),
  },
  iconContainer: {
    marginBottom: 16,
    borderRadius: 50,
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 12,
    color: colors.text,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    marginBottom: 24,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 24,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  button: {
    width: '100%',
    paddingVertical: 6,
  },
  secondaryButton: {
    borderColor: colors.primary,
  },
});
