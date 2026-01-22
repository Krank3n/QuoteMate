/**
 * Root Navigator
 * Main navigation structure with bottom tabs
 */

import React from 'react';
import { Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DashboardScreen } from '../screens/DashboardScreen';
import { QuotesListScreen } from '../screens/QuotesListScreen';
import { InvoicesListScreen } from '../screens/InvoicesListScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { PaywallScreen } from '../screens/PaywallScreen';
import { ViewQuoteScreen } from '../screens/ViewQuoteScreen';
import { ViewInvoiceScreen } from '../screens/ViewInvoiceScreen';
import { RecordPaymentScreen } from '../screens/RecordPaymentScreen';

// Settings sub-screens
import { BusinessProfileScreen } from '../screens/settings/BusinessProfileScreen';
import { QuoteSettingsScreen } from '../screens/settings/QuoteSettingsScreen';
import { PaymentMethodsScreen } from '../screens/settings/PaymentMethodsScreen';
import { TradePricingScreen } from '../screens/settings/TradePricingScreen';
import { SubscriptionSettingsScreen } from '../screens/settings/SubscriptionSettingsScreen';
import { AccountSettingsScreen } from '../screens/settings/AccountSettingsScreen';
import { AboutScreen } from '../screens/settings/AboutScreen';

import { JobDetailsScreen } from '../screens/NewQuote/JobDetailsScreen';
import { CustomerDetailsScreen } from '../screens/NewQuote/CustomerDetailsScreen';
import { MaterialsListScreen } from '../screens/NewQuote/MaterialsListScreen';
import { AddMaterialScreen } from '../screens/NewQuote/AddMaterialScreen';
import { LaborMarkupScreen } from '../screens/NewQuote/LaborMarkupScreen';
import { QuotePreviewScreen } from '../screens/NewQuote/QuotePreviewScreen';
import { InvoicePreviewScreen } from '../screens/NewQuote/InvoicePreviewScreen';

import { colors } from '../theme';

// Type definitions for navigation
export type RootTabParamList = {
  Dashboard: undefined;
  Quotes: undefined;
  Invoices: undefined;
  Settings: undefined;
};

export type NewQuoteStackParamList = {
  JobDetails: { mode?: 'quote' | 'invoice' } | undefined;
  CustomerDetails: { mode?: 'quote' | 'invoice' } | undefined;
  MaterialsList: { mode?: 'quote' | 'invoice' } | undefined;
  AddMaterial: { materialId?: string; mode?: 'quote' | 'invoice' } | undefined;
  LaborMarkup: { mode?: 'quote' | 'invoice' } | undefined;
  QuotePreview: undefined;
  InvoicePreview: undefined;
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
        // Enable scrolling for new quote screens on web
        ...(Platform.OS === 'web' && {
          contentStyle: { overflow: 'auto' }
        })
      }}
    >
      <NewQuoteStack.Screen
        name="JobDetails"
        component={JobDetailsScreen}
        options={{ title: 'New Quote - Job Details' }}
      />
      <NewQuoteStack.Screen
        name="CustomerDetails"
        component={CustomerDetailsScreen}
        options={{ title: 'Customer Details' }}
      />
      <NewQuoteStack.Screen
        name="MaterialsList"
        component={MaterialsListScreen}
        options={{ title: 'Materials' }}
      />
      <NewQuoteStack.Screen
        name="AddMaterial"
        component={AddMaterialScreen}
        options={{ title: 'Add Material' }}
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
 * New Invoice Flow - Stack Navigator (reuses same screens as NewQuote)
 */
