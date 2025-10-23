/**
 * QuoteMate Entry Point
 * Adds polyfills for Firebase and other libraries
 */

// Polyfill for URL API (required by Firebase on React Native)
import 'react-native-url-polyfill/auto';

import { registerRootComponent } from 'expo';
import App from './App';

// Register the app
registerRootComponent(App);
