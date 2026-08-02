/**
 * AppUpdateSheet — beautiful bottom sheet prompting users to update the app.
 *
 * Renders its own full-screen overlay (no Portal) so it works reliably
 * when mounted outside NavigationContainer.
 *
 * Two modes:
 *  • Soft update  – dismissible, "Maybe later" link
 *  • Force update – cannot dismiss, backdrop tap disabled
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Linking,
  Platform,
  Pressable,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, Button } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '../theme';
import { APP_STORE_URL, PLAY_STORE_URL } from '../config/storeLinks';
import type { AppUpdateInfo } from '../services/appUpdateService';

const SCREEN_HEIGHT = Dimensions.get('window').height;

// Store URLs come from src/config/storeLinks.ts — the id hard-coded here
// (6740091464) was dead, so every iOS user who tapped "Update" landed on an
// App Store 404 instead of the listing.
const STORE_URL = Platform.select({
  ios: APP_STORE_URL,
  android: PLAY_STORE_URL,
  default: '',
});

interface Props {
  visible: boolean;
  onDismiss: () => void;
  info: AppUpdateInfo;
}

export function AppUpdateSheet({ visible, onDismiss, info }: Props) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;

    // Slide up + fade backdrop
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }),
      Animated.timing(backdropAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();

    // Gentle pulse on the icon
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();

    return () => pulse.stop();
  }, [visible]);

  const handleDismiss = () => {
    if (info.forceUpdate) return;
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => onDismiss());
  };

  const currentVersion = Constants.expoConfig?.version ?? '—';

  const handleUpdate = () => {
    if (STORE_URL) Linking.openURL(STORE_URL);
  };

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          { transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Handle */}
        <View style={styles.handleContainer}>
          <View style={styles.handle} />
        </View>

        {/* Content */}
        <View style={styles.content}>
          {/* Glowing icon */}
          <View style={styles.iconArea}>
            <Animated.View
              style={[
                styles.iconCircle,
                { transform: [{ scale: pulseAnim }] },
              ]}
            >
              <LinearGradient
                colors={['#00C897', '#009868']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.iconGradient}
              >
                <MaterialCommunityIcons
                  name="rocket-launch"
                  size={36}
                  color="#fff"
                />
              </LinearGradient>
            </Animated.View>
            {/* Soft glow ring */}
            <View style={styles.glowRing} />
          </View>

          {/* Title */}
          <Text style={styles.title}>
            {info.forceUpdate
              ? 'Update Required'
              : 'New Version Available'}
          </Text>

          {/* Version badges */}
          <View style={styles.versionRow}>
            <View style={styles.versionBadge}>
              <Text style={styles.versionLabel}>Current</Text>
              <Text style={styles.versionValue}>{currentVersion}</Text>
            </View>
            <MaterialCommunityIcons
              name="arrow-right"
              size={18}
              color={colors.inactive}
              style={styles.arrow}
            />
            <View style={[styles.versionBadge, styles.versionBadgeNew]}>
              <Text style={[styles.versionLabel, styles.versionLabelNew]}>
                Latest
              </Text>
              <Text style={[styles.versionValue, styles.versionValueNew]}>
                {info.latestVersion}
              </Text>
            </View>
          </View>

          {/* What's new */}
          {info.whatsNew ? (
            <View style={styles.whatsNewCard}>
              <View style={styles.whatsNewHeader}>
                <MaterialCommunityIcons
                  name="star-four-points"
                  size={14}
                  color={colors.secondary}
                />
                <Text style={styles.whatsNewTitle}>What's new</Text>
              </View>
              <Text style={styles.whatsNewBody}>{info.whatsNew}</Text>
            </View>
          ) : null}

          {/* Force update message */}
          {info.forceUpdate && (
            <View style={styles.forceNotice}>
              <MaterialCommunityIcons
                name="shield-alert-outline"
                size={16}
                color={colors.warning}
              />
              <Text style={styles.forceText}>
                This update is required to keep using QuoteMate.
              </Text>
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Button
            mode="contained"
            onPress={handleUpdate}
            style={styles.updateButton}
            contentStyle={styles.updateButtonContent}
            labelStyle={styles.updateButtonLabel}
            icon="download"
          >
            Update Now
          </Button>

          {!info.forceUpdate && (
            <Button
              mode="text"
              onPress={handleDismiss}
              labelStyle={styles.laterLabel}
              style={styles.laterButton}
            >
              Maybe later
            </Button>
          )}
        </View>

        {/* Safe area padding */}
        <View style={{ height: Math.max(insets.bottom, 16) + 16 }} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#141C2B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
      },
      android: {
        elevation: 20,
      },
    }),
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceGray,
    opacity: 0.6,
  },

  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
  },

  /* ── Icon ─────────────────────────────────────── */
  iconArea: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    overflow: 'hidden',
  },
  iconGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 200, 151, 0.15)',
    zIndex: -1,
  },

  /* ── Title ────────────────────────────────────── */
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 20,
  },

  /* ── Version badges ───────────────────────────── */
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  versionBadge: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  versionBadgeNew: {
    backgroundColor: colors.primaryBg,
    borderColor: 'rgba(0, 200, 151, 0.25)',
  },
  versionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.inactive,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  versionLabelNew: {
    color: colors.success,
  },
  versionValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textMuted,
  },
  versionValueNew: {
    color: colors.success,
  },
  arrow: {
    marginHorizontal: 12,
  },

  /* ── What's new card ──────────────────────────── */
  whatsNewCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  whatsNewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  whatsNewTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  whatsNewBody: {
    fontSize: 14,
    color: colors.onSurface,
    lineHeight: 20,
  },

  /* ── Force update notice ──────────────────────── */
  forceNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningBg,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 8,
    width: '100%',
    marginBottom: 8,
  },
  forceText: {
    fontSize: 13,
    color: colors.warning,
    flex: 1,
    lineHeight: 18,
  },

  /* ── Footer / buttons ─────────────────────────── */
  footer: {
    paddingHorizontal: 24,
    paddingTop: 4,
  },
  updateButton: {
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  updateButtonContent: {
    paddingVertical: 6,
  },
  updateButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  laterButton: {
    marginTop: 4,
  },
  laterLabel: {
    fontSize: 14,
    color: colors.inactive,
  },
});
