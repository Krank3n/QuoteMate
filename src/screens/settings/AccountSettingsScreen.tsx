/**
 * Account Settings Screen
 * User info, sign out, delete account
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  Alert,
  Switch,
} from 'react-native';
import {
  Text,
  Surface,
  Title,
  Button,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { signOut, deleteUser } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

import { useStore } from '../../store/useStore';
import { auth, db } from '../../config/firebase';
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import { updateEmailPreferences } from '../../services/emailService';

export function AccountSettingsScreen() {
  const { clearAllData } = useStore();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [marketingEmails, setMarketingEmails] = useState(true);
  const [emailPrefsLoading, setEmailPrefsLoading] = useState(true);

  // Load email preferences from Firestore
  useEffect(() => {
    async function loadPrefs() {
      const userId = auth.currentUser?.uid;
      if (!userId) return;
      try {
        const prefsDoc = await getDoc(doc(db, 'users', userId, 'settings', 'emailPreferences'));
        if (prefsDoc.exists()) {
          setMarketingEmails(prefsDoc.data()?.marketing !== false);
        }
      } catch (error) {
        console.error('Failed to load email preferences:', error);
      } finally {
        setEmailPrefsLoading(false);
      }
    }
    loadPrefs();
  }, []);

  const handleToggleMarketing = async (value: boolean) => {
    setMarketingEmails(value);
    const success = await updateEmailPreferences(value);
    if (!success) {
      setMarketingEmails(!value); // Revert on failure
      Alert.alert('Error', 'Failed to update email preferences. Please try again.');
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const confirmLogout = async () => {
    setShowLogoutModal(false);

    try {
      await signOut(auth);
      await clearAllData();

      if (Platform.OS === 'web') {
        try {
          localStorage.clear();
          sessionStorage.clear();
          if (window.indexedDB) {
            const dbs = await window.indexedDB.databases();
            for (const db of dbs) {
              if (db.name) {
                window.indexedDB.deleteDatabase(db.name);
              }
            }
          }
        } catch (e) {
          console.warn('Could not clear browser storage:', e);
        }
        window.location.replace(window.location.origin);
      }
    } catch (error: any) {
      console.error('Error during sign out:', error);
      Alert.alert('Error', 'Failed to sign out. Please try again.');
    }
  };

  const handleDeleteAccount = () => {
    setShowDeleteAccountModal(true);
  };

  const confirmDeleteAccount = async () => {
    setShowDeleteAccountModal(false);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('No user is currently signed in');
      }

      await clearAllData();
      await deleteUser(currentUser);

      if (Platform.OS === 'web') {
        try {
          localStorage.clear();
          sessionStorage.clear();
          if (window.indexedDB) {
            const dbs = await window.indexedDB.databases();
            for (const db of dbs) {
              if (db.name) {
                window.indexedDB.deleteDatabase(db.name);
              }
            }
          }
        } catch (e) {
          console.warn('Could not clear browser storage:', e);
        }
        window.location.replace(window.location.origin);
      }
    } catch (error: any) {
      console.error('Error during account deletion:', error);

      if (error.code === 'auth/requires-recent-login') {
        Alert.alert(
          'Re-authentication Required',
          'For security, you need to sign in again before deleting your account. Please sign out and sign back in, then try again.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Deletion Failed',
          'Failed to delete account: ' + (error.message || 'Unknown error'),
          [{ text: 'OK' }]
        );
      }
    }
  };

  const currentUser = auth.currentUser;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          {currentUser && (
            <Surface style={styles.card}>
              <Title style={styles.sectionTitle}>Account Details</Title>

              <View style={styles.userInfo}>
                <MaterialCommunityIcons name="account-circle" size={56} color={colors.primary} />
                <View style={styles.userDetails}>
                  <Text style={styles.userEmail}>{currentUser.email}</Text>
                  <Text style={styles.userIdText}>User ID: {currentUser.uid.slice(0, 12)}...</Text>
                </View>
              </View>
            </Surface>
          )}

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Email Notifications</Title>

            <View style={styles.prefRow}>
              <View style={styles.prefTextContainer}>
                <Text style={styles.prefTitle}>Transactional emails</Text>
                <Text style={styles.prefDescription}>Quote responses, payment alerts, subscription updates</Text>
              </View>
              <Switch value={true} disabled={true} trackColor={{ true: colors.primary + '80' }} />
            </View>

            <View style={[styles.prefRow, { borderTopWidth: 1, borderTopColor: colors.outline + '20', paddingTop: 12 }]}>
              <View style={styles.prefTextContainer}>
                <Text style={styles.prefTitle}>Marketing emails</Text>
                <Text style={styles.prefDescription}>Tips, feature updates, and re-engagement</Text>
              </View>
              <Switch
                value={marketingEmails}
                onValueChange={handleToggleMarketing}
                disabled={emailPrefsLoading}
                trackColor={{ false: colors.outline, true: colors.primary + '80' }}
                thumbColor={marketingEmails ? colors.primary : '#f4f3f4'}
              />
            </View>
          </Surface>

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Account Actions</Title>

            <Button
              mode="outlined"
              onPress={handleLogout}
              style={styles.logoutButton}
              icon="logout"
              textColor={colors.error}
              buttonColor={colors.surface}
            >
              Sign Out
            </Button>

            <View style={styles.dangerZone}>
              <Text style={styles.dangerTitle}>Danger Zone</Text>
              <Text style={styles.dangerDescription}>
                Permanently delete your account and all associated data. This action cannot be undone.
              </Text>
              <Button
                mode="text"
                onPress={handleDeleteAccount}
                style={styles.deleteAccountButton}
                icon="delete-forever"
                textColor={colors.error}
              >
                Delete Account
              </Button>
            </View>
          </Surface>
        </WebContainer>
      </ScrollView>

      <AlertModal
        visible={showLogoutModal}
        onDismiss={() => setShowLogoutModal(false)}
        type="warning"
        icon="logout"
        title="Sign Out"
        message="Are you sure you want to sign out? All local data will be cleared."
        primaryButtonText="Sign Out"
        primaryButtonAction={confirmLogout}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setShowLogoutModal(false)}
        showConfetti={false}
      />

      <AlertModal
        visible={showDeleteAccountModal}
        onDismiss={() => setShowDeleteAccountModal(false)}
        type="error"
        icon="delete-forever"
        title="Delete Account"
        message={`Are you sure you want to permanently delete your account? This action cannot be undone.\n\nAll your data will be permanently deleted:\n• Business settings\n• All quotes and projects\n• Subscription information\n• Account credentials`}
        primaryButtonText="Delete Permanently"
        primaryButtonAction={confirmDeleteAccount}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setShowDeleteAccountModal(false)}
        showConfetti={false}
      />
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
    paddingBottom: 32,
  },
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userDetails: {
    marginLeft: 16,
    flex: 1,
  },
  userEmail: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
    color: colors.text,
  },
  userIdText: {
    fontSize: 13,
    color: colors.onSurface,
  },
  logoutButton: {
    borderColor: colors.error,
    borderWidth: 1.5,
    paddingVertical: 4,
    marginBottom: 24,
  },
  dangerZone: {
    borderTopWidth: 1,
    borderTopColor: colors.outline + '30',
    paddingTop: 20,
  },
  dangerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.error,
    marginBottom: 8,
  },
  dangerDescription: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 16,
    lineHeight: 20,
  },
  deleteAccountButton: {
    alignSelf: 'flex-start',
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  prefTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  prefTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 2,
  },
  prefDescription: {
    fontSize: 13,
    color: colors.onSurface,
    lineHeight: 18,
  },
});
