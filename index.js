/**
 * QuoteMate Entry Point
 * Adds polyfills for Firebase and other libraries
 */

// Installs Metro's async chunk loader (global.__loadBundleAsync). Without it,
// every `await import(...)` in a web export falls through to a synchronous
// require of a module that lives in a split chunk and throws
// `Requiring unknown module "<id>"` — which is how voice mode on the web
// app read "Voice mode is offline" for the OpenAI/ElevenLabs half of the
// provider A/B from 28 Aug to 13 Sep 2026. expo-router imports this for
// you; a custom entry has to do it itself. Must come before anything that
// can lazy-load.
import '@expo/metro-runtime';

// Polyfill for URL API (required by Firebase on React Native)
import 'react-native-url-polyfill/auto';

import { registerRootComponent } from 'expo';
import App from './App';

// Register the app
registerRootComponent(App);
