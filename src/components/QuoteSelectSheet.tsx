/**
 * Quote Select Sheet Component
 * Animated bottom sheet for selecting a quote to convert to an invoice
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Pressable, Animated, Dimensions, Platform, ScrollView } from 'react-native';
import { Portal, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { formatCurrency } from '../utils/quoteCalculator';
import { Quote } from '../types';

interface QuoteSelectSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (quote: Quote) => void;
  quotes: Quote[];
}

const SCREEN_HEIGHT = Dimensions.get('window').height;

const STATUS_CONFIG: Record<string, { icon: string; color: string; bgColor: string }> = {
  accepted: { icon: 'check-circle-outline', color: colors.success, bgColor: colors.successBg },
  sent: { icon: 'send-outline', color: colors.warning, bgColor: colors.warningBg },
  completed: { icon: 'check-decagram', color: colors.primary, bgColor: colors.primaryBg },
};

export function QuoteSelectSheet({ visible, onDismiss, onSelect, quotes }: QuoteSelectSheetProps) {
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const optionAnims = useRef<Animated.Value[]>([]);

  if (optionAnims.current.length !== quotes.length) {
    optionAnims.current = quotes.map(() => new Animated.Value(0));
  }

  useEffect(() => {
    if (visible) {
      optionAnims.current.forEach(a => a.setValue(0));

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
      ]).start(() => {
        Animated.stagger(
          50,
          optionAnims.current.map(anim =>
            Animated.spring(anim, {
              toValue: 1,
              tension: 80,
              friction: 8,
              useNativeDriver: true,
            })
          )
        ).start();
      });
    } else {
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
      ]).start();
    }
  }, [visible]);

  const handleSelect = (quote: Quote) => {
    selectionTap();
    onSelect(quote);
  };

  if (!visible) return null;

  return (
    <Portal>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
        {/* Handle */}
        <View style={styles.handleContainer}>
          <View style={styles.handle} />
        </View>

        <Text style={styles.title}>Select Quote to Convert</Text>
        <Text style={styles.subtitle}>Choose a quote to create an invoice from</Text>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.optionsContainer}
          showsVerticalScrollIndicator={false}
          bounces={quotes.length > 4}
        >
          {quotes.map((quote, index) => {
            const anim = optionAnims.current[index];
            const config = STATUS_CONFIG[quote.status] || STATUS_CONFIG.sent;

            return (
              <Animated.View
                key={quote.id}
                style={{
                  opacity: anim,
                  transform: [
                    { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
                    { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) },
                  ],
                }}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.option,
                    pressed && styles.optionPressed,
                  ]}
                  onPress={() => handleSelect(quote)}
                >
                  <View style={[styles.iconCircle, { backgroundColor: config.bgColor }]}>
                    <MaterialCommunityIcons
                      name={config.icon as any}
                      size={22}
                      color={config.color}
                    />
                  </View>

                  <View style={styles.labelContainer}>
                    <Text style={styles.quoteNumber} numberOfLines={1}>
                      {quote.quoteNumber || 'Quote'} — {quote.customerName}
                    </Text>
                    <Text style={styles.jobName} numberOfLines={1}>
                      {quote.job.name}
                    </Text>
                  </View>

                  <View style={styles.rightSection}>
                    <Text style={styles.total}>{formatCurrency(quote.total)}</Text>
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={20}
                      color={colors.inactive}
                    />
                  </View>
                </Pressable>
              </Animated.View>
            );
          })}
        </ScrollView>

        {/* Cancel button */}
        <Pressable
          style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
          onPress={onDismiss}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>

        {/* Safe area padding for bottom */}
        <View style={styles.bottomPadding} />
      </Animated.View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    zIndex: 1000,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    zIndex: 1001,
    maxHeight: SCREEN_HEIGHT * 0.7,
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
    paddingBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    color: colors.inactive,
    textAlign: 'center',
    paddingBottom: 16,
  },
  scrollArea: {
    flexShrink: 1,
  },
  optionsContainer: {
    paddingHorizontal: 16,
    gap: 10,
    paddingBottom: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: colors.surfaceGray3,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  optionPressed: {
    backgroundColor: colors.surfaceGray2,
    transform: [{ scale: 0.98 }],
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  labelContainer: {
    flex: 1,
    marginRight: 8,
  },
  quoteNumber: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  jobName: {
    fontSize: 13,
    color: colors.inactive,
    marginTop: 2,
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  total: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  cancelButton: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.surfaceGray3,
    alignItems: 'center',
  },
  cancelButtonPressed: {
    backgroundColor: colors.surfaceGray2,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.inactive,
  },
  bottomPadding: {
    height: 34,
  },
});
