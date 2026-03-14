/**
 * Hook for bottom sheet lifecycle: Android back button interception + animated unmount.
 *
 * Returns `shouldRender` — use this instead of `visible` for the early-return null check.
 * When `visible` flips to false the close animation plays first, then `shouldRender`
 * becomes false so the component unmounts.
 */

import { useEffect, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';

export function useSheetBackHandler(
  visible: boolean,
  onDismiss: () => void,
  runCloseAnimation: (onFinished: () => void) => void,
) {
  const [shouldRender, setShouldRender] = useState(false);
  const prevVisible = useRef(visible);

  useEffect(() => {
    if (visible && !prevVisible.current) {
      // Opening
      setShouldRender(true);
    } else if (!visible && prevVisible.current) {
      // Closing — animate out, then unmount
      runCloseAnimation(() => setShouldRender(false));
    }
    prevVisible.current = visible;
  }, [visible, runCloseAnimation]);

  // Android back button
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true; // prevent default (exit app)
    });

    return () => sub.remove();
  }, [visible, onDismiss]);

  return shouldRender;
}
