/**
 * Root Navigator
 * Main navigation structure with bottom tabs
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Animated, StyleSheet, View, Text, TouchableOpacity, LayoutChangeEvent, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DashboardScreen } from '../screens/DashboardScreen';
import { JobsListScreen } from '../screens/JobsListScreen';
import { AssistantScreen } from '../screens/AssistantScreen';
import { isDemoCaptureActive } from '../demo/demoPlayback';
import { ViewJobScreen } from '../screens/ViewJobScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { PaywallScreen } from '../screens/PaywallScreen';
import { RecordPaymentScreen } from '../screens/RecordPaymentScreen';
import { InsightsScreen } from '../screens/InsightsScreen';

// Settings sub-screens
import { BusinessProfileScreen } from '../screens/settings/BusinessProfileScreen';
import { BusinessDefaultsScreen } from '../screens/settings/BusinessDefaultsScreen';
import { PaymentMethodsScreen } from '../screens/settings/PaymentMethodsScreen';
import { TradePricingScreen } from '../screens/settings/TradePricingScreen';
import { SubscriptionSettingsScreen } from '../screens/settings/SubscriptionSettingsScreen';
import { AccountSettingsScreen } from '../screens/settings/AccountSettingsScreen';
import { AboutScreen } from '../screens/settings/AboutScreen';
import { FeedbackScreen } from '../screens/settings/FeedbackScreen';
import { PDFTemplateScreen } from '../screens/settings/PDFTemplateScreen';
import { ReferralScreen } from '../screens/settings/ReferralScreen';
import { NotificationPreferencesScreen } from '../screens/settings/NotificationPreferencesScreen';
import { AppearanceScreen } from '../screens/settings/AppearanceScreen';
import { XeroIntegrationScreen } from '../screens/settings/XeroIntegrationScreen';
import { SquareIntegrationScreen } from '../screens/settings/SquareIntegrationScreen';
import { ReeceIntegrationScreen } from '../screens/settings/ReeceIntegrationScreen';
import { GoogleCalendarIntegrationScreen } from '../screens/settings/GoogleCalendarIntegrationScreen';
import { CallKatieScreen } from '../screens/settings/CallKatieScreen';
import { SectionTemplatesScreen } from '../screens/settings/SectionTemplatesScreen';
import { JobTemplateEditorScreen } from '../screens/settings/JobTemplateEditorScreen';
import { EditSupplierScreen } from '../screens/settings/EditSupplierScreen';
import { ContactsScreen } from '../screens/ContactsScreen';
import { CustomerScreen } from '../screens/CustomerScreen';
import { DiscoverSuppliersScreen } from '../screens/DiscoverSuppliersScreen';

import { JobDetailsScreen } from '../screens/NewQuote/JobDetailsScreen';
import { CustomerDetailsScreen } from '../screens/NewQuote/CustomerDetailsScreen';
import { MaterialsListScreen } from '../screens/NewQuote/MaterialsListScreen';
import { AddMaterialScreen } from '../screens/NewQuote/AddMaterialScreen';
import { LaborMarkupScreen } from '../screens/NewQuote/LaborMarkupScreen';
import { JobPreviewScreen } from '../screens/NewQuote/JobPreviewScreen';
import { ReeceOrderScreen } from '../screens/ReeceOrderScreen';
import { ServiceReportScreen } from '../screens/ServiceReport/ServiceReportScreen';

import { makeStyles, useThemeColors } from '../theme';

// Type definitions for navigation
export type RootTabParamList = {
  Dashboard: undefined;
  Jobs: undefined;
  Mate: undefined;
  Settings: undefined;
};

export type NewQuoteStackParamList = {
  Details: { mode?: 'quote' | 'invoice' } | undefined;
  CustomerDetails: { mode?: 'quote' | 'invoice' } | undefined;
  MaterialsList: { mode?: 'quote' | 'invoice'; autoGenerate?: boolean; autoFetchPrices?: boolean } | undefined;
  AddMaterial: { materialId?: string; mode?: 'quote' | 'invoice' } | undefined;
  LaborMarkup: { mode?: 'quote' | 'invoice' } | undefined;
  JobPreview: { mode?: 'quote' | 'invoice'; viewing?: boolean; editing?: boolean } | undefined;
};

// Param types for full-screen routes on the RootStack. The navigator itself is
// left untyped (it hosts many screens); this is the shared source of truth for
// callers navigating into these routes. The Wiring phase reads ServiceReport
// from here to type its navigation.navigate(...) call.
export type RootStackParamList = {
  ServiceReport: { jobId: string; reportId?: string };
};

const Tab = createBottomTabNavigator<RootTabParamList>();
const NewQuoteStack = createStackNavigator<NewQuoteStackParamList>();
const RootStack = createStackNavigator();

/**
 * New Quote Flow - Stack Navigator
 */
