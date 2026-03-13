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
import { colors } from '../theme';
import { WebContainer } from '../components/WebContainer';

interface SettingsMenuItem {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  screen: string;
  badge?: string;
  badgeColor?: string;
}

interface SettingsSection {
  title: string;
  items: SettingsMenuItem[];
}

export function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { subscriptionStatus } = useStore();

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
      title: 'Documents',
      items: [
        {
          id: 'pdfTemplate',
          title: 'PDF Templates',
          subtitle: 'Choose your document style',
          icon: 'file-document-outline',
          screen: 'PDFTemplate',
        },
      ],
    },
    {
      title: 'App',
      items: [
        {
          id: 'referral',
          title: 'Refer a Friend',
          subtitle: 'Earn rewards for referrals',
          icon: 'gift',
          screen: 'Referral',
          badge: 'EARN',
          badgeColor: colors.success,
        },
        {
          id: 'subscription',
          title: 'Subscription',
          subtitle: subscriptionStatus?.isPro ? 'Pro Member' : 'Free Plan',
          icon: 'crown',
          screen: 'SubscriptionSettings',
          badge: subscriptionStatus?.isPro ? 'PRO' : undefined,
          badgeColor: colors.secondary,
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
          badgeColor: colors.error,
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

  const handleMenuPress = (screen: string) => {
    navigation.navigate(screen);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
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
                    onPress={() => handleMenuPress(item.screen)}
                  >
                    <View style={styles.menuItemLeft}>
                      <View style={styles.iconContainer}>
                        <MaterialCommunityIcons
                          name={item.icon as any}
                          size={24}
                          color={colors.primary}
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
                      color={colors.onSurface}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    color: colors.onSurface,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
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
    borderBottomColor: colors.outline + '20',
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
    backgroundColor: colors.primary + '15',
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
    color: colors.text,
    marginBottom: 2,
  },
  menuItemSubtitle: {
    fontSize: 13,
    color: colors.onSurface,
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
    color: colors.surface,
  },
});
