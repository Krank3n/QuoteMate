/**
 * ContactActionsBar
 * Compact row of action buttons to contact a customer — call, text, email, website.
 * Only shows buttons for which data exists.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme';

interface ContactActionsBarProps {
  phone?: string;
  email?: string;
  website?: string;
  /** Compact mode hides labels and uses smaller icons (for contact list cards) */
  compact?: boolean;
}

interface ActionItem {
  icon: string;
  label: string;
  color: string;
  bgColor: string;
  onPress: () => void;
}

export function ContactActionsBar({ phone, email, website, compact = false }: ContactActionsBarProps) {
  const actions: ActionItem[] = [];

  if (phone) {
    const cleanPhone = phone.replace(/\s/g, '');
    actions.push({
      icon: 'phone',
      label: 'Call',
      color: colors.success,
      bgColor: colors.successBg,
      onPress: () => Linking.openURL(`tel:${cleanPhone}`),
    });
    actions.push({
      icon: 'message-text',
      label: 'Text',
      color: colors.info,
      bgColor: colors.infoBg,
      onPress: () => {
        const url = Platform.OS === 'ios'
          ? `sms:${cleanPhone}`
          : `sms:${cleanPhone}`;
        Linking.openURL(url);
      },
    });
  }

  if (email) {
    actions.push({
      icon: 'email-outline',
      label: 'Email',
      color: colors.warning,
      bgColor: colors.warningBg,
      onPress: () => Linking.openURL(`mailto:${email}`),
    });
  }

  if (website) {
    const url = website.startsWith('http') ? website : `https://${website}`;
    actions.push({
      icon: 'web',
      label: 'Web',
      color: colors.primary,
      bgColor: colors.primaryBg,
      onPress: () => Linking.openURL(url),
    });
  }

  if (actions.length === 0) return null;

  if (compact) {
    return (
      <View style={styles.compactRow}>
        {actions.map((action) => (
          <TouchableOpacity
            key={action.label}
            style={[styles.compactButton, { backgroundColor: action.bgColor }]}
            onPress={action.onPress}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={action.icon as any}
              size={16}
              color={action.color}
            />
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  return (
    <Surface style={styles.container}>
      <View style={styles.actionsRow}>
        {actions.map((action) => (
          <TouchableOpacity
            key={action.label}
            style={styles.actionButton}
            onPress={action.onPress}
            activeOpacity={0.7}
          >
            <View style={[styles.iconCircle, { backgroundColor: action.bgColor }]}>
              <MaterialCommunityIcons
                name={action.icon as any}
                size={20}
                color={action.color}
              />
            </View>
            <Text style={[styles.actionLabel, { color: action.color }]}>
              {action.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  actionButton: {
    alignItems: 'center',
    gap: 6,
    minWidth: 56,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // Compact mode (for contact list cards)
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
