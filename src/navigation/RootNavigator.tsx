/**
 * Root Navigator
 * Main navigation structure with bottom tabs
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Animated, StyleSheet, View, TouchableOpacity, LayoutChangeEvent, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DashboardScreen } from '../screens/DashboardScreen';
import { QuotesListScreen } from '../screens/QuotesListScreen';
import { InvoicesListScreen } from '../screens/InvoicesListScreen';
import { DocumentsListScreen } from '../screens/DocumentsListScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { PaywallScreen } from '../screens/PaywallScreen';
import { ViewQuoteScreen } from '../screens/ViewQuoteScreen';
import { ViewInvoiceScreen } from '../screens/ViewInvoiceScreen';
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
import { XeroIntegrationScreen } from '../screens/settings/XeroIntegrationScreen';
import { SquareIntegrationScreen } from '../screens/settings/SquareIntegrationScreen';
import { SectionTemplatesScreen } from '../screens/settings/SectionTemplatesScreen';
import { JobTemplateEditorScreen } from '../screens/settings/JobTemplateEditorScreen';
import { EditSupplierScreen } from '../screens/settings/EditSupplierScreen';
import { ContactsScreen } from '../screens/ContactsScreen';
import { DiscoverSuppliersScreen } from '../screens/DiscoverSuppliersScreen';

import { JobDetailsScreen } from '../screens/NewQuote/JobDetailsScreen';
import { CustomerDetailsScreen } from '../screens/NewQuote/CustomerDetailsScreen';
import { MaterialsListScreen } from '../screens/NewQuote/MaterialsListScreen';
import { AddMaterialScreen } from '../screens/NewQuote/AddMaterialScreen';
import { LaborMarkupScreen } from '../screens/NewQuote/LaborMarkupScreen';
import { QuotePreviewScreen } from '../screens/NewQuote/QuotePreviewScreen';
import { InvoicePreviewScreen } from '../screens/NewQuote/InvoicePreviewScreen';

import { colors } from '../theme';
import { TourRefsProvider } from '../components/tour/useTourRefs';
import { UnifiedTourController } from '../components/tour/UnifiedTourController';
import { useStore } from '../store/useStore';

// Type definitions for navigation
export type RootTabParamList = {
  Dashboard: undefined;
  Documents: undefined;
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
          elevation: 0,
          shadowOpacity: 0,
        },
        headerBackground: () => (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary }]} />
        ),
        headerTintColor: colors.white,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
        cardStyle: { backgroundColor: colors.background },
        ...(Platform.OS === 'web' && {
          headerMode: 'float' as any,
          contentStyle: { flex: 1, backgroundColor: colors.background },
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
        options={{ title: 'Pricing' }}
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
          elevation: 0,
          shadowOpacity: 0,
        },
        headerBackground: () => (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary }]} />
        ),
        headerTintColor: colors.white,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
        cardStyle: { backgroundColor: colors.background },
        ...(Platform.OS === 'web' && {
          headerMode: 'float' as any,
          contentStyle: { flex: 1, backgroundColor: colors.background },
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
        options={{ title: 'Pricing' }}
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

const TAB_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  Dashboard: 'home',
  Documents: 'file-multiple',
  Quotes: 'file-document-multiple',
  Invoices: 'receipt',
  Settings: 'cog',
};

const PILL_WIDTH = 56;
const PILL_HEIGHT = 32;

/** Custom tab bar with liquid-morphing pill indicator */
function LiquidTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
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
        colors={[colors.surface, '#1a2d42']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[StyleSheet.absoluteFill, { borderTopWidth: 1, borderTopColor: colors.border }]}
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
          const tintColor = isFocused ? colors.primary : colors.inactive;

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
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      tabBar={(props) => <LiquidTabBar {...props} />}
      screenOptions={{
        headerBackground: () => (
          <LinearGradient
            colors={['#00785a', colors.primary, '#00b07a']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        ),
        headerTintColor: colors.white,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ title: 'QuoteMate' }}
      />
      <Tab.Screen
        name="Documents"
        component={DocumentsListScreen}
        options={{ title: 'Documents' }}
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
function TourTouchBlocker() {
  const { unifiedTourActive } = useStore();
  if (!unifiedTourActive) return null;
  // Global touch blocker that sits above the entire navigator stack.
  // Prevents tapping through to screens underneath during tour step transitions.
  // The tour tooltip and modals render via Portal/native Modal which sit above this.
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent', zIndex: 9990 }]}
      pointerEvents="auto"
      onStartShouldSetResponder={() => true}
      onStartShouldSetResponderCapture={() => true}
      onMoveShouldSetResponder={() => true}
      onMoveShouldSetResponderCapture={() => true}
      onResponderRelease={() => {}}
    />
  );
}

export function RootNavigator() {
  return (
    <TourRefsProvider>
    <RootStack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: colors.background },
        // On web, use float header mode so CardContent uses flex:1 instead of
        // minHeight:100% (pageOverflowEnabled=false), allowing ScrollViews to scroll
        ...(Platform.OS === 'web' && {
          headerMode: 'float' as any,
          contentStyle: { flex: 1, backgroundColor: colors.background },
        }),
        // Keep previous screen mounted during transitions to prevent remount glitches
        detachPreviousScreen: false,
        // Disable safe area for iOS to allow full height cards
        ...(Platform.OS === 'ios' && {
          safeAreaInsets: { top: 0, bottom: 0 },
          contentStyle: { flex: 1, backgroundColor: colors.background },
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
        name="Insights"
        component={InsightsScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Insights',
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
          title: 'Business Details',
        }}
      />
      <RootStack.Screen
        name="BusinessDefaults"
        component={BusinessDefaultsScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Business Defaults',
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
        name="PDFTemplate"
        component={PDFTemplateScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'PDF Templates',
        }}
      />
      <RootStack.Screen
        name="SectionTemplates"
        component={SectionTemplatesScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Job Templates',
        }}
      />
      <RootStack.Screen
        name="JobTemplateEditor"
        component={JobTemplateEditorScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Job Template',
        }}
      />
      <RootStack.Screen
        name="AddMaterialStandalone"
        component={AddMaterialScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Add Material',
        }}
      />
      <RootStack.Screen
        name="EditSupplier"
        component={EditSupplierScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Edit Supplier',
        }}
      />
      <RootStack.Screen
        name="Referral"
        component={ReferralScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Refer a Friend',
        }}
      />
      <RootStack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Notifications',
        }}
      />
      <RootStack.Screen
        name="XeroIntegration"
        component={XeroIntegrationScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Xero Integration',
        }}
      />
      <RootStack.Screen
        name="SquareIntegration"
        component={SquareIntegrationScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Square Payments',
        }}
      />
      <RootStack.Screen
        name="Feedback"
        component={FeedbackScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Feedback',
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
      <RootStack.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Contacts',
        }}
      />
      <RootStack.Screen
        name="DiscoverSuppliers"
        component={DiscoverSuppliersScreen}
        options={{
          presentation: 'card',
          headerShown: true,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.white,
          title: 'Supplier Partners',
        }}
      />
    </RootStack.Navigator>
    <TourTouchBlocker />
    <UnifiedTourController />
    </TourRefsProvider>
  );
}

const styles = StyleSheet.create({
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
  liquidPill: {
    position: 'absolute',
    top: 10,
    left: 0,
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    backgroundColor: 'rgba(0, 152, 104, 0.18)',
  },
});
