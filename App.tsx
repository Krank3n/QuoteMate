/**
 * QuoteMate - Main App Entry Point
 * A quoting tool for Australian tradies with Bunnings API integration
 */

import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { Provider as PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useStore } from './src/store/useStore';
import { theme } from './src/theme';
import { RootNavigator } from './src/navigation/RootNavigator';
import { OnboardingScreen } from './src/screens/OnboardingScreen';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const { isOnboarded, checkOnboarding, loadQuotes, loadBusinessSettings, loadSubscription } = useStore();

  useEffect(() => {
    async function initialize() {
      try {
        // Load saved data
        await Promise.all([
          checkOnboarding(),
          loadQuotes(),
          loadBusinessSettings(),
          loadSubscription(),
        ]);
      } catch (error) {
        console.error('Error initializing app:', error);
      } finally {
        setIsLoading(false);
      }
    }

    initialize();
  }, []);

  if (isLoading) {
    // Could add a splash screen here
    return null;
  }

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <NavigationContainer>
          <StatusBar style="light" />
          {isOnboarded ? <RootNavigator /> : <OnboardingScreen />}
        </NavigationContainer>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