function NewInvoiceNavigator() {
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
        // Enable scrolling for new invoice screens on web
        ...(Platform.OS === 'web' && {
          contentStyle: { overflow: 'auto' }
        })
      }}
    >
      <NewQuoteStack.Screen
        name="JobDetails"
        component={JobDetailsScreen}
        options={{ title: 'New Invoice - Job Details' }}
        initialParams={{ mode: 'invoice' }}
      />
      <NewQuoteStack.Screen
        name="CustomerDetails"
        component={CustomerDetailsScreen}
        options={{ title: 'Customer Details' }}
        initialParams={{ mode: 'invoice' }}
      />
      <NewQuoteStack.Screen
        name="MaterialsList"
        component={MaterialsListScreen}
        options={{ title: 'Materials' }}
        initialParams={{ mode: 'invoice' }}
      />
      <NewQuoteStack.Screen
        name="AddMaterial"
        component={AddMaterialScreen}
        options={{ title: 'Add Material' }}
        initialParams={{ mode: 'invoice' }}
      />
      <NewQuoteStack.Screen
        name="LaborMarkup"
        component={LaborMarkupScreen}
        options={{ title: 'Labor & Markup' }}
        initialParams={{ mode: 'invoice' }}
      />
      <NewQuoteStack.Screen
        name="InvoicePreview"
        component={InvoicePreviewScreen}
        options={{ title: 'Invoice Preview' }}
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
          } else if (route.name === 'Invoices') {
            iconName = 'receipt';
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
          paddingTop: 10,
          paddingBottom: insets.bottom + 10,
          height: Platform.OS === 'android' ? 70 + insets.bottom : 'auto',
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
        name="Invoices"
        component={InvoicesListScreen}
        options={{ title: 'Invoices' }}
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
    <RootStack.Navigator
      screenOptions={{
        headerShown: false,
        // Enable scrolling for modals on web
        ...(Platform.OS === 'web' && {
          contentStyle: { overflow: 'auto' }
        }),
        // Disable safe area for iOS to allow full height cards
        ...(Platform.OS === 'ios' && {
          safeAreaInsets: { top: 0, bottom: 0 },
          detachPreviousScreen: false,
          contentStyle: { flex: 1 },
        })
      }}
    >
      <RootStack.Screen name="Main" component={MainTabs} />
      <RootStack.Screen
        name="ViewQuote"
        component={ViewQuoteScreen}
        options={{
          presentation: 'card',
          headerShown: false,
        }}
      />
      <RootStack.Screen
        name="ViewInvoice"
        component={ViewInvoiceScreen}
        options={{
          presentation: 'card',
          headerShown: false,
        }}
      />
      <RootStack.Screen
        name="RecordPayment"
        component={RecordPaymentScreen}
        options={{
          presentation: 'modal',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Record Payment',
        }}
      />
      <RootStack.Screen
        name="NewQuote"
        component={NewQuoteNavigator}
        options={{
          presentation: 'card',
        }}
      />
      <RootStack.Screen
        name="NewInvoice"
        component={NewInvoiceNavigator}
        options={{
          presentation: 'card',
        }}
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
          ...(Platform.OS === 'web' && {
            contentStyle: {
              overflow: 'auto',
              maxHeight: '90vh',
            }
          })
        }}
      />
      {/* Settings Sub-screens */}
      <RootStack.Screen
        name="BusinessProfile"
        component={BusinessProfileScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Business Profile',
        }}
      />
      <RootStack.Screen
        name="QuoteSettings"
        component={QuoteSettingsScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Quote Settings',
        }}
      />
      <RootStack.Screen
        name="PaymentMethods"
        component={PaymentMethodsScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Payment Methods',
        }}
      />
      <RootStack.Screen
        name="TradePricing"
        component={TradePricingScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Trade & Pricing',
        }}
      />
      <RootStack.Screen
        name="SubscriptionSettings"
        component={SubscriptionSettingsScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Subscription',
        }}
      />
      <RootStack.Screen
        name="AccountSettings"
        component={AccountSettingsScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Account',
        }}
      />
      <RootStack.Screen
        name="About"
        component={AboutScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'About',
        }}
      />
    </RootStack.Navigator>
  );
}
