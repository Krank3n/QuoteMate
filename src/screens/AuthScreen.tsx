/**
 * Authentication Screen
 * Handles sign in and sign up for all platforms (web, iOS, Android)
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Platform, KeyboardAvoidingView, ScrollView, Image, Animated, TextInput as RNTextInput } from 'react-native';
import { Text, TextInput, Button, Surface, Title, ActivityIndicator } from 'react-native-paper';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithCredential, OAuthProvider, sendEmailVerification, signOut } from 'firebase/auth';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Google from 'expo-auth-session/providers/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { colors } from '../theme';
import { WebContainer } from '../components/WebContainer';
import { lightTap, errorTap } from '../utils/haptics';

// Needed for expo-auth-session to work properly
WebBrowser.maybeCompleteAuthSession();

// Detect in-app browsers (Facebook Messenger, Instagram, etc.) that block popups
function isInAppBrowser(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|TikTok/i.test(ua);
}

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  '20minutemail.com',
  '33mail.com',
  'anonaddy.com',
  'guerrillamail.com',
  'mailinator.com',
  'maildrop.cc',
  'sharklasers.com',
  'tempmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);

function validateSignupEmail(rawEmail: string): string | null {
  const normalized = rawEmail.trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailPattern.test(normalized)) {
    return 'Please enter a valid email address';
  }

  const domain = normalized.split('@')[1];
  const labels = domain.split('.');
  if (labels.some(label => !label || label.startsWith('-') || label.endsWith('-'))) {
    return 'Please enter a valid email address';
  }

  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    return 'Please use a real email address, not a temporary or disposable one';
  }

  return null;
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
  }
}

export function AuthScreen() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);
  const [isProcessingOAuth, setIsProcessingOAuth] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  // Web only: set once Chrome autofills a field, so we can hide the floating
  // label while the autofill preview is showing (the value isn't readable yet).
  const [emailAutofilled, setEmailAutofilled] = useState(false);
  const [passwordAutofilled, setPasswordAutofilled] = useState(false);

  // Animation values
  const fadeAnim = useState(new Animated.Value(0))[0];
  const logoScale = useState(new Animated.Value(0.8))[0];

  // Input refs for keyboard Return key chaining
  const passwordRef = useRef<RNTextInput>(null);
  const confirmPasswordRef = useRef<RNTextInput>(null);

  // Configure Google Sign-In for mobile (iOS/Android)
  // On web, we use Firebase popup instead of expo-auth-session
  // Use debug client ID in development, production client ID in production
  const androidClientId = __DEV__ && process.env.GOOGLE_OAUTH_ANDROID_CLIENT_ID_DEBUG
    ? process.env.GOOGLE_OAUTH_ANDROID_CLIENT_ID_DEBUG
    : process.env.GOOGLE_OAUTH_ANDROID_CLIENT_ID;

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: process.env.GOOGLE_OAUTH_IOS_CLIENT_ID || undefined,
    androidClientId: androidClientId || undefined,
    // Public web OAuth client ID (exposed in the browser anyway). Hardcoded as
    // a fallback because non-EXPO_PUBLIC env vars are not inlined into the web
    // bundle — without this, Google.useAuthRequest throws on web ("webClientId
    // must be defined"), crashing the whole app to a white screen. Mirrors the
    // hardcoded-fallback pattern in src/config/firebase.ts.
    webClientId: process.env.GOOGLE_OAUTH_WEB_CLIENT_ID
      || '652758863537-86a4q9860h9aalo36f4sb9tpt39ut7bs.apps.googleusercontent.com',
  });

  // Handle Google redirect result (for in-app browsers that can't use popups)
  useEffect(() => {
    if (Platform.OS === 'web') {
      getRedirectResult(auth)
        .then((result) => {
          if (result) {
            const providerId = result.providerId || '';
            const method: 'google' | 'apple' | 'email' = providerId.includes('apple')
              ? 'apple'
              : providerId.includes('google')
              ? 'google'
              : 'email';
            saveRegistrationPlatform(result.user.uid, method);
          }
        })
        .catch((error) => {
          setError('Failed to sign in. Please try again.');
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

  // Web: Chrome autofills the underlying <input> on page load without firing
  // React's onChange, so `email`/`password` stay empty. Two problems follow:
  // the floating label sits on top of the autofilled text, and handleSignIn's
  // empty-field guard would reject a submit that *looks* filled.
  //
  // Chrome withholds the autofilled value from JS until the first user gesture,
  // so we can't just read it back on load. Instead we detect autofill via the
  // `animationstart` event our CSS keyframe fires the instant a field fills
  // (works pre-gesture) and hide the label then. Separately we sync the actual
  // values into state whenever Chrome will hand them over (gesture / a few
  // timers) so the submit guard and floated label end up correct.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const EMAIL_SEL = 'input[autocomplete="email"]';
    const PASS_SEL = 'input[autocomplete="current-password"], input[autocomplete="new-password"]';

    const syncValues = () => {
      const emailEl = document.querySelector(EMAIL_SEL) as HTMLInputElement | null;
      const passEl = document.querySelector(PASS_SEL) as HTMLInputElement | null;
      if (emailEl?.value) setEmail((prev) => prev || emailEl.value);
      if (passEl?.value) setPassword((prev) => prev || passEl.value);
    };

    const onAnimStart = (e: AnimationEvent) => {
      if (e.animationName !== 'qm-autofill') return;
      const target = e.target as HTMLInputElement;
      if (target.matches?.(EMAIL_SEL)) setEmailAutofilled(true);
      else if (target.matches?.(PASS_SEL)) setPasswordAutofilled(true);
      syncValues();
    };

    document.addEventListener('animationstart', onAnimStart, true);
    const timers = [setTimeout(syncValues, 100), setTimeout(syncValues, 400), setTimeout(syncValues, 900)];
    window.addEventListener('pointerdown', syncValues, { once: true });
    window.addEventListener('keydown', syncValues, { once: true });
    return () => {
      document.removeEventListener('animationstart', onAnimStart, true);
      timers.forEach(clearTimeout);
      window.removeEventListener('pointerdown', syncValues);
      window.removeEventListener('keydown', syncValues);
    };
  }, []);

  // Check if Apple Authentication is available (iOS native, or web via Firebase OAuth)
  useEffect(() => {
    const checkAppleAuth = async () => {
      if (Platform.OS === 'web') {
        // Apple Sign-In is always available on web via Firebase OAuth provider
        setAppleAuthAvailable(true);
        return;
      }
      const isAvailable = await AppleAuthentication.isAvailableAsync();
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
          saveRegistrationPlatform(result.user.uid, 'google');
          // Keep loading state - App.tsx will handle navigation
        })
        .catch((error) => {
          setError('Failed to sign in with Google');
          setIsProcessingOAuth(false);
        });
    }
  }, [response]);

  const handleSignIn = async () => {
    if (!email || !password) {
      setError('Please enter email and password');
      errorTap();
      return;
    }

    lightTap();
    setLoading(true);
    setError('');
    setNotice('');

    try {
      const result = await signInWithEmailAndPassword(auth, email.trim(), password);
      await result.user.reload();
      if (!result.user.emailVerified) {
        await sendEmailVerification(result.user).catch(() => {});
        await signOut(auth);
        setError('Please verify your email before signing in. We sent a fresh verification link to your inbox.');
        errorTap();
        return;
      }
      // Navigation will happen automatically when auth state changes
    } catch (err: any) {
      setError(getErrorMessage(err.code));
      errorTap();
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (!email || !password) {
      setError('Please enter email and password');
      errorTap();
      return;
    }

    const emailValidationError = validateSignupEmail(email);
    if (emailValidationError) {
      setError(emailValidationError);
      errorTap();
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      errorTap();
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      errorTap();
      return;
    }

    lightTap();
    setLoading(true);
    setError('');
    setNotice('');

    try {
      const result = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      await sendEmailVerification(result.user);
      await saveRegistrationPlatform(result.user.uid, 'email');
      await signOut(auth);
      setIsSignUp(false);
      setPassword('');
      setConfirmPassword('');
      setNotice('We sent a verification link to your email. Please verify it before signing in.');
    } catch (err: any) {
      setError(getErrorMessage(err.code));
      errorTap();
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    setNotice('');

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
    setNotice('');
    if (!appleAuthAvailable) {
      setError('Apple Sign-In is not available on this device');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Web: use Firebase OAuth popup/redirect flow (same pattern as Google)
      if (Platform.OS === 'web') {
        const provider = new OAuthProvider('apple.com');
        provider.addScope('email');
        provider.addScope('name');
        if (isInAppBrowser()) {
          await signInWithRedirect(auth, provider);
          return;
        }
        setIsProcessingOAuth(true);
        const result = await signInWithPopup(auth, provider);
        await saveRegistrationPlatform(result.user.uid, 'apple');
        // Keep loading state - App.tsx will handle navigation
        return;
      }

      // Generate a secure random nonce for Apple Sign In
      const nonce = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        nonce
      );


      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });


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
        // Keep loading state - App.tsx will handle navigation
      } else {
        throw new Error('No identity token returned from Apple');
      }
    } catch (err: any) {

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
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
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

              {/* Error / notice messages */}
              {error ? (
                <View style={styles.errorContainer}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.error} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}
              {notice ? (
                <View style={styles.noticeContainer}>
                  <MaterialCommunityIcons name="email-check-outline" size={18} color={colors.success} />
                  <Text style={styles.noticeText}>{notice}</Text>
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
                  label={emailAutofilled && !email ? undefined : 'Email address'}
                  value={email}
                  onChangeText={setEmail}
                  mode="outlined"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  importantForAutofill="yes"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  style={styles.input}
                  outlineStyle={styles.inputOutline}
                  disabled={loading}
                  left={<TextInput.Icon icon="email-outline" color={colors.placeholder} size={20} />}
                />

                <TextInput
                  ref={passwordRef}
                  label={passwordAutofilled && !password ? undefined : 'Password'}
                  value={password}
                  onChangeText={setPassword}
                  mode="outlined"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  textContentType={isSignUp ? 'newPassword' : 'password'}
                  importantForAutofill="yes"
                  returnKeyType={isSignUp ? 'next' : 'done'}
                  onSubmitEditing={() => {
                    if (isSignUp) {
                      confirmPasswordRef.current?.focus();
                    } else {
                      handleSignIn();
                    }
                  }}
                  style={styles.input}
                  outlineStyle={styles.inputOutline}
                  disabled={loading}
                  left={<TextInput.Icon icon="lock-outline" color={colors.placeholder} size={20} />}
                  right={<TextInput.Icon icon={showPassword ? 'eye-off' : 'eye'} color={colors.placeholder} size={20} onPress={() => setShowPassword(!showPassword)} />}
                />

                {isSignUp && (
                  <TextInput
                    ref={confirmPasswordRef}
                    label="Confirm password"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    mode="outlined"
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    importantForAutofill="yes"
                    returnKeyType="done"
                    onSubmitEditing={handleSignUp}
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
                    setNotice('');
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
  scrollView: {
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
  noticeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
    width: '100%',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  noticeText: {
    color: colors.success,
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
