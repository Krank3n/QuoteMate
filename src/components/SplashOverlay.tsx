/**
 * SplashOverlay
 *
 * The JS half of the launch sequence. The native splash (iOS
 * SplashScreen.storyboard / Android launch window) shows the 200pt logo badge
 * centred on brand navy; this overlay renders the IDENTICAL frame — same
 * logo, same size, same position, same background — so the native→React
 * handoff on first paint is invisible. When loading finishes it reveals the
 * app underneath with a short fade while the logo drifts slightly toward the
 * viewer, instead of blinking out.
 *
 * A spinner fades in below the logo only when the load is slow enough to
 * need one, so a fast cold start reads as a single still frame → reveal.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Platform, StyleSheet } from 'react-native';

import { setSplashCovering } from './splashPresence';

// Deliberately NOT theme tokens. This is the navy baked into the logo art
// (assets/logo-lrg-margin.png) and the native splash backgrounds — it must
// match them in every theme, or the logo shows as a square tile. The spinner
// is Golden Wattle, the gold inside the same logo art.
const SPLASH_NAVY = '#1E293B';
const WATTLE_GOLD = '#cfa153';

/** Matches the 200pt imageView in ios/QuoteMate/SplashScreen.storyboard. */
const LOGO_SIZE = 200;
const EXIT_DURATION = 450;
const SPINNER_DELAY = 700;
const SPINNER_FADE = 250;

// On native the exit must run on the UI thread — the JS thread is busy
// mounting the dashboard right then. react-native-web's native-driver shim
// instead completes animations instantly (no fade at all), so web animates
// on the JS driver.
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

interface SplashOverlayProps {
  visible: boolean;
}

export function SplashOverlay({ visible }: SplashOverlayProps) {
  // Stays mounted through the exit animation, then removes itself.
  const [mounted, setMounted] = useState(visible);
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  const spinnerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Announced on the same tick the reveal starts, matching pointerEvents
    // below: the app underneath is interactive from then on, so mount-time work
    // that the user is meant to see is free to run. See splashPresence.
    setSplashCovering(visible);
    if (visible) {
      setMounted(true);
      overlayOpacity.setValue(1);
      logoScale.setValue(1);
      spinnerOpacity.setValue(0);
      const spinner = Animated.timing(spinnerOpacity, {
        toValue: 1,
        duration: SPINNER_FADE,
        delay: SPINNER_DELAY,
        useNativeDriver: USE_NATIVE_DRIVER,
      });
      spinner.start();
      return () => spinner.stop();
    }
    if (!mounted) return;
    const exit = Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: EXIT_DURATION,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(logoScale, {
        toValue: 1.08,
        duration: EXIT_DURATION,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]);
    exit.start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return () => exit.stop();
    // `mounted` is deliberately not a dependency beyond the guard read — the
    // exit run that sets it false must not re-trigger anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!mounted) return null;

  return (
    <Animated.View
      testID="splash-overlay"
      style={[styles.container, { opacity: overlayOpacity }]}
      // The app underneath becomes interactive the moment the reveal starts.
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <Animated.Image
        testID="splash-logo"
        source={require('../../assets/logo-lrg-margin.png')}
        style={[styles.logo, { transform: [{ scale: logoScale }] }]}
        resizeMode="contain"
      />
      <Animated.View style={[styles.spinner, { opacity: spinnerOpacity }]}>
        <ActivityIndicator size="large" color={WATTLE_GOLD} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SPLASH_NAVY,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  // Absolute so the logo keeps the exact screen-centre position of the
  // native splash — a flex sibling would push it upward.
  spinner: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
  },
});
