/**
 * Root Navigator
 * Main navigation structure with bottom tabs
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DashboardScreen } from '../screens/DashboardScreen';
import { QuotesListScreen } from '../screens/QuotesListScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { PaywallScreen } from '../screens/PaywallScreen';

import { JobDetailsScreen } from '../screens/NewQuote/JobDetailsScreen';
import { MaterialsListScreen } from '../screens/NewQuote/MaterialsListScreen';
import { LaborMarkupScreen } from '../screens/NewQuote/LaborMarkupScreen';
import { QuotePreviewScreen } from '../screens/NewQuote/QuotePreviewScreen';

import { colors } from '../theme';

// Type definitions for navigation
export type RootTabParamList = {
  Dashboard: undefined;
  Quotes: undefined;
  Settings: undefined;
};

export type NewQuoteStackParamList = {
  JobDetails: undefined;
  MaterialsList: undefined;
  LaborMarkup: undefined;
  QuotePreview: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();
const NewQuoteStack = createStackNavigator<NewQuoteStackParamList>();
const RootStack = createStackNavigator();

/**
 * New Quote Flow - Stack Navigator
 */
function NewQuoteNavigator() {
  return (
    <NewQuoteStack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.primary,
        },
        headerTintColor: colors.white,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      <NewQuoteStack.Screen
        name="JobDetails"
        component={JobDetailsScreen}
        options={{ title: 'New Quote - Job Details' }}
      />
      <NewQuoteStack.Screen
        name="MaterialsList"
        component={MaterialsListScreen}
        options={{ title: 'Materials' }}
      />
      <NewQuoteStack.Screen
        name="LaborMarkup"
        component={LaborMarkupScreen}
        options={{ title: 'Labor & Markup' }}
      />
      <NewQuoteStack.Screen
        name="QuotePreview"
        component={QuotePreviewScreen}
        options={{ title: 'Quote Preview' }}
      />
    </NewQuoteStack.Navigator>
  );
}

/**
 * Main Tabs Navigator
 */
function MainTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof MaterialCommunityIcons.glyphMap = 'home';

          if (route.name === 'Dashboard') {
            iconName = 'home';
          } else if (route.name === 'Quotes') {
            iconName = 'file-document-multiple';
          } else if (route.name === 'Settings') {
            iconName = 'cog';
          }

          return <MaterialCommunityIcons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inactive,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingTop: 8,
          paddingBottom: insets.bottom + 16,
          height: 60 + insets.bottom,
        },
        headerStyle: {
          backgroundColor: colors.primary,
        },
        headerTintColor: colors.white,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ title: 'QuoteMate' }}
      />
      <Tab.Screen
        name="Quotes"
        component={QuotesListScreen}
        options={{ title: 'My Quotes' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
    </Tab.Navigator>
  );
}

/**
 * Root Navigator - Includes tabs and modal screens
 */
export function RootNavigator() {
  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      <RootStack.Screen name="Main" component={MainTabs} />
      <RootStack.Screen
        name="NewQuote"
        component={NewQuoteNavigator}
        options={{ presentation: 'modal' }}
      />
      <RootStack.Screen
        name="Paywall"
        component={PaywallScreen}
        options={{
          presentation: 'modal',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Upgrade to Pro',
        }}
      />
    </RootStack.Navigator>
  );
}
