/**
 * SpotlightTour — orchestrator component
 * Manages step state, wires overlay + tooltip, handles scrolling
 *
 * Dashboard elements are measured via context refs.
 * Tab bar buttons are measured by calculating positions from screen dimensions
 * (avoids structural changes to the tab bar that cause Fabric crashes).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useWindowDimensions, StyleSheet, View, ScrollView } from 'react-native';
import { Portal } from 'react-native-paper';
import { SpotlightOverlay } from './SpotlightOverlay';
import { TourTooltip } from './TourTooltip';
import { TOUR_STEPS } from './tourSteps';
import { TargetRect, useTourRefs } from './useTourRefs';
import { useStore } from '../../store/useStore';

interface SpotlightTourProps {
  active: boolean;
  onFinish: () => void;
  /** Optional override for Skip button — if provided, called instead of handleFinish */
  onSkip?: () => void;
  scrollRef?: React.RefObject<ScrollView>;
  /** Offset added to displayed step number for sequential numbering */
  stepOffset?: number;
  /** Override displayed total for sequential numbering across tours */
  globalTotalSteps?: number;
}

export function SpotlightTour({ active, onFinish, onSkip, scrollRef, stepOffset = 0, globalTotalSteps }: SpotlightTourProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { setHasSeenTour } = useStore();
  const { measureTarget } = useTourRefs();

  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const handleFinish = useCallback(async () => {
    setIsVisible(false);
    setTargetRect(null);
    await setHasSeenTour(true);
    onFinish();
  }, [onFinish, setHasSeenTour]);

  // Measure the current step's target
  const measureCurrentStep = useCallback(async (stepIdx: number) => {
    const step = TOUR_STEPS[stepIdx];
    if (!step) return;

    // Wait for layout to settle before measuring
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = await measureTarget(step.id);
    if (rect) {
      setTargetRect(rect);
      setIsVisible(true);
    } else {
      // Target not found — skip to next step
      if (stepIdx < TOUR_STEPS.length - 1) {
        setCurrentStep(stepIdx + 1);
      } else {
        handleFinish();
      }
    }
  }, [measureTarget, handleFinish]);

  // Scroll target into view then measure
  const scrollAndMeasure = useCallback(async (stepIdx: number) => {
    const step = TOUR_STEPS[stepIdx];
    if (!step) return;

    const scrollTargets = ['header', 'referralButton', 'newQuoteButton', 'statsGrid', 'recentQuotes'];
    if (scrollRef?.current && scrollTargets.includes(step.id)) {
      const scrollPositions: Record<string, number> = {
        header: 0,
        referralButton: 0,
        newQuoteButton: 0,
        statsGrid: 200,
        recentQuotes: 400,
      };
      scrollRef.current.scrollTo({ y: scrollPositions[step.id] || 0, animated: true });
      await new Promise(resolve => setTimeout(resolve, 350));
    }

    await measureCurrentStep(stepIdx);
  }, [measureCurrentStep, scrollRef]);

  // Reset step when tour starts/restarts
  useEffect(() => {
    if (active) {
      setCurrentStep(0);
      setTargetRect(null);
      setIsVisible(false);
    } else {
      setIsVisible(false);
    }
  }, [active]);

  // Measure when step changes (single source of truth for measurement)
  useEffect(() => {
    if (!active) return;
    // Small delay on step 0 to let the reset settle
    const delay = currentStep === 0 ? 150 : 0;
    const timer = setTimeout(() => scrollAndMeasure(currentStep), delay);
    return () => clearTimeout(timer);
  }, [currentStep, active]);

  const handleNext = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setIsVisible(false);
      setTimeout(() => setCurrentStep(prev => prev + 1), 160);
    } else {
      handleFinish();
    }
  }, [currentStep, handleFinish]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setIsVisible(false);
      setTimeout(() => setCurrentStep(prev => prev - 1), 160);
    }
  }, [currentStep]);

  const handleSkip = useCallback(() => {
    if (onSkip) {
      onSkip();
    } else {
      handleFinish();
    }
  }, [handleFinish, onSkip]);

  if (!active || !targetRect) return null;

  const step = TOUR_STEPS[currentStep];
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
          totalSteps={TOUR_STEPS.length}
          target={targetRect}
          screenWidth={screenW}
          screenHeight={screenH}
          onNext={handleNext}
          onBack={handleBack}
          onSkip={handleSkip}
          stepOffset={stepOffset}
          globalTotalSteps={globalTotalSteps}
        />
      )}
    </Portal>
  );
}
