/**
 * Success Modal Component
 * Beautiful animated celebration modal for confirming actions
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

interface SuccessModalProps {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  message?: string;
  buttonText?: string;
  icon?: string;
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

export function SuccessModal({
  visible,
  onDismiss,
  title = 'Success!',
  message = 'Your action was completed successfully.',
  buttonText = 'Done',
  icon = 'check-circle',
}: SuccessModalProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const checkScaleAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [confetti] = useState<ConfettiPiece[]>(() => {
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

      confettiAnims.forEach(anim => {
        anim.translateY.setValue(-100);
        anim.rotate.setValue(0);
        anim.opacity.setValue(0);
      });

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
      });
    }
  }, [visible]);

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        dismissable={true}
        contentContainerStyle={styles.modalContainer}
      >
        {/* Confetti */}
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
              {
                transform: [
                  { scale: checkScaleAnim },
                  { scale: pulseAnim },
                ],
              },
            ]}
          >
            <IconButton
              icon={icon}
              iconColor={colors.success}
              size={60}
            />
          </Animated.View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <Button
            mode="contained"
            onPress={onDismiss}
            style={styles.button}
            buttonColor={colors.success}
            textColor={colors.white}
          >
            {buttonText}
          </Button>
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
    }),
  },
  iconContainer: {
    marginBottom: 16,
    backgroundColor: colors.successBg,
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
  button: {
    width: '100%',
    paddingVertical: 6,
  },
});
