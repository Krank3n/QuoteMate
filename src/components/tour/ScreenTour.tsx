/**
 * ScreenTour — contextual tour for individual screens
 * Shows a short spotlight tour on first visit, then never again.
 * Uses the same overlay/tooltip system as the dashboard tour.
 *
 * In unified mode, the tour is externally controlled by the orchestrator:
 * - Always shows (ignores hasSeenScreenTour)
 * - Calls onScreenComplete instead of marking as seen
 * - Calls onSkipRequest instead of dismissing
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
  /** When true, controlled by unified tour orchestrator */
  unifiedMode?: boolean;
  /** Called when the last step finishes in unified mode (triggers auto-navigation) */
  onScreenComplete?: () => void;
  /** Called when user taps Skip in unified mode (shows confirmation modal) */
  onSkipRequest?: () => void;
}

export function ScreenTour({ tourId, delay = 600, scrollRef, scrollPositions, onActiveChange, onStepChange, stepOffset = 0, globalTotalSteps, unifiedMode = false, onScreenComplete, onSkipRequest }: ScreenTourProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { markScreenTourSeen, hasSeenScreenTour, unifiedTourActive } = useStore();
  const { measureTarget } = useTourRefs();
  const isFocused = useIsFocused();

  const steps = SCREEN_TOURS[tourId];
  const [active, setActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Auto-trigger on mount if not seen (or always in unified mode)
  // When unified tour is active, only the ScreenTour with unifiedMode=true should trigger
  useEffect(() => {
    if (!steps || steps.length === 0) return;
    if (!unifiedMode && unifiedTourActive) return; // suppress standalone tours during unified tour
    if (!unifiedMode && hasSeenScreenTour(tourId)) return;

    // In unified mode, use a shorter delay since the previous phase already dismissed
    const effectiveDelay = unifiedMode ? Math.min(delay, 300) : delay;
    const timer = setTimeout(() => {
      setActive(true);
      onActiveChange?.(true);
    }, effectiveDelay);
    return () => clearTimeout(timer);
  }, [tourId, unifiedMode]);

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

    if (unifiedMode) {
      // In unified mode, signal screen complete — orchestrator handles navigation
      onScreenComplete?.();
    } else {
      await markScreenTourSeen(tourId);
    }
  }, [tourId, markScreenTourSeen, onActiveChange, unifiedMode, onScreenComplete]);

  const handleSkip = useCallback(() => {
    if (unifiedMode) {
      // In unified mode, show confirmation modal instead of dismissing
      onSkipRequest?.();
    } else {
      handleFinish();
    }
  }, [unifiedMode, onSkipRequest, handleFinish]);

  // Scroll target into view if needed, then measure
  const scrollAndMeasure = useCallback(async (stepIdx: number) => {
    const step = steps?.[stepIdx];
    if (!step) return;

    // Scroll to predefined position if provided
    if (scrollRef?.current && scrollPositions && step.id in scrollPositions) {
      scrollRef.current.scrollTo({ y: scrollPositions[step.id], animated: true });
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    // Wait for layout to settle before measuring (navigation transitions need extra time)
    await new Promise(resolve => setTimeout(resolve, 150));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    let rect = await measureTarget(step.id);

    // If the target is off-screen (or mostly off-screen), try to scroll it into view
    if (rect && scrollRef?.current) {
      const TOOLTIP_SPACE = 220; // space needed for tooltip above or below
      const isAboveScreen = rect.y + rect.height < 0;
      const isBelowScreen = rect.y > screenH;
      const tooltipWouldClip = step.tooltipPosition === 'bottom'
        ? (rect.y + rect.height + TOOLTIP_SPACE > screenH)
        : (rect.y - TOOLTIP_SPACE < 0);

      if (isAboveScreen || isBelowScreen || tooltipWouldClip) {
        // Calculate how much to scroll — aim to center the target + tooltip in view
        const targetCenter = rect.y + rect.height / 2;
        const idealCenter = screenH * 0.4; // slightly above center
        const scrollDelta = targetCenter - idealCenter;

        // We need the current scroll offset, so use scrollPositions as a base hint
        const baseScroll = (scrollPositions && step.id in scrollPositions)
          ? scrollPositions[step.id] : 0;
        const newScrollY = Math.max(0, baseScroll + scrollDelta);

        scrollRef.current.scrollTo({ y: newScrollY, animated: true });
        await new Promise(resolve => setTimeout(resolve, 400));

        // Re-measure after scrolling
        rect = await measureTarget(step.id);
      }
    }

    // Retry a few times if target isn't measurable yet (e.g. async mount like PhotoAnnotator)
    if (!rect) {
      for (let retry = 0; retry < 5 && !rect; retry++) {
        await new Promise(resolve => setTimeout(resolve, 300));
        rect = await measureTarget(step.id);
      }
    }

    if (rect) {
      setTargetRect(rect);
      setIsVisible(true);
      // Only fire for initial step — subsequent steps fire from handleNext
      if (stepIdx === 0) onStepChange?.(step.id);
      // Quick re-measure after a beat to correct any drift from transition animations
      setTimeout(async () => {
        const corrected = await measureTarget(step.id);
        if (corrected) setTargetRect(corrected);
      }, 400);
    } else {
      // Skip missing targets
      if (stepIdx < steps.length - 1) {
        setCurrentStep(stepIdx + 1);
      } else {
        handleFinish();
      }
    }
  }, [steps, measureTarget, handleFinish, scrollRef, scrollPositions, onStepChange, screenH]);

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
      {/* Touch-blocking layer — intercepts ALL touches while tour is active.
           Tapping anywhere (outside tooltip buttons) advances to the next step. */}
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.01)', zIndex: 9998 }]}
        pointerEvents="auto"
        onStartShouldSetResponder={() => true}
        onStartShouldSetResponderCapture={() => true}
        onMoveShouldSetResponder={() => true}
        onMoveShouldSetResponderCapture={() => true}
        onResponderRelease={() => { if (isVisible) handleNext(); }}
      />
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
          onSkip={handleSkip}
          stepOffset={stepOffset}
          globalTotalSteps={globalTotalSteps}
        />
      )}
    </Portal>
  );
}
