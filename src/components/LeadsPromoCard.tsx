/**
 * LeadsPromoCard
 *
 * Dismissible promo on the Dashboard that pitches the call-answering service
 * (Katie) and taps through to the full pitch + live demo call. Hides itself
 * once the user dismisses it or registers interest. Visibility state is
 * re-checked on screen focus so submitting on the detail screen makes the
 * card disappear when you come back.
 */
import React, { useCallback, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

import { colors } from '../theme';
import { lightTap } from '../utils/haptics';
import { shouldShowPromo, dismissPromo } from '../services/leadInterest';

export function LeadsPromoCard() {
  const navigation = useNavigation<any>();
  const [visible, setVisible] = useState(false);

  // Re-check on every focus — covers first mount, returning from the detail
  // screen after submitting, and dismissing then navigating away and back.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      shouldShowPromo().then((show) => {
        if (active) setVisible(show);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  if (!visible) return null;

  const handleOpen = () => {
    lightTap();
    navigation.navigate('CallKatie');
  };

  const handleDismiss = () => {
    lightTap();
    setVisible(false);
    dismissPromo();
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        onPress={handleOpen}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Hear Katie answer a live demo call"
      >
        <Surface style={styles.card}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons name="phone-in-talk" size={22} color={colors.primary} />
          </View>
          <View style={styles.text}>
            <Text style={styles.title}>Never miss a call</Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              Hear it for yourself — Katie can call you in about 30 seconds, answering as your business.
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color={colors.primary} />
        </Surface>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.dismiss}
        onPress={handleDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Dismiss"
      >
        <MaterialCommunityIcons name="close-circle" size={22} color={colors.onSurface} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: colors.primary + '0E',
    borderWidth: 1,
    borderColor: colors.primary + '33',
    elevation: 1,
    gap: 12,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
    color: colors.onSurface,
    lineHeight: 17,
  },
  dismiss: {
    position: 'absolute',
    top: -6,
    right: 8,
    backgroundColor: colors.surface,
    borderRadius: 11,
    zIndex: 10,
    elevation: 10,
  },
});
