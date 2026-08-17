/**
 * Notification Preferences Screen
 * Toggle Aussie push notification categories on/off
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import {
  Text,
  Surface,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { auth, db } from '../../config/firebase';
import { makeStyles, useThemeColors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { NotificationPreferences } from '../../types';
import { GridBackground } from '../../components/GridBackground';

const DEFAULT_PREFS: NotificationPreferences = {
  quoteUpdates: true,
  invoiceUpdates: true,
  milestoneCelebrations: true,
  inactivityNudges: true,
};

interface PrefItem {
  key: keyof NotificationPreferences;
  title: string;
  subtitle: string;
  icon: string;
}

const PREF_ITEMS: PrefItem[] = [
  {
    key: 'quoteUpdates',
    title: 'Quote Updates',
    subtitle: 'Opened, accepted, declined, expiring',
    icon: 'file-document-outline',
  },
  {
    key: 'invoiceUpdates',
    title: 'Invoice Updates',
    subtitle: 'Paid, overdue reminders',
    icon: 'receipt',
  },
  {
    key: 'milestoneCelebrations',
    title: 'Milestone Celebrations',
    subtitle: 'Quote count achievements',
    icon: 'trophy',
  },
  {
    key: 'inactivityNudges',
    title: 'Draft Reminders',
    subtitle: 'Quotes you built but never sent',
    icon: 'hand-wave',
  },
];

export function NotificationPreferencesScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPrefs();
  }, []);

  const loadPrefs = async () => {
    try {
      const userId = auth.currentUser?.uid;
      if (!userId) return;

      const prefDoc = await getDoc(
        doc(db, 'users', userId, 'settings', 'notificationPreferences')
      );
      if (prefDoc.exists()) {
        setPrefs({ ...DEFAULT_PREFS, ...prefDoc.data() as Partial<NotificationPreferences> });
      }
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const togglePref = async (key: keyof NotificationPreferences) => {
    const newPrefs = { ...prefs, [key]: !prefs[key] };
    setPrefs(newPrefs);

    try {
      const userId = auth.currentUser?.uid;
      if (!userId) return;

      await setDoc(
        doc(db, 'users', userId, 'settings', 'notificationPreferences'),
        newPrefs
      );
    } catch (error) {
      // Revert on failure
      setPrefs(prefs);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={themeColors.accentText} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GridBackground />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          <Text style={styles.headerText}>
            Choose which Aussie notifications you want to receive, legend!
          </Text>

          <Surface style={styles.card}>
            {PREF_ITEMS.map((item, index) => (
              <View
                key={item.key}
                style={[
                  styles.prefItem,
                  index < PREF_ITEMS.length - 1 && styles.prefItemBorder,
                ]}
              >
                <View style={styles.prefLeft}>
                  <View style={styles.iconContainer}>
                    <MaterialCommunityIcons
                      name={item.icon as any}
                      size={24}
                      color={themeColors.accentText}
                    />
                  </View>
                  <View style={styles.prefText}>
                    <Text style={styles.prefTitle}>{item.title}</Text>
                    <Text style={styles.prefSubtitle}>{item.subtitle}</Text>
                  </View>
                </View>
                <Switch
                  value={prefs[item.key]}
                  onValueChange={() => togglePref(item.key)}
                  trackColor={{ false: '#767577', true: themeColors.accentSubtle }}
                  thumbColor={prefs[item.key] ? themeColors.accent : '#f4f3f4'}
                />
              </View>
            ))}
          </Surface>
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
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  headerText: {
    fontSize: 14,
    color: t.colors.textMuted,
    marginBottom: 16,
    lineHeight: 20,
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
  },
  prefItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  prefItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border,
  },
  prefLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.colors.accentSubtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  prefText: {
    flex: 1,
  },
  prefTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.text,
  },
  prefSubtitle: {
    fontSize: 13,
    color: t.colors.textMuted,
    marginTop: 2,
  },
}));
