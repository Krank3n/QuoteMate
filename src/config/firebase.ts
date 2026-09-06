import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence, initializeAuth } from 'firebase/auth';
// @ts-ignore – getReactNativePersistence exists at runtime via the react-native entry point
import { getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Firebase configuration from environment variables
// Note: Firebase API keys are safe to be public - they identify your project,
// security is handled by Firebase Security Rules
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || Constants.expoConfig?.extra?.firebaseApiKey || 'AIzaSyBACasUs7AwAQt_5VcfnEjBRan7AvAM5lw',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || Constants.expoConfig?.extra?.firebaseAuthDomain || 'hansendev.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID || Constants.expoConfig?.extra?.firebaseProjectId || 'hansendev',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || Constants.expoConfig?.extra?.firebaseStorageBucket || 'hansendev.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || Constants.expoConfig?.extra?.firebaseMessagingSenderId || '652758863537',
  appId: process.env.FIREBASE_APP_ID || Constants.expoConfig?.extra?.firebaseAppId || '1:652758863537:web:YOUR_APP_ID',
};

// Initialize Firebase only if it hasn't been initialized already
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firebase Auth with platform-specific persistence
export const auth = Platform.OS === 'web'
  ? getAuth(app)
  : initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage)
    });

// Set persistence for web
if (Platform.OS === 'web') {
  setPersistence(auth, browserLocalPersistence).catch((error) => {
  });
}

/**
 * Where the Firebase JS SDK parks the signed-in user.
 *
 * Read at launch to answer "should a session be restored?" BEFORE the SDK has
 * got round to saying so. Its RN persistence fires onAuthStateChanged with
 * `null` while this read is still in flight, and auth.currentUser is null then
 * too, so nothing the SDK exposes can tell that null apart from a real sign
 * out — which is what put the sign-in screen in front of signed-in tradies on
 * every Android cold start. This key is the ground truth: it exists if and
 * only if there is a persisted session. See App.tsx / isAuthKnown.
 *
 * Derived from the same config object the auth instance was built from, so the
 * two cannot drift. Format is the SDK's (`firebase:authUser:{apiKey}:{appName}`)
 * — if a future version changes it the read simply finds nothing, and the gate
 * degrades to not waiting, which is the old behaviour rather than a worse one.
 */
export const AUTH_PERSISTENCE_KEY = `firebase:authUser:${firebaseConfig.apiKey}:[DEFAULT]`;

export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

export default app;