function NewQuoteNavigator() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <NewQuoteStack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: themeColors.surface,
          elevation: 0,
          shadowOpacity: 0,
        },
        headerBackground: () => (
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: themeColors.surface,
              },
            ]}
          />
        ),
        headerTintColor: themeColors.text,
        headerTitleStyle: { fontFamily: 'Archivo-Bold' },
        cardStyle: { backgroundColor: themeColors.bg },
        ...(Platform.OS === 'web' && {
          headerMode: 'float' as any,
          contentStyle: { flex: 1, backgroundColor: themeColors.bg },
        })
      }}
    >
      <NewQuoteStack.Screen
        name="Details"
        component={JobDetailsScreen}
        options={{ title: 'New Job - Details' }}
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
        options={{ title: 'Pricing' }}
      />
      <NewQuoteStack.Screen
        name="JobPreview"
        component={JobPreviewScreen}
        options={{ title: 'Job Preview' }}
      />
    </NewQuoteStack.Navigator>
  );
}

/**
 * New Invoice Flow - Stack Navigator (reuses same screens as NewQuote)
 */
function NewInvoiceNavigator() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <NewQuoteStack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: themeColors.surface,
          elevation: 0,
          shadowOpacity: 0,
        },
        headerBackground: () => (
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: themeColors.surface,
              },
            ]}
          />
        ),
        headerTintColor: themeColors.text,
        headerTitleStyle: { fontFamily: 'Archivo-Bold' },
        cardStyle: { backgroundColor: themeColors.bg },
        ...(Platform.OS === 'web' && {
          headerMode: 'float' as any,
          contentStyle: { flex: 1, backgroundColor: themeColors.bg },
        })
      }}
    >
      <NewQuoteStack.Screen
        name="Details"
        component={JobDetailsScreen}
        options={{ title: 'New Job - Details' }}
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
        options={{ title: 'Pricing' }}
        initialParams={{ mode: 'invoice' }}
      />
      <NewQuoteStack.Screen
        name="JobPreview"
        component={JobPreviewScreen}
        options={{ title: 'Job Preview' }}
        initialParams={{ mode: 'invoice' }}
      />
    </NewQuoteStack.Navigator>
  );
}

const TAB_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  Dashboard: 'home',
  Jobs: 'briefcase',
  Mate: 'chat-processing',
  Settings: 'cog',
};

const PILL_WIDTH = 56;
const PILL_HEIGHT = 32;

