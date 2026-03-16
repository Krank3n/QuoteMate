/**
 * Swipeable Card Wrapper
 * Adds swipe-to-reveal actions on quote and invoice cards
 * Swipe left: Send, Duplicate
 * Swipe right: Delete
 */

import React, { useRef } from 'react';
import { View, StyleSheet, Animated, Platform } from 'react-native';
import { RectButton } from 'react-native-gesture-handler';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Text } from 'react-native-paper';
import { colors } from '../theme';
import { mediumTap } from '../utils/haptics';

interface SwipeAction {
  icon: string;
  label: string;
  color: string;
  bgColor: string;
  onPress: () => void;
}

interface SwipeableCardProps {
  children: React.ReactNode;
  leftActions?: SwipeAction[];
  rightActions?: SwipeAction[];
  /** Exposed ref to programmatically open/close the swipeable */
  swipeableRef?: React.RefObject<Swipeable>;
}

const ACTION_WIDTH = 72;

export function SwipeableCard({ children, leftActions, rightActions, swipeableRef: externalRef }: SwipeableCardProps) {
  const internalRef = useRef<Swipeable>(null);
  const swipeableRef = externalRef || internalRef;

  if (Platform.OS === 'web') {
    return <>{children}</>;
  }

  const close = () => swipeableRef.current?.close();

  const renderRightActions = (progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
    if (!rightActions?.length) return null;
    const totalWidth = rightActions.length * ACTION_WIDTH;

    return (
      <View style={[styles.actionsContainer, styles.rightActionsContainer, { width: totalWidth }]}>
        {rightActions.map((action, index) => {
          const scale = progress.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [0.6, 0.9, 1],
            extrapolate: 'clamp',
          });
          const opacity = progress.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [0, 0.5, 1],
            extrapolate: 'clamp',
          });

          return (
            <Animated.View
              key={index}
              style={[
                styles.actionWrapper,
                { opacity, transform: [{ scale }] },
              ]}
            >
              <RectButton
                style={styles.actionButton}
                onPress={() => {
                  mediumTap();
                  close();
                  setTimeout(action.onPress, 200);
                }}
              >
                <View style={[styles.actionIconCircle, { backgroundColor: action.bgColor }]}>
                  <MaterialCommunityIcons name={action.icon as any} size={20} color={action.color} />
                </View>
                <Text style={styles.actionLabel} numberOfLines={1}>{action.label}</Text>
              </RectButton>
            </Animated.View>
          );
        })}
      </View>
    );
  };

  const renderLeftActions = (progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
    if (!leftActions?.length) return null;
    const totalWidth = leftActions.length * ACTION_WIDTH;

    return (
      <View style={[styles.actionsContainer, styles.leftActionsContainer, { width: totalWidth }]}>
        {leftActions.map((action, index) => {
          const scale = progress.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [0.6, 0.9, 1],
            extrapolate: 'clamp',
          });
          const opacity = progress.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [0, 0.5, 1],
            extrapolate: 'clamp',
          });

          return (
            <Animated.View
              key={index}
              style={[
                styles.actionWrapper,
                { opacity, transform: [{ scale }] },
              ]}
            >
              <RectButton
                style={styles.actionButton}
                onPress={() => {
                  mediumTap();
                  close();
                  setTimeout(action.onPress, 200);
                }}
              >
                <View style={[styles.actionIconCircle, { backgroundColor: action.bgColor }]}>
                  <MaterialCommunityIcons name={action.icon as any} size={20} color={action.color} />
                </View>
                <Text style={styles.actionLabel} numberOfLines={1}>{action.label}</Text>
              </RectButton>
            </Animated.View>
          );
        })}
      </View>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderLeftActions={leftActions?.length ? renderLeftActions : undefined}
      renderRightActions={rightActions?.length ? renderRightActions : undefined}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
      leftThreshold={40}
      rightThreshold={40}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12, // Match card marginBottom
  },
  rightActionsContainer: {
    justifyContent: 'flex-end',
  },
  leftActionsContainer: {
    justifyContent: 'flex-start',
  },
  actionWrapper: {
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    width: '100%',
  },
  actionIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  actionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
});
