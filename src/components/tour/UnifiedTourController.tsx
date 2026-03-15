/**
 * Unified Tour Controller
 * Orchestrates auto-navigation and dummy data injection between screens.
 * Mounted once in the RootNavigator — listens to tour phase changes
 * and drives the entire guided tour flow.
 */

import { useRef, useCallback, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useStore } from '../../store/useStore';
import { TourPhase, getNextPhase } from './tourFlow';
import {
  TOUR_CUSTOMER,
  TOUR_JOB_CLEANED_TITLE,
  TOUR_JOB_CLEANED_DESCRIPTION,
  getTourMaterialsUnpriced,
  getTourAddedMaterial,
  TOUR_LABOR,
} from './tourDummyData';
import { TourSkipModal } from './TourSkipModal';

// ─── Shared refs for screens to call back into the controller ───
// Using module-level refs avoids prop drilling through navigation
const screenCompleteRef: { current: ((phase: TourPhase) => void) | null } = { current: null };
const skipRequestRef: { current: (() => void) | null } = { current: null };

/** Call from a screen when its tour steps complete */
export function notifyScreenComplete(phase: TourPhase) {
  screenCompleteRef.current?.(phase);
}

/** Call from a screen when user taps Skip */
export function notifySkipRequest() {
  skipRequestRef.current?.();
}

export function UnifiedTourController() {
  const navigation = useNavigation<any>();
  const {
    unifiedTourActive,
    unifiedTourPhase,
    unifiedTourQuoteId,
    currentQuote,
    setUnifiedTourPhase,
    updateQuote,
    skipUnifiedTour,
    endUnifiedTour,
  } = useStore();

  const [showSkipModal, setShowSkipModal] = useState(false);
  const isNavigating = useRef(false);

  /** Show the skip confirmation modal */
  const handleSkipRequest = useCallback(() => {
    setShowSkipModal(true);
  }, []);

  /** User confirmed skip — clean up and go home */
  const handleConfirmSkip = useCallback(async () => {
    setShowSkipModal(false);
    await skipUnifiedTour();
    navigation.reset({
      index: 0,
      routes: [{ name: 'Main' }],
    });
  }, [skipUnifiedTour, navigation]);

  /** User wants to keep going */
  const handleResume = useCallback(() => {
    setShowSkipModal(false);
  }, []);

  /**
   * Called when a screen's tour steps complete.
   * Injects dummy data for the NEXT phase, then navigates.
   */
  const handleScreenComplete = useCallback((completedPhase: TourPhase) => {
    if (!unifiedTourActive || isNavigating.current) return;
    if (!currentQuote) return;
    isNavigating.current = true;

    const next = getNextPhase(completedPhase);

    if (!next) {
      // Tour is done! Just clean up — we're already on the dashboard
      endUnifiedTour().then(() => {
        isNavigating.current = false;
      });
      return;
    }

    // Inject dummy data for the next phase and navigate
    switch (next) {
      case 'jobDetails':
        // Dashboard complete → navigate into quote flow
        navigation.navigate('NewQuote', {
          screen: 'JobDetails',
          params: { fromTour: true },
        });
        setUnifiedTourPhase('jobDetails');
        break;

      case 'customerDetails':
        // Job details complete → inject cleaned job data, navigate
        updateQuote({
          ...currentQuote,
          job: {
            ...currentQuote.job,
            name: TOUR_JOB_CLEANED_TITLE,
            description: TOUR_JOB_CLEANED_DESCRIPTION,
          },
          customerName: '',
        });
        navigation.navigate('CustomerDetails');
        setUnifiedTourPhase('customerDetails');
        break;

      case 'materialsList':
        // Customer details complete → inject customer data, navigate
        updateQuote({
          ...currentQuote,
          customerName: TOUR_CUSTOMER.name,
          customerEmail: TOUR_CUSTOMER.email,
          customerPhone: TOUR_CUSTOMER.phone,
          jobAddress: TOUR_CUSTOMER.address,
        });
        navigation.navigate('MaterialsList');
        setUnifiedTourPhase('materialsList');
        break;

      case 'materialsListItems':
        // MaterialsList empty tour complete → inject unpriced materials (simulate AI)
        // The screen will handle the fake loading animation
        updateQuote({
          ...currentQuote,
          materials: getTourMaterialsUnpriced(),
        });
        setUnifiedTourPhase('materialsListItems');
        break;

      case 'addMaterial':
        // MaterialsListItems complete → navigate to AddMaterial
        navigation.navigate('AddMaterial');
        setUnifiedTourPhase('addMaterial');
        break;

      case 'materialsListAdded': {
        // AddMaterial complete → add dummy material, go back to materials list to show it
        const addedMaterial = getTourAddedMaterial();
        const updatedMaterials = [...(currentQuote.materials || []), addedMaterial];
        updateQuote({ ...currentQuote, materials: updatedMaterials });
        navigation.navigate('MaterialsList');
        setUnifiedTourPhase('materialsListAdded');
        break;
      }

      case 'laborMarkup': {
        // MaterialsListAdded complete → inject labor values, navigate to LaborMarkup
        const laborQuote = {
          ...currentQuote,
          laborHours: TOUR_LABOR.laborHours,
          laborRate: TOUR_LABOR.laborRate,
          markup: TOUR_LABOR.markup,
          travelAdjustment: TOUR_LABOR.travelAdjustment,
          estimatedDistance: TOUR_LABOR.estimatedDistance,
          estimatedFuelCost: TOUR_LABOR.estimatedFuelCost,
        };
        updateQuote(laborQuote);
        navigation.navigate('LaborMarkup');
        setUnifiedTourPhase('laborMarkup');
        break;
      }

      case 'quotePreview':
        // Labor complete → navigate to preview
        navigation.navigate('QuotePreview');
        setUnifiedTourPhase('quotePreview');
        break;

      case 'dashboardComplete':
        // Quote preview complete → save the quote, go back to dashboard to show the card
        navigation.reset({
          index: 0,
          routes: [{ name: 'Main' }],
        });
        setUnifiedTourPhase('dashboardComplete');
        break;
    }

    // Reset navigation guard after navigation settles
    setTimeout(() => {
      isNavigating.current = false;
    }, 250);
  }, [unifiedTourActive, currentQuote, navigation, setUnifiedTourPhase, updateQuote, endUnifiedTour]);

  // Expose handleScreenComplete and handleSkipRequest via store-like pattern
  // Screens access these via the exported context
  // Update the ref so screens can call these
  screenCompleteRef.current = handleScreenComplete;
  skipRequestRef.current = handleSkipRequest;

  return (
    <TourSkipModal
      visible={showSkipModal}
      onResume={handleResume}
      onConfirmSkip={handleConfirmSkip}
    />
  );
}
