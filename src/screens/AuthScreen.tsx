/**
 * Authentication Screen
 * Handles sign in and sign up for all platforms (web, iOS, Android)
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Platform, KeyboardAvoidingView, ScrollView } from 'react-native';
import { Text, TextInput, Button, Surface, Title } from 'react-native-paper';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signInWithCredential, OAuthProvider } from 'firebase/auth';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Google from 'expo-auth-session/providers/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { auth } from '../config/firebase';
import { colors } from '../theme';
import { WebContainer } from '../components/WebContainer';

// Needed for expo-auth-session to work properly
WebBrowser.maybeCompleteAuthSession();

export function AuthScreen() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);

  // Configure Google Sign-In for mobile (iOS/Android)
  // On web, we use Firebase popup instead of expo-auth-session
  // Use debug client ID in development, production client ID in production
  const androidClientId = __DEV__ && process.env.GOOGLE_OAUTH_ANDROID_CLIENT_ID_DEBUG
    ? process.env.GOOGLE_OAUTH_ANDROID_CLIENT_ID_DEBUG
    : process.env.GOOGLE_OAUTH_ANDROID_CLIENT_ID;

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: process.env.GOOGLE_OAUTH_IOS_CLIENT_ID || undefined,
    androidClientId: androidClientId || undefined,
    webClientId: process.env.GOOGLE_OAUTH_WEB_CLIENT_ID || undefined,
  });

  // Check if Apple Authentication is available (iOS only)
  useEffect(() => {
    const checkAppleAuth = async () => {
      console.log('🍎 Checking Apple Authentication availability...');
      console.log('Platform:', Platform.OS);
      const isAvailable = await AppleAuthentication.isAvailableAsync();
      console.log('🍎 Apple Authentication available:', isAvailable);
      setAppleAuthAvailable(isAvailable);
    };
    checkAppleAuth();
  }, []);

  // Handle Google Sign-In response (mobile)
  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      const credential = GoogleAuthProvider.credential(id_token);
      signInWithCredential(auth, credential)
        .then(() => {
          console.log('✅ Google Sign-In successful (mobile)');
        })
        .catch((error) => {
          console.error('Google Sign-In error:', error);
          setError('Failed to sign in with Google');
        });
    }
  }, [response]);

  const handleSignIn = async () => {
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Navigation will happen automatically when auth state changes
    } catch (err: any) {
      console.error('Sign in error:', err);
      setError(getErrorMessage(err.code));
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await createUserWithEmailAndPassword(auth, email, password);
      // Navigation will happen automatically when auth state changes
    } catch (err: any) {
      console.error('Sign up error:', err);
      setError(getErrorMessage(err.code));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');

    try {
      if (Platform.OS === 'web') {
        // Web: Use Firebase popup
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
      } else {
        // Mobile: Use expo-auth-session
        await promptAsync();
      }
      // Navigation will happen automatically when auth state changes
    } catch (err: any) {
      console.error('Google sign in error:', err);
      if (err.code === 'auth/popup-closed-by-user') {
        setError('Sign-in cancelled');
      } else if (err.code === 'auth/popup-blocked') {
        setError('Pop-up blocked. Please allow pop-ups for this site.');
      } else {
        setError('Failed to sign in with Google. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (!appleAuthAvailable) {
      setError('Apple Sign-In is not available on this device');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      // Sign in with Firebase using Apple credential
      const { identityToken } = credential;
      if (identityToken) {
        const provider = new OAuthProvider('apple.com');
        const firebaseCredential = provider.credential({
          idToken: identityToken,
        });
        await signInWithCredential(auth, firebaseCredential);
        console.log('✅ Apple Sign-In successful');
      }
      // Navigation will happen automatically when auth state changes
    } catch (err: any) {
      console.error('Apple sign in error:', err);
      if (err.code === 'ERR_REQUEST_CANCELED') {
        setError('Sign-in cancelled');
      } else {
        setError('Failed to sign in with Apple. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const getErrorMessage = (code: string): string => {
    switch (code) {
      case 'auth/invalid-email':
        return 'Invalid email address';
      case 'auth/user-disabled':
        return 'This account has been disabled';
      case 'auth/user-not-found':
        return 'No account found with this email';
      case 'auth/wrong-password':
        return 'Incorrect password';
      case 'auth/email-already-in-use':
        return 'Email already in use';
      case 'auth/weak-password':
        return 'Password is too weak';
      case 'auth/network-request-failed':
        return 'Network error. Please check your connection';
      default:
        return 'An error occurred. Please try again';
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <WebContainer>
          <View style={styles.header}>
            <Title style={styles.title}>
              {isSignUp ? 'Create Account' : 'Welcome Back'}
            </Title>
            <Text style={styles.subtitle}>
              {isSignUp
                ? 'Sign up to save your quotes and access premium features'
                : 'Sign in to access your quotes and subscriptions'
              }
            </Text>
          </View>

          <Surface style={styles.formCard}>
            {error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : null}

            {/* Apple Sign-In Button (iOS only) */}
            {appleAuthAvailable && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={5}
                style={styles.appleButton}
                onPress={handleAppleSignIn}
              />
            )}

            {/* Google Sign-In Button (All platforms) */}
            <Button
              mode="contained"
              onPress={handleGoogleSignIn}
              style={styles.googleButton}
              contentStyle={styles.googleButtonContent}
              disabled={loading || (Platform.OS !== 'web' && !request)}
              icon={() => <MaterialCommunityIcons name="google" size={24} color="#fff" />}
            >
              Continue with Google
            </Button>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <TextInput
              label="Email"
              value={email}
              onChangeText={setEmail}
              mode="outlined"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete={isSignUp ? 'username' : 'email'}
              textContentType={isSignUp ? 'username' : 'emailAddress'}
              style={styles.input}
              disabled={loading}
            />

            <TextInput
              label="Password"
              value={password}
              onChangeText={setPassword}
              mode="outlined"
              secureTextEntry
              autoCapitalize="none"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              textContentType={isSignUp ? 'newPassword' : 'password'}
              style={styles.input}
              disabled={loading}
            />

            {isSignUp && (
              <TextInput
                label="Confirm Password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                mode="outlined"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                style={styles.input}
                disabled={loading}
              />
            )}

            <Button
              mode="contained"
              onPress={isSignUp ? handleSignUp : handleSignIn}
              style={styles.primaryButton}
              contentStyle={styles.buttonContent}
              loading={loading}
              disabled={loading}
            >
              {isSignUp ? 'Sign Up' : 'Sign In'}
            </Button>

            <Button
              mode="text"
              onPress={() => {
                setIsSignUp(!isSignUp);
                setError('');
              }}
              disabled={loading}
              style={styles.switchButton}
            >
              {isSignUp
                ? 'Already have an account? Sign In'
                : "Don't have an account? Sign Up"
              }
            </Button>
          </Surface>
        </WebContainer>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    color: colors.onBackground,
  },
  subtitle: {
    fontSize: 16,
    color: colors.onSurface,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  formCard: {
    padding: 24,
    borderRadius: 12,
    elevation: 4,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
  },
  input: {
    marginBottom: 16,
  },
  errorText: {
    color: colors.error,
    marginBottom: 16,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 8,
    marginBottom: 8,
  },
  buttonContent: {
    paddingVertical: 6,
  },
  switchButton: {
    marginTop: 8,
    marginBottom: 16,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.onSurface,
    opacity: 0.3,
  },
  dividerText: {
    marginHorizontal: 16,
    color: colors.onSurface,
    opacity: 0.6,
  },
  appleButton: {
    width: '100%',
    height: 50,
    marginBottom: 16,
  },
  googleButton: {
    marginBottom: 24,
    backgroundColor: '#4285F4', // Google blue
  },
  googleButtonContent: {
    paddingVertical: 16,
  },
});
