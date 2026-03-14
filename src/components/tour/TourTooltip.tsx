/**
 * Themed tooltip card for the spotlight tour
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated as RNAnimated } from 'react-native';
import { Text, Button } from 'react-native-paper';
import Svg, { Polygon } from 'react-native-svg';
import { colors } from '../../theme';
import { TargetRect } from './useTourRefs';
import { TourStep } from './tourSteps';

/** Render text with **bold** markdown segments */
function BoldText({ children, style }: { children: string; style?: any }) {
  const parts = children.split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text style={style}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <Text key={i} style={{ fontWeight: 'bold', color: colors.text }}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
}

const MAX_WIDTH = 300;
const TOOLTIP_MARGIN = 12;
const CARET_SIZE = 8;
const SCREEN_PADDING = 16;
// Estimated tooltip height for clamping (title + desc + buttons)
const ESTIMATED_HEIGHT = 180;

interface TourTooltipProps {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  target: TargetRect;
  screenWidth: number;
  screenHeight: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function TourTooltip({
  step,
  stepIndex,
  totalSteps,
  target,
  screenWidth,
  screenHeight,
  onNext,
  onBack,
  onSkip,
}: TourTooltipProps) {
  const isLast = stepIndex === totalSteps - 1;
  const isFirst = stepIndex === 0;
  const padding = 8;

  const targetCenterX = target.x + target.width / 2;
  const tooltipWidth = Math.min(MAX_WIDTH, screenWidth - SCREEN_PADDING * 2);

  // Decide: tooltip below or above target
  let caretOnTop: boolean;
  let top: number;

  if (step.tooltipPosition === 'bottom') {
    const proposedTop = target.y + target.height + padding + TOOLTIP_MARGIN + CARET_SIZE;
    // If it would go off the bottom, flip to above
    if (proposedTop + ESTIMATED_HEIGHT > screenHeight - SCREEN_PADDING) {
      top = target.y - padding - TOOLTIP_MARGIN - CARET_SIZE;
      caretOnTop = false;
    } else {
      top = proposedTop;
      caretOnTop = true;
    }
  } else {
    const proposedTop = target.y - padding - TOOLTIP_MARGIN - CARET_SIZE;
    // If it would go off the top, flip to below
    if (proposedTop - ESTIMATED_HEIGHT < SCREEN_PADDING) {
      top = target.y + target.height + padding + TOOLTIP_MARGIN + CARET_SIZE;
      caretOnTop = true;
    } else {
      top = proposedTop;
      caretOnTop = false;
    }
  }

  // Clamp vertical position to screen bounds
  if (caretOnTop) {
    top = Math.max(SCREEN_PADDING, Math.min(top, screenHeight - ESTIMATED_HEIGHT - SCREEN_PADDING));
  }

  // Horizontal centering with screen bounds clamping
  let left = targetCenterX - tooltipWidth / 2;
  left = Math.max(SCREEN_PADDING, Math.min(left, screenWidth - tooltipWidth - SCREEN_PADDING));

  // Caret horizontal position
  const caretLeft = Math.max(20, Math.min(targetCenterX - left - CARET_SIZE, tooltipWidth - 20 - CARET_SIZE * 2));

  // Fade in animation
  const fadeAnim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    fadeAnim.setValue(0);
    RNAnimated.timing(fadeAnim, {
      toValue: 1,
      duration: 200,
      delay: 150,
      useNativeDriver: true,
    }).start();
  }, [stepIndex]);

  return (
    <RNAnimated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          left,
          width: tooltipWidth,
          ...(caretOnTop
            ? { top }
            : { bottom: screenHeight - top }),
        },
      ]}
      pointerEvents="box-none"
    >
      {/* Caret */}
      <View
        style={[
          styles.caretContainer,
          {
            left: caretLeft,
            ...(caretOnTop
              ? { top: -CARET_SIZE }
              : { bottom: -CARET_SIZE }),
          },
        ]}
      >
        <Svg width={CARET_SIZE * 2} height={CARET_SIZE} style={!caretOnTop ? { transform: [{ rotate: '180deg' }] } : undefined}>
          <Polygon
            points={`0,${CARET_SIZE} ${CARET_SIZE},0 ${CARET_SIZE * 2},${CARET_SIZE}`}
            fill={colors.surface}
          />
        </Svg>
      </View>

      <View style={styles.card}>
        <Text style={styles.counter}>{stepIndex + 1} of {totalSteps}</Text>
        <Text style={styles.title}>{step.title}</Text>
        <BoldText style={styles.description}>{step.description}</BoldText>

        <View style={styles.buttonRow}>
          <Button
            mode="text"
            onPress={onSkip}
            textColor={colors.onSurface}
            compact
          >
            Skip
          </Button>
          <View style={styles.navButtons}>
            {!isFirst && (
              <Button
                mode="text"
                onPress={onBack}
                textColor={colors.primary}
                compact
              >
                Back
              </Button>
            )}
            <Button
              mode="contained"
              onPress={onNext}
              compact
              style={styles.nextButton}
            >
              {isLast ? "Got it!" : 'Next'}
            </Button>
          </View>
        </View>
      </View>
    </RNAnimated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 1001,
  },
  caretContainer: {
    position: 'absolute',
    zIndex: 1002,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    backgroundColor: colors.surface,
    // Match quote card shadow style
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  counter: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 6,
  },
  description: {
    fontSize: 14,
    color: colors.onSurface,
    lineHeight: 20,
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  nextButton: {
    borderRadius: 20,
  },
});
