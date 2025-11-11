/**
 * Onboarding Progress Indicator
 * Beautiful progress bar with step indicators
 */

import React from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';

export interface OnboardingStep {
  id: number;
  label: string;
  icon: string;
}

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
  steps: OnboardingStep[];
}

export function OnboardingProgress({
  currentStep,
  totalSteps,
  steps,
}: OnboardingProgressProps) {
  const progressPercentage = ((currentStep - 1) / (totalSteps - 1)) * 100;

  return (
    <View style={styles.container}>
      {/* Progress Bar */}
      <View style={styles.progressBarContainer}>
        <View style={styles.progressBarBackground} />
        <Animated.View
          style={[
            styles.progressBarFill,
            {
              width: `${progressPercentage}%`,
            },
          ]}
        />
      </View>

      {/* Step Indicators */}
      <View style={styles.stepsContainer}>
        {steps.map((step) => {
          const isComplete = step.id < currentStep;
          const isCurrent = step.id === currentStep;
          const isUpcoming = step.id > currentStep;

          return (
            <View key={step.id} style={styles.stepWrapper}>
              <View
                style={[
                  styles.stepCircle,
                  isComplete && styles.stepCircleComplete,
                  isCurrent && styles.stepCircleCurrent,
                  isUpcoming && styles.stepCircleUpcoming,
                ]}
              >
                {isComplete ? (
                  <MaterialCommunityIcons
                    name="check"
                    size={16}
                    color={colors.surface}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name={step.icon as any}
                    size={16}
                    color={
                      isCurrent
                        ? colors.surface
                        : isUpcoming
                        ? colors.textMuted
                        : colors.surface
                    }
                  />
                )}
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  isCurrent && styles.stepLabelCurrent,
                  isUpcoming && styles.stepLabelUpcoming,
                ]}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Step Counter */}
      <Text style={styles.stepCounter}>
        Step {currentStep} of {totalSteps}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: colors.surfaceLight,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 20,
  },
  progressBarBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceLight,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  stepsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  stepWrapper: {
    alignItems: 'center',
    flex: 1,
  },
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  stepCircleComplete: {
    backgroundColor: colors.primary,
  },
  stepCircleCurrent: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  stepCircleUpcoming: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 2,
    borderColor: colors.outline,
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  stepLabelCurrent: {
    color: colors.primary,
    fontWeight: '700',
  },
  stepLabelUpcoming: {
    color: colors.textMuted,
  },
  stepCounter: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});
