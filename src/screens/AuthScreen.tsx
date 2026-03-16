/**
 * Authentication Screen
 * Handles sign in and sign up for all platforms (web, iOS, Android)
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Platform, KeyboardAvoidingView, ScrollView, Image, Animated } from 'react-native';
import { Text, TextInput, Button, Surface, Title, ActivityIndicator } from 'react-native-paper';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithCredential, OAuthProvider } from 'firebase/auth';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Google from 'expo-auth-session/providers/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { colors } from '../theme';
import { WebContainer } from '../components/WebContainer';

// Needed for expo-auth-session to work properly
WebBrowser.maybeCompleteAuthSession();

// Detect in-app browsers (Facebook Messenger, Instagram, etc.) that block popups
function isInAppBrowser(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|TikTok/i.test(ua);
}

// Save registration platform info so cloud functions know which platform the user signed up on
async function saveRegistrationPlatform(uid: string, method: 'email' | 'google' | 'apple') {
  try {
    await setDoc(doc(db, 'users', uid, 'settings', 'registrationInfo'), {
      platform: Platform.OS,
      method,
      registeredAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Error saving registration platform:', error);
  }
}

export function AuthScreen() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);
  const [isProcessingOAuth, setIsProcessingOAuth] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Animation values
  const fadeAnim = useState(new Animated.Value(0))[0];
  const logoScale = useState(new Animated.Value(0.8))[0];

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

  // Handle Google redirect result (for in-app browsers that can't use popups)
  useEffect(() => {
    if (Platform.OS === 'web') {
      getRedirectResult(auth)
        .then((result) => {
          if (result) {
            console.log('✅ Google Sign-In successful (redirect)');
            saveRegistrationPlatform(result.user.uid, 'google');
          }
        })
        .catch((error) => {
          console.error('Google redirect sign-in error:', error);
          setError('Failed to sign in with Google. Please try again.');
        });
    }
  }, []);

  // Initialize screen with animation
  useEffect(() => {
    // Animate in immediately - no artificial delay needed
    // App.tsx already handles auth state checking
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 40,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

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
      setIsProcessingOAuth(true);
      const { id_token } = response.params;
      const credential = GoogleAuthProvider.credential(id_token);
      signInWithCredential(auth, credential)
        .then((result) => {
          console.log('✅ Google Sign-In successful (mobile)');
          saveRegistrationPlatform(result.user.uid, 'google');
          // Keep loading state - App.tsx will handle navigation
        })
        .catch((error) => {
          console.error('Google Sign-In error:', error);
          setError('Failed to sign in with Google');
          setIsProcessingOAuth(false);
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
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await saveRegistrationPlatform(result.user.uid, 'email');
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
        const provider = new GoogleAuthProvider();
        if (isInAppBrowser()) {
          // In-app browsers (Messenger, Instagram, etc.) block popups — use redirect
          await signInWithRedirect(auth, provider);
          // Page will redirect, result handled by getRedirectResult on return
          return;
        }
        // Normal browser: Use Firebase popup
        setIsProcessingOAuth(true);
        const result = await signInWithPopup(auth, provider);
        await saveRegistrationPlatform(result.user.uid, 'google');
        // Keep loading state - App.tsx will handle navigation
      } else {
        // Mobile: Use expo-auth-session
        await promptAsync();
        // OAuth state will be handled by response useEffect
      }
    } catch (err: any) {
      console.error('Google sign in error:', err);
      if (err.code === 'auth/popup-closed-by-user') {
        setError('Sign-in cancelled');
      } else if (err.code === 'auth/popup-blocked') {
        setError('Pop-up blocked. Please allow pop-ups for this site.');
      } else {
        setError('Failed to sign in with Google. Please try again.');
      }
      setIsProcessingOAuth(false);
      setLoading(false);
    } finally {
      if (Platform.OS !== 'web') {
        setLoading(false);
      }
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
      // Generate a secure random nonce for Apple Sign In
      const nonce = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        nonce
      );

      console.log('🍎 Starting Apple Sign-In with nonce...');

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      console.log('🍎 Apple credential received, signing in with Firebase...');

      // Sign in with Firebase using Apple credential
      const { identityToken } = credential;
      if (identityToken) {
        setIsProcessingOAuth(true);
        const provider = new OAuthProvider('apple.com');
        const firebaseCredential = provider.credential({
          idToken: identityToken,
          rawNonce: nonce, // Pass the unhashed nonce to Firebase
        });
        const appleResult = await signInWithCredential(auth, firebaseCredential);
        await saveRegistrationPlatform(appleResult.user.uid, 'apple');
        console.log('✅ Apple Sign-In successful');
        // Keep loading state - App.tsx will handle navigation
      } else {
        throw new Error('No identity token returned from Apple');
      }
    } catch (err: any) {
      console.error('Apple sign in error:', err);
      console.error('Apple sign in error code:', err?.code);
      console.error('Apple sign in error message:', err?.message);
      console.error('Apple sign in error details:', JSON.stringify(err, null, 2));

      if (err.code === 'ERR_REQUEST_CANCELED') {
        setError('Sign-in cancelled');
      } else if (err.code === 'auth/invalid-credential') {
        setError('Apple Sign-In credential invalid. Please contact support.');
      } else if (err.code === 'auth/operation-not-allowed') {
        setError('Apple Sign-In is not enabled. Please contact support.');
      } else if (err.message?.includes('auth/')) {
        // Show Firebase-specific error
        setError(`Sign-in error: ${err.code || err.message}`);
      } else {
        setError('Failed to sign in with Apple. Please try again.');
      }
      setIsProcessingOAuth(false);
      setLoading(false);
    } finally {
      if (!isProcessingOAuth) {
        setLoading(false);
      }
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

  // Show loading screen when processing OAuth
  if (isProcessingOAuth) {
    return (
      <View style={styles.loadingContainer}>
        <Animated.View style={[styles.logoContainer, { transform: [{ scale: logoScale }] }]}>
          <Image
            source={require('../../assets/logo-scaled.png')}
            style={styles.logoLoading}
            resizeMode="contain"
          />
        </Animated.View>
        <ActivityIndicator size="large" color={colors.primary} style={styles.loadingSpinner} />
        <Text style={styles.loadingText}>Signing you in...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.contentWrapper}>
          <WebContainer maxWidth={440}>
            <Animated.View style={[styles.animatedContent, { opacity: fadeAnim }]}>
              {/* Logo */}
              <Animated.View style={[styles.logoWrapper, { transform: [{ scale: logoScale }] }]}>
                <Image
                  source={require('../../assets/logo-scaled.png')}
                  style={styles.logo}
                  resizeMode="contain"
                />
              </Animated.View>

              {/* Heading */}
              <View style={styles.header}>
                <Title style={styles.title}>
                  {isSignUp ? 'Create your account' : 'Welcome back'}
                </Title>
                <Text style={styles.subtitle}>
                  {isSignUp
                    ? 'Start creating professional quotes in minutes'
                    : 'Sign in to continue managing your quotes'
                  }
                </Text>
              </View>

              {/* Error message */}
              {error ? (
                <View style={styles.errorContainer}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.error} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Social sign-in buttons */}
              <View style={styles.socialSection}>
                {appleAuthAvailable && (
                  <Button
                    mode="contained"
                    onPress={handleAppleSignIn}
                    style={styles.appleButton}
                    contentStyle={styles.socialButtonContent}
                    labelStyle={styles.socialButtonLabel}
                    disabled={loading}
                    icon={() => <MaterialCommunityIcons name="apple" size={22} color="#fff" />}
                    buttonColor="#000"
                    textColor="#fff"
                  >
                    Continue with Apple
                  </Button>
                )}

                <Button
                  mode="contained"
                  onPress={handleGoogleSignIn}
                  style={styles.googleButton}
                  contentStyle={styles.socialButtonContent}
                  labelStyle={styles.socialButtonLabel}
                  disabled={loading || (Platform.OS !== 'web' && !request)}
                  icon={() => <MaterialCommunityIcons name="google" size={22} color="#fff" />}
                  buttonColor="#4285F4"
                  textColor="#fff"
                >
                  Continue with Google
                </Button>
              </View>

              {/* Divider */}
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or continue with email</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Email / Password form */}
              <View style={styles.formSection}>
                <TextInput
                  label="Email address"
                  value={email}
                  onChangeText={setEmail}
                  mode="outlined"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete={isSignUp ? 'username' : 'email'}
                  textContentType={isSignUp ? 'username' : 'emailAddress'}
                  style={styles.input}
                  outlineStyle={styles.inputOutline}
                  disabled={loading}
                  left={<TextInput.Icon icon="email-outline" color={colors.placeholder} size={20} />}
                />

                <TextInput
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  mode="outlined"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  textContentType={isSignUp ? 'newPassword' : 'password'}
                  style={styles.input}
                  outlineStyle={styles.inputOutline}
                  disabled={loading}
                  left={<TextInput.Icon icon="lock-outline" color={colors.placeholder} size={20} />}
                  right={<TextInput.Icon icon={showPassword ? 'eye-off' : 'eye'} color={colors.placeholder} size={20} onPress={() => setShowPassword(!showPassword)} />}
                />

                {isSignUp && (
                  <TextInput
                    label="Confirm password"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    mode="outlined"
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    textContentType="newPassword"
                    style={styles.input}
                    outlineStyle={styles.inputOutline}
                    disabled={loading}
                    left={<TextInput.Icon icon="lock-check-outline" color={colors.placeholder} size={20} />}
                    right={<TextInput.Icon icon={showConfirmPassword ? 'eye-off' : 'eye'} color={colors.placeholder} size={20} onPress={() => setShowConfirmPassword(!showConfirmPassword)} />}
                  />
                )}

                <Button
                  mode="contained"
                  onPress={isSignUp ? handleSignUp : handleSignIn}
                  style={styles.primaryButton}
                  contentStyle={styles.primaryButtonContent}
                  labelStyle={styles.primaryButtonLabel}
                  loading={loading}
                  disabled={loading}
                >
                  {isSignUp ? 'Create Account' : 'Sign In'}
                </Button>
              </View>

              {/* Switch mode link */}
              <View style={styles.switchRow}>
                <Text style={styles.switchText}>
                  {isSignUp ? 'Already have an account?' : "Don't have an account?"}
                </Text>
                <Button
                  mode="text"
                  onPress={() => {
                    setIsSignUp(!isSignUp);
                    setError('');
                  }}
                  disabled={loading}
                  labelStyle={styles.switchButtonLabel}
                  compact
                >
                  {isSignUp ? 'Sign In' : 'Sign Up'}
                </Button>
              </View>
            </Animated.View>
          </WebContainer>
        </View>
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
    padding: 24,
    paddingVertical: 48,
  },
  contentWrapper: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logoContainer: {
    marginBottom: 32,
  },
  logoLoading: {
    width: 88,
    height: 88,
    borderRadius: 20,
  },
  loadingSpinner: {
    marginVertical: 20,
  },
  loadingText: {
    fontSize: 16,
    color: colors.text,
    marginTop: 16,
  },
  animatedContent: {
    width: '100%',
    alignItems: 'center',
  },
  logoWrapper: {
    marginBottom: 28,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
    width: '100%',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 8,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.errorBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
    width: '100%',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    flex: 1,
  },
  socialSection: {
    width: '100%',
    gap: 12,
    marginBottom: 4,
  },
  appleButton: {
    borderRadius: 12,
    elevation: 0,
  },
  googleButton: {
    borderRadius: 12,
    elevation: 0,
  },
  socialButtonContent: {
    paddingVertical: 10,
  },
  socialButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
    width: '100%',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    marginHorizontal: 14,
    color: colors.textMuted,
    fontSize: 13,
    textTransform: 'lowercase',
  },
  formSection: {
    width: '100%',
    gap: 4,
  },
  input: {
    marginBottom: 12,
    backgroundColor: colors.surface,
  },
  inputOutline: {
    borderRadius: 10,
    borderColor: colors.border,
  },
  primaryButton: {
    marginTop: 8,
    borderRadius: 12,
    elevation: 0,
  },
  primaryButtonContent: {
    paddingVertical: 10,
  },
  primaryButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  switchText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  switchButtonLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
});
