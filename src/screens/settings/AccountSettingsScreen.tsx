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
  TextInput,
  Portal,
  Modal as PaperModal,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  signOut,
  deleteUser,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import * as Google from 'expo-auth-session/providers/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import { useStore } from '../../store/useStore';
import { auth, db } from '../../config/firebase';
import { makeStyles, useThemeColors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import { updateEmailPreferences } from '../../services/emailService';
import { GridBackground } from '../../components/GridBackground';
import { clearCustomerDraftRefs } from '../../services/assistant/readTools';

export function AccountSettingsScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const { clearAllData } = useStore();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showPasswordReauthModal, setShowPasswordReauthModal] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthLoading, setReauthLoading] = useState(false);
  const [reauthError, setReauthError] = useState('');
  const [marketingEmails, setMarketingEmails] = useState(true);
  const [emailPrefsLoading, setEmailPrefsLoading] = useState(true);

  // Google OAuth (mobile). On web we use reauthenticateWithPopup instead.
  const androidClientId = __DEV__ && process.env.GOOGLE_OAUTH_ANDROID_CLIENT_ID_DEBUG
    ? process.env.GOOGLE_OAUTH_ANDROID_CLIENT_ID_DEBUG
    : process.env.GOOGLE_OAUTH_ANDROID_CLIENT_ID;
  const [, , googlePromptAsync] = Google.useAuthRequest({
    iosClientId: process.env.GOOGLE_OAUTH_IOS_CLIENT_ID || undefined,
    androidClientId: androidClientId || undefined,
    // Public web OAuth client ID fallback — non-EXPO_PUBLIC env vars aren't
    // inlined into the web bundle, so without this Google.useAuthRequest throws
    // on web. See src/config/firebase.ts for the same pattern.
    webClientId: process.env.GOOGLE_OAUTH_WEB_CLIENT_ID
      || '652758863537-86a4q9860h9aalo36f4sb9tpt39ut7bs.apps.googleusercontent.com',
  });

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
      // Device-held customer details from find_customer die with the session.
      clearCustomerDraftRefs();
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
        }
        window.location.replace(window.location.origin);
      }
    } catch (error: any) {
      Alert.alert('Error', 'Failed to sign out. Please try again.');
    }
  };

  const handleDeleteAccount = () => {
    setShowDeleteAccountModal(true);
  };

  const clearWebStorage = async () => {
    if (Platform.OS !== 'web') return;
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
    } catch {}
  };

  const finalizeDelete = async (user: User) => {
    try {
      await deleteUser(user);
      await clearAllData();
      await clearWebStorage();
      if (Platform.OS === 'web') {
        window.location.replace(window.location.origin);
      }
    } catch (error: any) {
      Alert.alert(
        'Deletion Failed',
        'Failed to delete account: ' + (error.message || 'Unknown error'),
        [{ text: 'OK' }]
      );
    }
  };

  const reauthWithGoogle = async (user: User) => {
    if (Platform.OS === 'web') {
      await reauthenticateWithPopup(user, new GoogleAuthProvider());
      return;
    }
    const result = await googlePromptAsync();
    if (result?.type !== 'success') {
      throw { code: 'reauth-cancelled' };
    }
    const credential = GoogleAuthProvider.credential(result.params.id_token);
    await reauthenticateWithCredential(user, credential);
  };

  const reauthWithApple = async (user: User) => {
    if (Platform.OS === 'web') {
      await reauthenticateWithPopup(user, new OAuthProvider('apple.com'));
      return;
    }
    const nonce = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!appleCredential.identityToken) {
      throw new Error('No identity token returned from Apple');
    }
    const firebaseCredential = new OAuthProvider('apple.com').credential({
      idToken: appleCredential.identityToken,
      rawNonce: nonce,
    });
    await reauthenticateWithCredential(user, firebaseCredential);
  };

  const startReauthForDelete = async (user: User) => {
    const providerId = user.providerData[0]?.providerId;

    if (providerId === 'password') {
      setReauthPassword('');
      setReauthError('');
      setShowPasswordReauthModal(true);
      return;
    }

    try {
      if (providerId === 'google.com') {
        await reauthWithGoogle(user);
      } else if (providerId === 'apple.com') {
        await reauthWithApple(user);
      } else {
        Alert.alert(
          'Re-authentication Required',
          'Please sign out and sign back in, then try deleting your account again.',
          [{ text: 'OK' }]
        );
        return;
      }
      await finalizeDelete(user);
    } catch (error: any) {
      if (
        error?.code === 'reauth-cancelled' ||
        error?.code === 'ERR_REQUEST_CANCELED' ||
        error?.code === 'auth/popup-closed-by-user'
      ) {
        return;
      }
      Alert.alert(
        'Re-authentication Failed',
        error?.message || 'Unable to verify your identity. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const confirmDeleteAccount = async () => {
    setShowDeleteAccountModal(false);

    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert('Error', 'No user is currently signed in.');
      return;
    }

    try {
      await deleteUser(currentUser);
      await clearAllData();
      await clearWebStorage();
      if (Platform.OS === 'web') {
        window.location.replace(window.location.origin);
      }
    } catch (error: any) {
      if (error.code === 'auth/requires-recent-login') {
        await startReauthForDelete(currentUser);
      } else {
        Alert.alert(
          'Deletion Failed',
          'Failed to delete account: ' + (error.message || 'Unknown error'),
          [{ text: 'OK' }]
        );
      }
    }
  };

  const submitPasswordReauth = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser?.email) {
      setReauthError('Unable to verify your account.');
      return;
    }
    if (!reauthPassword) {
      setReauthError('Please enter your password.');
      return;
    }

    setReauthLoading(true);
    setReauthError('');
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, reauthPassword);
      await reauthenticateWithCredential(currentUser, credential);
      setShowPasswordReauthModal(false);
      setReauthPassword('');
      await finalizeDelete(currentUser);
    } catch (error: any) {
      if (
        error.code === 'auth/wrong-password' ||
        error.code === 'auth/invalid-credential'
      ) {
        setReauthError('Incorrect password. Please try again.');
      } else if (error.code === 'auth/too-many-requests') {
        setReauthError('Too many attempts. Please wait and try again.');
      } else {
        setReauthError(error.message || 'Unable to verify your identity.');
      }
    } finally {
      setReauthLoading(false);
    }
  };

  const currentUser = auth.currentUser;

  return (
    <View style={styles.container}>
      <GridBackground />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          {currentUser && (
            <Surface style={styles.card}>
              <Title style={styles.sectionTitle}>Account Details</Title>

              <View style={styles.userInfo}>
                <MaterialCommunityIcons name="account-circle" size={56} color={themeColors.accentText} />
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
              <Switch value={true} disabled={true} trackColor={{ true: themeColors.accentSubtle }} />
            </View>

            <View style={[styles.prefRow, { borderTopWidth: 1, borderTopColor: themeColors.border, paddingTop: 12 }]}>
              <View style={styles.prefTextContainer}>
                <Text style={styles.prefTitle}>Marketing emails</Text>
                <Text style={styles.prefDescription}>Tips, feature updates, and re-engagement</Text>
              </View>
              <Switch
                value={marketingEmails}
                onValueChange={handleToggleMarketing}
                disabled={emailPrefsLoading}
                trackColor={{ false: themeColors.borderStrong, true: themeColors.accentSubtle }}
                thumbColor={marketingEmails ? themeColors.accent : '#f4f3f4'}
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
              textColor={themeColors.error}
              buttonColor={themeColors.surfaceRaised}
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
                textColor={themeColors.error}
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

      <Portal>
        <PaperModal
          visible={showPasswordReauthModal}
          onDismiss={() => {
            if (reauthLoading) return;
            setShowPasswordReauthModal(false);
            setReauthPassword('');
            setReauthError('');
          }}
          contentContainerStyle={styles.passwordModal}
        >
          <Title style={styles.passwordModalTitle}>Confirm your password</Title>
          <Text style={styles.passwordModalMessage}>
            For security, please re-enter your password to permanently delete your account.
          </Text>
          <TextInput
            mode="outlined"
            label="Password"
            value={reauthPassword}
            onChangeText={(v) => {
              setReauthPassword(v);
              if (reauthError) setReauthError('');
            }}
            secureTextEntry
            autoFocus
            disabled={reauthLoading}
            style={styles.passwordInput}
            onSubmitEditing={submitPasswordReauth}
          />
          {reauthError ? (
            <Text style={styles.passwordModalError}>{reauthError}</Text>
          ) : null}
          <View style={styles.passwordModalButtons}>
            <Button
              mode="text"
              onPress={() => {
                setShowPasswordReauthModal(false);
                setReauthPassword('');
                setReauthError('');
              }}
              disabled={reauthLoading}
            >
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={submitPasswordReauth}
              loading={reauthLoading}
              disabled={reauthLoading}
              buttonColor={themeColors.error}
            >
              Delete Account
            </Button>
          </View>
        </PaperModal>
      </Portal>

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

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
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
    backgroundColor: t.colors.surfaceRaised,
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
    color: t.colors.text,
  },
  userIdText: {
    fontSize: 13,
    color: t.colors.textSecondary,
  },
  logoutButton: {
    borderColor: t.colors.error,
    borderWidth: 1.5,
    paddingVertical: 4,
    marginBottom: 24,
  },
  dangerZone: {
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    paddingTop: 20,
  },
  dangerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.error,
    marginBottom: 8,
  },
  dangerDescription: {
    fontSize: 14,
    color: t.colors.textSecondary,
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
    color: t.colors.text,
    marginBottom: 2,
  },
  prefDescription: {
    fontSize: 13,
    color: t.colors.textSecondary,
    lineHeight: 18,
  },
  passwordModal: {
    backgroundColor: t.colors.surfaceRaised,
    marginHorizontal: 24,
    padding: 24,
    borderRadius: 12,
  },
  passwordModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  passwordModalMessage: {
    fontSize: 14,
    color: t.colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  passwordInput: {
    backgroundColor: t.colors.surfaceRaised,
  },
  passwordModalError: {
    color: t.colors.error,
    fontSize: 13,
    marginTop: 8,
  },
  passwordModalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 20,
  },
}));
