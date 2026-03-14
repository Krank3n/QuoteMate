/**
 * Quote Select Sheet Component
 * Animated bottom sheet for selecting a quote to convert to an invoice
 */

import React from 'react';
import { View, StyleSheet, Pressable, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { formatCurrency } from '../utils/quoteCalculator';
import { Quote } from '../types';
import { BottomSheet, useStaggeredEntrance } from './BottomSheet';

interface QuoteSelectSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (quote: Quote) => void;
  quotes: Quote[];
}

const STATUS_CONFIG: Record<string, { icon: string; color: string; bgColor: string }> = {
  accepted: { icon: 'check-circle-outline', color: colors.success, bgColor: colors.successBg },
  sent: { icon: 'send-outline', color: colors.warning, bgColor: colors.warningBg },
  completed: { icon: 'check-decagram', color: colors.primary, bgColor: colors.primaryBg },
};

export function QuoteSelectSheet({ visible, onDismiss, onSelect, quotes }: QuoteSelectSheetProps) {
  const optionAnims = useStaggeredEntrance(quotes.length, visible, 150, 50);

  const handleSelect = (quote: Quote) => {
    selectionTap();
    onSelect(quote);
  };

  const footer = (
    <Pressable
      style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
      onPress={onDismiss}
    >
      <Text style={styles.cancelText}>Cancel</Text>
    </Pressable>
  );

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Select Quote to Convert"
      subtitle="Choose a quote to create an invoice from"
      scrollable
      maxHeightRatio={0.7}
      footer={footer}
    >
      <View style={styles.optionsContainer}>
        {quotes.map((quote, index) => {
          const anim = optionAnims[index];
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
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  optionsContainer: {
    gap: 10,
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
});
