/**
 * ScreenTour — contextual tour for individual screens
 * Shows a short spotlight tour on first visit, then never again.
 * Uses the same overlay/tooltip system as the dashboard tour.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useWindowDimensions, StyleSheet, View, ScrollView } from 'react-native';
import { Portal } from 'react-native-paper';
import { useIsFocused } from '@react-navigation/native';
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
  /** Map of step id → scroll Y position. Used to scroll targets into view. */
  scrollPositions?: Record<string, number>;
  /** Called when tour active state changes — use to disable scroll during tour */
  onActiveChange?: (active: boolean) => void;
  /** Called when the current step changes — receives the step id */
  onStepChange?: (stepId: string) => void;
  /** Offset added to displayed step number for sequential numbering */
  stepOffset?: number;
  /** Override displayed total for sequential numbering across tours */
  globalTotalSteps?: number;
}

export function ScreenTour({ tourId, delay = 600, scrollRef, scrollPositions, onActiveChange, onStepChange, stepOffset = 0, globalTotalSteps }: ScreenTourProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { markScreenTourSeen, hasSeenScreenTour } = useStore();
  const { measureTarget } = useTourRefs();
  const isFocused = useIsFocused();

  const steps = SCREEN_TOURS[tourId];
  const [active, setActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Auto-trigger on mount if not seen
  useEffect(() => {
    if (!steps || steps.length === 0) return;
    if (hasSeenScreenTour(tourId)) return;

    const timer = setTimeout(() => {
      setActive(true);
      onActiveChange?.(true);
    }, delay);
    return () => clearTimeout(timer);
  }, [tourId]);

  // Dismiss tour when screen loses focus (e.g. navigation)
  useEffect(() => {
    if (!isFocused && active) {
      setIsVisible(false);
      setTargetRect(null);
      setActive(false);
      onActiveChange?.(false);
    }
  }, [isFocused]);

  const handleFinish = useCallback(async () => {
    setIsVisible(false);
    setTargetRect(null);
    setActive(false);
    onActiveChange?.(false);
    await markScreenTourSeen(tourId);
  }, [tourId, markScreenTourSeen, onActiveChange]);

  // Scroll target into view if needed, then measure
  const scrollAndMeasure = useCallback(async (stepIdx: number) => {
    const step = steps?.[stepIdx];
    if (!step) return;

    // Scroll to predefined position if provided
    if (scrollRef?.current && scrollPositions && step.id in scrollPositions) {
      scrollRef.current.scrollTo({ y: scrollPositions[step.id], animated: true });
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    // Wait for layout to settle before measuring
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = await measureTarget(step.id);
    if (rect) {
      setTargetRect(rect);
      setIsVisible(true);
      // Only fire for initial step — subsequent steps fire from handleNext
      if (stepIdx === 0) onStepChange?.(step.id);
    } else {
      // Skip missing targets
      if (stepIdx < steps.length - 1) {
        setCurrentStep(stepIdx + 1);
      } else {
        handleFinish();
      }
    }
  }, [steps, measureTarget, handleFinish, scrollRef, scrollPositions, onStepChange]);

  // Start + step changes
  useEffect(() => {
    if (active) {
      scrollAndMeasure(currentStep);
    }
  }, [active, currentStep]);

  // Re-measure periodically while visible (adapts to target size changes)
  useEffect(() => {
    if (!active || !isVisible || !steps) return;
    const step = steps[currentStep];
    if (!step) return;

    const interval = setInterval(async () => {
      const rect = await measureTarget(step.id);
      if (rect) {
        setTargetRect(prev => {
          if (!prev) return rect;
          // Only update if size or position changed meaningfully
          if (Math.abs(prev.height - rect.height) > 2 ||
              Math.abs(prev.width - rect.width) > 2 ||
              Math.abs(prev.y - rect.y) > 2) {
            return rect;
          }
          return prev;
        });
      }
    }, 200);

    return () => clearInterval(interval);
  }, [active, isVisible, currentStep, steps, measureTarget]);

  const handleNext = useCallback(() => {
    if (!steps) return;
    if (currentStep < steps.length - 1) {
      // Fire callback immediately with the upcoming step id so parent can act instantly
      const nextStep = steps[currentStep + 1];
      if (nextStep) onStepChange?.(nextStep.id);
      setIsVisible(false);
      setTimeout(() => setCurrentStep(prev => prev + 1), 160);
    } else {
      handleFinish();
    }
  }, [currentStep, steps, handleFinish, onStepChange]);

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
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={StyleSheet.absoluteFill}>
          <SpotlightOverlay target={targetRect} visible={isVisible} />
        </View>
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
          stepOffset={stepOffset}
          globalTotalSteps={globalTotalSteps}
        />
      )}
    </Portal>
  );
}
