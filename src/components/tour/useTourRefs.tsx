/**
 * Tour refs context — register & measure target element positions
 *
 * Refs are registered via useRef + useEffect (post-mount) to avoid
 * inline ref callbacks that can cause Fabric viewState crashes on Android.
 */

import React, { createContext, useContext, useRef, useCallback } from 'react';
import { View, Platform, StatusBar } from 'react-native';

export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TourRefsContextType {
  registerRef: (id: string, ref: View | null) => void;
  measureTarget: (id: string) => Promise<TargetRect | null>;
}

const TourRefsContext = createContext<TourRefsContextType>({
  registerRef: () => {},
  measureTarget: async () => null,
});

export function TourRefsProvider({ children }: { children: React.ReactNode }) {
  const refsMap = useRef<Map<string, View>>(new Map());

  const registerRef = useCallback((id: string, ref: View | null) => {
    if (ref) {
      refsMap.current.set(id, ref);
    } else {
      refsMap.current.delete(id);
    }
  }, []);

  const measureTarget = useCallback((id: string): Promise<TargetRect | null> => {
    return new Promise((resolve) => {
      const ref = refsMap.current.get(id);
      if (!ref) {
        resolve(null);
        return;
      }

      try {
        ref.measureInWindow((x, y, width, height) => {
          if (width === 0 && height === 0) {
            resolve(null);
          } else {
            // On Android, measureInWindow may not include the status bar
            // offset relative to the Portal's coordinate space
            const statusBarOffset =
              Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
            resolve({ x, y: y + statusBarOffset, width, height });
          }
        });
      } catch {
        resolve(null);
      }
    });
  }, []);

  return (
    <TourRefsContext.Provider value={{ registerRef, measureTarget }}>
      {children}
    </TourRefsContext.Provider>
  );
}

export function useTourRefs() {
  return useContext(TourRefsContext);
}
