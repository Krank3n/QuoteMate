/**
 * Settings Screen
 * Main settings menu with navigation to sub-screens
 */

import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import {
  Text,
  Surface,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import { LIGHT_MODE_ENABLED, makeStyles, useThemeColors } from '../theme';
import { WebContainer } from '../components/WebContainer';
import { GridBackground } from '../components/GridBackground';

interface SettingsMenuItem {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  screen: string;
  screenParams?: Record<string, any>;
  badge?: string;
  badgeColor?: string;
}

interface SettingsSection {
  title: string;
  items: SettingsMenuItem[];
}

export function SettingsScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const subscriptionStatus = useStore((s) => s.subscriptionStatus);
  // Only approved affiliates actually earn commission. Promising "rewards" to
  // everyone was both untrue (a code grants nothing) and an unreviewed
  // income-opportunity claim on a store listing surface.
  const isAffiliate = useStore((s) => s.referralInfo?.isAffiliate === true);

  const sections: SettingsSection[] = [
    {
      title: 'Business',
      items: [
        {
          id: 'business',
          title: 'Business Details',
          subtitle: 'Name, logo, contact details',
          icon: 'domain',
          screen: 'BusinessProfile',
        },
        {
          id: 'businessDefaults',
          title: 'Business Defaults',
          subtitle: 'Rates, deposits, card fees, terms',
          icon: 'tune',
          screen: 'BusinessDefaults',
        },
{
          id: 'payment',
          title: 'Payment Methods',
          subtitle: 'Bank, PayID, BPAY, PayPal',
          icon: 'credit-card',
          screen: 'PaymentMethods',
        },
        {
          id: 'trade',
          title: 'Trade & Pricing',
          subtitle: 'Categories, niches, hardware store',
          icon: 'store',
          screen: 'TradePricing',
        },
      ],
    },
    {
      title: 'Integrations',
      items: [
        {
          id: 'xero',
          title: 'Xero Accounting',
          subtitle: 'Sync invoices and payments',
          icon: 'cloud-sync',
          screen: 'XeroIntegration',
        },
        {
          id: 'square',
          title: 'Square Payments',
          subtitle: 'Take payment on site or share a pay link',
          icon: 'credit-card-scan',
          screen: 'SquareIntegration',
          badge: 'NEW',
          badgeColor: themeColors.accent,
        },
        {
          id: 'reece',
          title: 'Reece Plumbing',
          subtitle: 'Pull your real Reece trade prices into every quote',
          icon: 'pipe',
          screen: 'ReeceIntegration',
          badge: 'NEW',
          badgeColor: themeColors.accent,
        },
        {
          id: 'googleCalendar',
          title: 'Google Calendar',
          subtitle: 'Push scheduled jobs to your calendar',
          icon: 'calendar-sync',
          screen: 'GoogleCalendarIntegration',
          badge: 'NEW',
          badgeColor: themeColors.accent,
        },
        {
          id: 'callKatie',
          title: 'Never Miss a Call',
          subtitle: 'Katie answers the calls you can’t get to',
          icon: 'phone-in-talk',
          screen: 'CallKatie',
          badge: 'NEW',
          badgeColor: themeColors.accent,
        },
      ],
    },
    {
      title: 'Documents',
      items: [
        {
          id: 'pdfTemplate',
          title: 'PDF Templates',
          subtitle: 'Choose your document style',
          icon: 'file-document-outline',
          screen: 'PDFTemplate',
        },
        {
          id: 'sectionTemplates',
          title: 'Job Templates',
          subtitle: 'Reusable material + labour bundles',
          icon: 'puzzle-outline',
          screen: 'SectionTemplates',
        },
        {
          id: 'supplierBook',
          title: 'Supplier Book',
          subtitle: 'Saved supplier prices grouped by store',
          icon: 'format-list-bulleted',
          screen: 'AddMaterialStandalone',
          screenParams: { supplierBookOnly: true },
        },
      ],
    },
    {
      title: 'Data',
      items: [
        {
          id: 'contacts',
          title: 'Contacts',
          subtitle: 'Keep track of your regulars',
          icon: 'account-group',
          screen: 'Contacts',
        },
      ],
    },
    {
      title: 'Notifications',
      items: [
        {
          id: 'notifications',
          title: 'Push Notifications',
          subtitle: 'Manage Aussie notification preferences',
          icon: 'bell-outline',
          screen: 'NotificationPreferences',
        },
      ],
    },
    {
      title: 'App',
      items: [
        // Hidden until the screens have migrated off the static palette —
        // offering a light mode that only half the app honours is worse than
        // not offering one. See src/theme/config.ts.
        ...(LIGHT_MODE_ENABLED
          ? [
              {
                id: 'appearance',
                title: 'Appearance',
                subtitle: 'Light, dark, or match your phone',
                icon: 'theme-light-dark',
                screen: 'Appearance',
              } as SettingsMenuItem,
            ]
          : []),
        {
          id: 'referral',
          title: isAffiliate ? 'Affiliate Program' : 'Refer a Mate',
          subtitle: isAffiliate
            ? 'Your code, earnings and payouts'
            : 'Share QuoteMate with other tradies',
          icon: 'gift',
          screen: 'Referral',
          ...(isAffiliate ? { badge: 'EARN', badgeColor: themeColors.money } : {}),
        },
        {
          id: 'subscription',
          title: 'Subscription',
          subtitle: subscriptionStatus?.isPro ? 'Pro Member' : 'Free Plan',
          icon: 'crown',
          screen: 'SubscriptionSettings',
          badge: subscriptionStatus?.isPro ? 'PRO' : undefined,
          badgeColor: themeColors.warning,
        },
        {
          id: 'account',
          title: 'Account',
          subtitle: 'Email preferences, sign out, delete',
          icon: 'account',
          screen: 'AccountSettings',
        },
        {
          id: 'feedback',
          title: 'Feedback',
          subtitle: 'Tell us what to fix or change',
          icon: 'bullhorn',
          screen: 'Feedback',
          badge: 'NEW',
          badgeColor: themeColors.error,
        },
        {
          id: 'about',
          title: 'About',
          subtitle: 'Version info, support',
          icon: 'information',
          screen: 'About',
        },
      ],
    },
  ];

  const handleMenuPress = async (screen: string, params?: Record<string, any>) => {
    if (params) {
      (navigation as any).navigate(screen, params);
    } else {
      navigation.navigate(screen);
    }
  };

  return (
    <View style={styles.container}>
      <GridBackground />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          {sections.map((section) => (
            <View key={section.title} style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Surface style={styles.card}>
                {section.items.map((item, index) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.menuItem,
                      index < section.items.length - 1 && styles.menuItemBorder,
                    ]}
                    onPress={() => handleMenuPress(item.screen, item.screenParams)}
                  >
                    <View style={styles.menuItemLeft}>
                      <View style={styles.iconContainer}>
                        <MaterialCommunityIcons
                          name={item.icon as any}
                          size={24}
                          color={themeColors.accentText}
                        />
                      </View>
                      <View style={styles.menuItemText}>
                        <View style={styles.titleRow}>
                          <Text style={styles.menuItemTitle}>{item.title}</Text>
                          {item.badge && (
                            <View style={[styles.badge, { backgroundColor: item.badgeColor }]}>
                              <Text style={styles.badgeText}>{item.badge}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.menuItemSubtitle}>{item.subtitle}</Text>
                      </View>
                    </View>
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={24}
                      color={themeColors.textSecondary}
                    />
                  </TouchableOpacity>
                ))}
              </Surface>
            </View>
          ))}
        </WebContainer>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
    ...(Platform.OS === 'web' && {
      maxWidth: 600,
      margin: 'auto' as any,
      width: '100%',
    }),
  },
  sectionContainer: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    borderRadius: 12,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  menuItemText: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.text,
    marginBottom: 2,
  },
  menuItemSubtitle: {
    fontSize: 13,
    color: t.colors.textSecondary,
  },
  badge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: t.colors.surfaceRaised,
  },
}));
