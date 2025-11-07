/**
 * Celebration Animation Component
 * Beautiful success animation for quote saved
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';

const { width, height } = Dimensions.get('window');

interface CelebrationAnimationProps {
  visible: boolean;
  onComplete?: () => void;
  message?: string;
}

export function CelebrationAnimation({
  visible,
  onComplete,
  message = 'Quote Saved Successfully!',
}: CelebrationAnimationProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const checkmarkScale = useRef(new Animated.Value(0)).current;
  const confettiAnims = useRef(
    Array.from({ length: 30 }, () => ({
      translateY: new Animated.Value(0),
      translateX: new Animated.Value(0),
      rotate: new Animated.Value(0),
      opacity: new Animated.Value(1),
    }))
  ).current;

  useEffect(() => {
    console.log('🎉 CelebrationAnimation useEffect, visible:', visible);
    if (visible) {
      console.log('🎨 Resetting and starting animations...');
      // Reset all animations first
      fadeAnim.setValue(0);
      scaleAnim.setValue(0);
      checkmarkScale.setValue(0);
      confettiAnims.forEach(anim => {
        anim.translateX.setValue(0);
        anim.translateY.setValue(0);
        anim.rotate.setValue(0);
        anim.opacity.setValue(1);
      });

      // Start all animations
      Animated.sequence([
        // Fade in background
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        // Scale in circle
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        // Pop in checkmark
        Animated.spring(checkmarkScale, {
          toValue: 1,
          tension: 100,
          friction: 5,
          useNativeDriver: true,
        }),
      ]).start();

      // Animate confetti
      confettiAnims.forEach((anim, index) => {
        const angle = (index / confettiAnims.length) * Math.PI * 2;
        const distance = 300 + Math.random() * 200;
        const endX = Math.cos(angle) * distance;
        const endY = Math.sin(angle) * distance;

        Animated.parallel([
          Animated.timing(anim.translateX, {
            toValue: endX,
            duration: 1500 + Math.random() * 500,
            useNativeDriver: true,
          }),
          Animated.timing(anim.translateY, {
            toValue: endY,
            duration: 1500 + Math.random() * 500,
            useNativeDriver: true,
          }),
          Animated.timing(anim.rotate, {
            toValue: Math.random() * 720 - 360,
            duration: 1500 + Math.random() * 500,
            useNativeDriver: true,
          }),
          Animated.timing(anim.opacity, {
            toValue: 0,
            duration: 1500 + Math.random() * 500,
            useNativeDriver: true,
          }),
        ]).start();
      });

      // Auto-complete after animation
      const timer = setTimeout(() => {
        console.log('⏰ Auto-complete timer fired');
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          console.log('✅ Fade out complete, calling onComplete');
          onComplete?.();
        });
      }, 2000);

      return () => {
        console.log('🧹 Cleaning up celebration animation');
        clearTimeout(timer);
      };
    }
  }, [visible]);

  if (!visible) {
    console.log('❌ CelebrationAnimation not visible, returning null');
    return null;
  }

  console.log('✅ Rendering CelebrationAnimation');
  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={() => {
        console.log('🎉 Celebration tapped, completing...');
        onComplete?.();
      }}
      style={StyleSheet.absoluteFill}
    >
      <Animated.View
        style={[
          styles.container,
          {
            opacity: fadeAnim,
          },
        ]}
      >
      {/* Confetti particles */}
      {confettiAnims.map((anim, index) => {
        const colors = ['#009868', '#cfa153', '#00C897', '#E6B872', '#5AB9EA'];
        const color = colors[index % colors.length];
        const size = 8 + Math.random() * 8;

        return (
          <Animated.View
            key={index}
            style={[
              styles.confetti,
              {
                width: size,
                height: size,
                backgroundColor: color,
                transform: [
                  { translateX: anim.translateX },
                  { translateY: anim.translateY },
                  {
                    rotate: anim.rotate.interpolate({
                      inputRange: [-360, 360],
                      outputRange: ['-360deg', '360deg'],
                    }),
                  },
                ],
                opacity: anim.opacity,
              },
            ]}
          />
        );
      })}

      {/* Success circle and checkmark */}
      <Animated.View
        style={[
          styles.successCircle,
          {
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Animated.View
          style={{
            transform: [{ scale: checkmarkScale }],
          }}
        >
          <MaterialCommunityIcons
            name="check-circle"
            size={120}
            color={colors.success}
          />
        </Animated.View>
      </Animated.View>

      {/* Success message */}
      <Animated.View
        style={[
          styles.messageContainer,
          {
            opacity: fadeAnim,
            transform: [
              {
                translateY: scaleAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Text style={styles.message}>{message}</Text>
        <Text style={styles.tapHint}>Tap anywhere to continue</Text>
      </Animated.View>
    </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.95)', // Semi-transparent dark background
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  confetti: {
    position: 'absolute',
    borderRadius: 4,
  },
  successCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: colors.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
  },
  messageContainer: {
    marginTop: 32,
    paddingHorizontal: 40,
  },
  message: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.success,
    textAlign: 'center',
  },
  tapHint: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 12,
    opacity: 0.7,
  },
});
