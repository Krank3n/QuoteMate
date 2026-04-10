/**
 * BottomSheet — shared animated bottom sheet container.
 *
 * Handles:
 * - Slide-up / slide-down spring animation
 * - Backdrop fade + tap-to-dismiss
 * - Android back button interception
 * - Animated unmount (close animation plays before the component disappears)
 * - Drag handle
 *
 * Pass children for sheet content. Use `title` for a centered heading.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Animated,
  Dimensions,
  Platform,
  Keyboard,
  ViewStyle,
  ScrollView,
} from 'react-native';
import { Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useSheetBackHandler } from '../utils/useSheetBackHandler';

const SCREEN_HEIGHT = Dimensions.get('window').height;

interface BottomSheetProps {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Extra styles applied to the sheet container */
  sheetStyle?: ViewStyle;
  /** Whether to wrap children in a ScrollView (default false) */
  scrollable?: boolean;
  /** Max height as fraction of screen height (default 0.85) */
  maxHeightRatio?: number;
  /** Optional footer rendered below the scrollable content */
  footer?: React.ReactNode;
  /** Optional overlay rendered inside the sheet (e.g. GrainOverlay) */
  overlay?: React.ReactNode;
}

export function BottomSheet({
  visible,
  onDismiss,
  title,
  subtitle,
  children,
  sheetStyle,
  scrollable = false,
  maxHeightRatio = 0.85,
  footer,
  overlay,
}: BottomSheetProps) {
  const safeInsets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  // Tracks the soft-keyboard height so the sheet can shift up when an
  // input inside it gets focused. AndroidManifest.adjustResize doesn't
  // help here because the sheet is rendered inside a Portal at absolute
  // position — the OS resize never reaches it.
  const keyboardOffset = useRef(new Animated.Value(0)).current;

  const runCloseAnimation = useCallback(
    (onFinished: () => void) => {
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
      ]).start(onFinished);
    },
    [slideAnim, backdropAnim],
  );

  const shouldRender = useSheetBackHandler(visible, onDismiss, runCloseAnimation);

  useEffect(() => {
    if (visible) {
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
    }
  }, [visible]);

  // Listen for soft-keyboard show/hide and translate the sheet up by the
  // keyboard height so any TextInput inside the sheet stays visible.
  useEffect(() => {
    if (!visible) return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      const h = e.endCoordinates?.height ?? 0;
      Animated.timing(keyboardOffset, {
        toValue: -h,
        duration: Platform.OS === 'ios' ? (e.duration ?? 250) : 200,
        useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, (e) => {
      Animated.timing(keyboardOffset, {
        toValue: 0,
        duration: Platform.OS === 'ios' ? (e.duration ?? 200) : 200,
        useNativeDriver: true,
      }).start();
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible, keyboardOffset]);

  if (!shouldRender) return null;

  const content = scrollable ? (
    <ScrollView
      style={styles.scrollArea}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      bounces
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.contentContainer}>{children}</View>
  );

  return (
    <Portal>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      </Animated.View>

      {/* Sheet */}
      <View style={styles.sheetWrapper} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            { maxHeight: SCREEN_HEIGHT * maxHeightRatio },
            sheetStyle,
            { transform: [
              { translateY: slideAnim },
              { translateY: keyboardOffset },
            ] },
          ]}
        >
          {/* Handle */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {title && <Text style={styles.title}>{title}</Text>}
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

          {content}

          {footer}

          {overlay}

          {/* Safe area padding — use actual inset so Android nav bar is respected */}
          <View style={{ height: Math.max(safeInsets.bottom, 16) }} />
        </Animated.View>
      </View>
    </Portal>
  );
}

/**
 * Helper hook for staggered option entrance animations.
 * Returns [animValues, triggerEntrance].
 */
export function useStaggeredEntrance(count: number, visible: boolean, delay = 100, staggerMs = 40) {
  const anims = useRef<Animated.Value[]>([]);
  if (anims.current.length !== count) {
    anims.current = Array.from({ length: count }, () => new Animated.Value(0));
  }

  useEffect(() => {
    if (visible) {
      anims.current.forEach(a => a.setValue(0));
      Animated.sequence([
        Animated.delay(delay),
        Animated.stagger(
          staggerMs,
          anims.current.map(anim =>
            Animated.spring(anim, {
              toValue: 1,
              tension: 80,
              friction: 8,
              useNativeDriver: true,
            }),
          ),
        ),
      ]).start();
    }
  }, [visible]);

  return anims.current;
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    zIndex: 1000,
  },
  sheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1001,
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#141C2B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
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
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    paddingTop: 8,
    paddingBottom: 16,
  },
  subtitle: {
    fontSize: 13,
    color: colors.inactive,
    textAlign: 'center',
    marginTop: -12,
    paddingBottom: 16,
  },
  contentContainer: {
    paddingHorizontal: 16,
  },
  scrollArea: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
});
