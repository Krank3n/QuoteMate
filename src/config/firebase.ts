import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import Constants from 'expo-constants';

// Firebase configuration from environment variables
// Note: Firebase API keys are safe to be public - they identify your project,
// security is handled by Firebase Security Rules
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || Constants.expoConfig?.extra?.firebaseApiKey || 'AIzaSyBACasUs7AwAQt_5VcfnEjBRan7AvAM5lw',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || Constants.expoConfig?.extra?.firebaseAuthDomain || 'hansendev.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID || Constants.expoConfig?.extra?.firebaseProjectId || 'hansendev',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || Constants.expoConfig?.extra?.firebaseStorageBucket || 'hansendev.appspot.com',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || Constants.expoConfig?.extra?.firebaseMessagingSenderId || '652758863537',
  appId: process.env.FIREBASE_APP_ID || Constants.expoConfig?.extra?.firebaseAppId || '1:652758863537:web:YOUR_APP_ID',
};

// Initialize Firebase only if it hasn't been initialized already
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firebase services
export const auth = getAuth(app);

// Set persistence to local by default (allows auth to persist across sessions)
// This will be explicitly cleared during logout
if (typeof window !== 'undefined') {
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.error('Failed to set auth persistence:', error);
  });
}

export const db = getFirestore(app);

export default app;
