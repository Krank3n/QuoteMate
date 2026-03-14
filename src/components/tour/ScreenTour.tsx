/**
 * ScreenTour — contextual tour for individual screens
 * Shows a short spotlight tour on first visit, then never again.
 * Uses the same overlay/tooltip system as the dashboard tour.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useWindowDimensions, TouchableWithoutFeedback, StyleSheet, View, ScrollView } from 'react-native';
import { Portal } from 'react-native-paper';
import { SpotlightOverlay } from './SpotlightOverlay';
import { TourTooltip } from './TourTooltip';
import { SCREEN_TOURS, ScreenTourId, TourStep } from './tourSteps';
import { TargetRect, useTourRefs } from './useTourRefs';
import { useStore } from '../../store/useStore';

interface ScreenTourProps {
  tourId: ScreenTourId;
  /** Delay before starting (ms). Default 600. */
  delay?: number;
  scrollRef?: React.RefObject<ScrollView>;
}

export function ScreenTour({ tourId, delay = 600, scrollRef }: ScreenTourProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { markScreenTourSeen, hasSeenScreenTour } = useStore();
  const { measureTarget } = useTourRefs();

  const steps = SCREEN_TOURS[tourId];
  const [active, setActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Auto-trigger on mount if not seen
  useEffect(() => {
    if (!steps || steps.length === 0) return;
    if (hasSeenScreenTour(tourId)) return;

    const timer = setTimeout(() => setActive(true), delay);
    return () => clearTimeout(timer);
  }, [tourId]);

  const handleFinish = useCallback(async () => {
    setIsVisible(false);
    setTargetRect(null);
    setActive(false);
    await markScreenTourSeen(tourId);
  }, [tourId, markScreenTourSeen]);

  // Measure current step
  const measureCurrentStep = useCallback(async (stepIdx: number) => {
    const step = steps?.[stepIdx];
    if (!step) return;

    const rect = await measureTarget(step.id);
    if (rect) {
      setTargetRect(rect);
      setIsVisible(true);
    } else {
      // Skip missing targets
      if (stepIdx < steps.length - 1) {
        setCurrentStep(stepIdx + 1);
      } else {
        handleFinish();
      }
    }
  }, [steps, measureTarget, handleFinish]);

  // Start + step changes
  useEffect(() => {
    if (active) {
      measureCurrentStep(currentStep);
    }
  }, [active, currentStep]);

  const handleNext = useCallback(() => {
    if (!steps) return;
    if (currentStep < steps.length - 1) {
      setIsVisible(false);
      setTimeout(() => setCurrentStep(prev => prev + 1), 160);
    } else {
      handleFinish();
    }
  }, [currentStep, steps, handleFinish]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setIsVisible(false);
      setTimeout(() => setCurrentStep(prev => prev - 1), 160);
    }
  }, [currentStep]);

  if (!active || !steps || !targetRect) return null;

  const step = steps[currentStep];
  if (!step) return null;

  return (
    <Portal>
      <View style={StyleSheet.absoluteFill}>
        <TouchableWithoutFeedback onPress={handleNext}>
          <View style={StyleSheet.absoluteFill}>
            <SpotlightOverlay target={targetRect} visible={isVisible} />
          </View>
        </TouchableWithoutFeedback>
      </View>
      {isVisible && (
        <TourTooltip
          step={step}
          stepIndex={currentStep}
          totalSteps={steps.length}
          target={targetRect}
          screenWidth={screenW}
          screenHeight={screenH}
          onNext={handleNext}
          onBack={handleBack}
          onSkip={handleFinish}
        />
      )}
    </Portal>
  );
}