/** Custom tab bar with liquid-morphing pill indicator */
function LiquidTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const tabCount = state.routes.length;

  // Track tab center X positions
  const [tabCenters, setTabCenters] = useState<number[]>([]);
  const tabWidths = useRef<{ x: number; width: number }[]>(new Array(tabCount).fill({ x: 0, width: 0 }));
  const layoutCount = useRef(0);

  // Animated values for the pill
  const pillX = useRef(new Animated.Value(0)).current;
  const pillScaleX = useRef(new Animated.Value(1)).current;
  const pillScaleY = useRef(new Animated.Value(1)).current;

  // Animated values for icon bounce per tab
  const iconScales = useRef(state.routes.map(() => new Animated.Value(1))).current;

  const onTabLayout = useCallback((index: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    tabWidths.current[index] = { x, width };
    layoutCount.current++;
    if (layoutCount.current >= tabCount) {
      const centers = tabWidths.current.map(t => t.x + t.width / 2);
      setTabCenters(centers);
      // Set initial position without animation
      pillX.setValue(centers[state.index] - PILL_WIDTH / 2);
    }
  }, [tabCount, state.index]);

  // Animate pill to active tab
  useEffect(() => {
    if (tabCenters.length === 0) return;
    const targetX = tabCenters[state.index] - PILL_WIDTH / 2;

    // Liquid morph: stretch wide, slide, then squish back
    Animated.parallel([
      // Horizontal stretch out
      Animated.sequence([
        Animated.timing(pillScaleX, {
          toValue: 1.4,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.spring(pillScaleX, {
          toValue: 1,
          friction: 6,
          tension: 120,
          useNativeDriver: true,
        }),
      ]),
      // Vertical squish during stretch
      Animated.sequence([
        Animated.timing(pillScaleY, {
          toValue: 0.75,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.spring(pillScaleY, {
          toValue: 1,
          friction: 6,
          tension: 120,
          useNativeDriver: true,
        }),
      ]),
      // Slide to target
      Animated.spring(pillX, {
        toValue: targetX,
        friction: 7,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();

    // Bounce the active icon
    iconScales.forEach((scale, i) => {
      if (i === state.index) {
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.25, duration: 120, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, friction: 4, tension: 100, useNativeDriver: true }),
        ]).start();
      } else {
        Animated.timing(scale, { toValue: 1, duration: 100, useNativeDriver: true }).start();
      }
    });
  }, [state.index, tabCenters]);

  return (
    <View style={[styles.tabBarOuter, { paddingBottom: insets.bottom + 8 }]}>
      <LinearGradient
        colors={[themeColors.surface, themeColors.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[StyleSheet.absoluteFill, { borderTopWidth: 1, borderTopColor: themeColors.border }]}
      />

      {/* Liquid pill indicator */}
      {tabCenters.length > 0 && (
        <Animated.View
          style={[
            styles.liquidPill,
            {
              transform: [
                { translateX: pillX },
                { scaleX: pillScaleX },
                { scaleY: pillScaleY },
              ],
            },
          ]}
        />
      )}

      {/* Tab buttons */}
      <View style={styles.tabRow}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const label = options.title ?? route.name;
          const iconName = TAB_ICONS[route.name] || 'help-circle';
          const tintColor = isFocused ? themeColors.accent : themeColors.textDisabled;

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) {
              if (Platform.OS !== 'web') {
                Haptics.selectionAsync();
              }
              navigation.navigate(route.name);
            }
          };

          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              onPress={onPress}
              onLongPress={onLongPress}
              onLayout={onTabLayout(index)}
              style={styles.tabButton}
              activeOpacity={0.7}
            >
              <Animated.View style={{ transform: [{ scale: iconScales[index] }] }}>
                <MaterialCommunityIcons name={iconName} size={26} color={tintColor} />
                {route.name === 'Mate' && (
                  <View style={styles.betaBadge}>
                    <Text style={styles.betaBadgeText}>BETA</Text>
                  </View>
                )}
              </Animated.View>
              <Animated.Text
                style={[
                  styles.tabLabel,
                  { color: tintColor, fontWeight: isFocused ? '600' : '400' },
                ]}
                numberOfLines={1}
              >
                {label}
              </Animated.Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Main Tabs Navigator
 */
function MainTabs() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  // Capture-only — gated on the injected demo payload (never trips in
  // production). See src/demo/demoPlayback.ts → isDemoCaptureActive.
  const demoCapture = isDemoCaptureActive();

  return (
    <Tab.Navigator
      // Capture builds land straight on the Mate tab so the demo harness can
      // record the chat without other tabs (and their user-data deps) mounting.
      initialRouteName={demoCapture ? 'Mate' : undefined}
      tabBar={(props) => <LiquidTabBar {...props} />}
      screenOptions={{
        headerBackground: () => (
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: themeColors.surface,
              },
            ]}
          />
        ),
        headerTintColor: themeColors.text,
        headerTitleStyle: { fontFamily: 'Archivo-Bold' },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ title: 'QuoteMate' }}
      />
      <Tab.Screen
        name="Mate"
        component={AssistantScreen}
        options={{ title: 'Mate' }}
      />
      <Tab.Screen
        name="Jobs"
        component={JobsListScreen}
        options={{ title: 'Jobs' }}
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
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <RootStack.Navigator
      screenOptions={{
        headerShown: false,
        // Every screen pushed from the tabs was labelling its back button
        // "Main" — the tab navigator's internal route name, which means nothing
        // to a tradie. Show the chevron on its own instead. Applies to Contacts,
        // About, Customer, DiscoverSuppliers and anything added later.
        headerBackButtonDisplayMode: 'minimal',
        cardStyle: { backgroundColor: themeColors.bg },
        // On web, use float header mode so CardContent uses flex:1 instead of
        // minHeight:100% (pageOverflowEnabled=false), allowing ScrollViews to scroll
        ...(Platform.OS === 'web' && {
          headerMode: 'float' as any,
          contentStyle: { flex: 1, backgroundColor: themeColors.bg },
        }),
        // Keep previous screen mounted during transitions to prevent remount glitches
        detachPreviousScreen: false,
        // Disable safe area for iOS to allow full height cards
        ...(Platform.OS === 'ios' && {
          safeAreaInsets: { top: 0, bottom: 0 },
          contentStyle: { flex: 1, backgroundColor: themeColors.bg },
        })
      }}
    >
      <RootStack.Screen name="Main" component={MainTabs} />
      <RootStack.Screen
        name="ViewJob"
        component={ViewJobScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Job',
        }}
      />
      <RootStack.Screen
        name="ServiceReport"
        component={ServiceReportScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Service Report',
        }}
      />
      <RootStack.Screen
        name="RecordPayment"
        component={RecordPaymentScreen}
        options={{
          presentation: 'modal',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Record Payment',
        }}
      />
      <RootStack.Screen
        name="ReeceOrder"
        component={ReeceOrderScreen}
        options={{
          presentation: 'modal',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Order from Reece',
        }}
      />
      <RootStack.Screen
        name="Insights"
        component={InsightsScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Insights',
        }}
      />
      <RootStack.Screen
        name="NewJob"
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
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
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
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Business Details',
        }}
      />
      <RootStack.Screen
        name="BusinessDefaults"
        component={BusinessDefaultsScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Business Defaults',
        }}
      />
<RootStack.Screen
        name="PaymentMethods"
        component={PaymentMethodsScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Payment Methods',
        }}
      />
      <RootStack.Screen
        name="TradePricing"
        component={TradePricingScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Trade & Pricing',
        }}
      />
      <RootStack.Screen
        name="SubscriptionSettings"
        component={SubscriptionSettingsScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Subscription',
        }}
      />
      <RootStack.Screen
        name="AccountSettings"
        component={AccountSettingsScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Account',
        }}
      />
      <RootStack.Screen
        name="PDFTemplate"
        component={PDFTemplateScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'PDF Templates',
        }}
      />
      <RootStack.Screen
        name="SectionTemplates"
        component={SectionTemplatesScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Job Templates',
        }}
      />
      <RootStack.Screen
        name="JobTemplateEditor"
        component={JobTemplateEditorScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Job Template',
        }}
      />
      <RootStack.Screen
        name="AddMaterialStandalone"
        component={AddMaterialScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Add Material',
        }}
      />
      <RootStack.Screen
        name="EditSupplier"
        component={EditSupplierScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Edit Supplier',
        }}
      />
      <RootStack.Screen
        name="Referral"
        component={ReferralScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Refer a Friend',
        }}
      />
      <RootStack.Screen
        name="Appearance"
        component={AppearanceScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Appearance',
        }}
      />
      <RootStack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Notifications',
        }}
      />
      <RootStack.Screen
        name="XeroIntegration"
        component={XeroIntegrationScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Xero Integration',
        }}
      />
      <RootStack.Screen
        name="SquareIntegration"
        component={SquareIntegrationScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Square Payments',
        }}
      />
      <RootStack.Screen
        name="ReeceIntegration"
        component={ReeceIntegrationScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Reece Plumbing',
        }}
      />
      <RootStack.Screen
        name="GoogleCalendarIntegration"
        component={GoogleCalendarIntegrationScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Google Calendar',
        }}
      />
      <RootStack.Screen
        name="CallKatie"
        component={CallKatieScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Never Miss a Call',
        }}
      />
      <RootStack.Screen
        name="Feedback"
        component={FeedbackScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Feedback',
        }}
      />
      <RootStack.Screen
        name="About"
        component={AboutScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'About',
        }}
      />
      <RootStack.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Contacts',
        }}
      />
      {/* One customer's whole story — reached from the jobs search, from the
          repeat marker on a job card, and from the Contacts list. The screen
          retitles itself with the customer's name once the group resolves. */}
      <RootStack.Screen
        name="Customer"
        component={CustomerScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Customer',
        }}
      />
      <RootStack.Screen
        name="DiscoverSuppliers"
        component={DiscoverSuppliersScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: {
            backgroundColor: themeColors.surface,
          },
          headerTintColor: themeColors.text,
          headerTitleStyle: { fontFamily: 'Archivo-Bold' },
          title: 'Supplier Partners',
        }}
      />
    </RootStack.Navigator>
  );
}

const useStyles = makeStyles((t) => ({
  tabBarOuter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 8,
    overflow: 'hidden',
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tabLabel: {
    fontSize: 11,
    marginTop: 3,
  },
  betaBadge: {
    position: 'absolute',
    top: -7,
    right: -20,
    backgroundColor: t.colors.accent,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  betaBadgeText: {
    fontSize: 7,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: t.colors.onAccent,
  },
  liquidPill: {
    position: 'absolute',
    top: 10,
    left: 0,
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    backgroundColor: t.colors.accentSubtle,
  },
}));
