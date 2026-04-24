/**
 * ContactQuickActions — Call / Text / Email tile buttons.
 *
 * Shared between JobCard (list view) and ViewJob's header card so the
 * contact shortcuts look identical from both entry points. Colour-coded
 * so the eye doesn't have to read the label — Call = green, Text =
 * blue, Email = amber — matching the contact treatment on the old
 * customer-preview card.
 *
 * Each tile renders only when the relevant field is present on the
 * job; if nothing's present, the whole row renders nothing.
 */

import React from 'react';
import { View, StyleSheet, Pressable, Linking, Platform, Alert } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors } from '../theme';
import { selectionTap } from '../utils/haptics';

interface ContactQuickActionsProps {
  phone?: string;
  email?: string;
  address?: string;
  /** Compact mode omits labels and uses smaller tiles — for dense
   *  list cards where vertical space is tight. */
  compact?: boolean;
}

export function ContactQuickActions({
  phone,
  email,
  address,
  compact = false,
}: ContactQuickActionsProps) {
  const hasPhone = !!(phone && phone.trim());
  const hasEmail = !!(email && email.trim());
  const hasAddress = !!(address && address.trim());
  if (!hasPhone && !hasEmail && !hasAddress) return null;

  const sizeStyle = compact ? styles.tileCompact : styles.tile;
  const labelStyle = compact ? styles.labelCompact : styles.label;
  const iconSize = compact ? 18 : 20;

  const stopAndTap = (fn: () => void) => (e: any) => {
    e?.stopPropagation?.();
    selectionTap();
    fn();
  };

  const handleCall = () => {
    if (!phone) return;
    Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`).catch(() =>
      Alert.alert("Couldn't call", 'Copy the number instead.'),
    );
  };
  const handleText = () => {
    if (!phone) return;
    Linking.openURL(`sms:${phone.replace(/\s+/g, '')}`).catch(() =>
      Alert.alert("Couldn't open SMS", 'Copy the number instead.'),
    );
  };
  const handleEmail = () => {
    if (!email) return;
    Linking.openURL(`mailto:${email}`).catch(() =>
      Alert.alert("Couldn't open mail", 'Copy the address instead.'),
    );
  };
  const handleMap = () => {
    if (!address) return;
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?q=${encodeURIComponent(address)}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    Linking.openURL(url).catch(() =>
      Alert.alert("Couldn't open Maps", 'Copy the address instead.'),
    );
  };

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {hasPhone ? (
        <Tile
          icon="phone"
          label="Call"
          labelColor={colors.success}
          bgColor={colors.successBg}
          borderColor={colors.success + '55'}
          iconSize={iconSize}
          sizeStyle={sizeStyle}
          labelStyle={labelStyle}
          showLabel={!compact}
          compact={compact}
          onPress={stopAndTap(handleCall)}
        />
      ) : null}
      {hasPhone ? (
        <Tile
          icon="message-text"
          label="Text"
          labelColor={colors.info}
          bgColor={colors.infoBg}
          borderColor={colors.info + '55'}
          iconSize={iconSize}
          sizeStyle={sizeStyle}
          labelStyle={labelStyle}
          showLabel={!compact}
          compact={compact}
          onPress={stopAndTap(handleText)}
        />
      ) : null}
      {hasEmail ? (
        <Tile
          icon="email"
          label="Email"
          labelColor={colors.warning}
          bgColor={colors.warningBg}
          borderColor={colors.warning + '55'}
          iconSize={iconSize}
          sizeStyle={sizeStyle}
          labelStyle={labelStyle}
          showLabel={!compact}
          compact={compact}
          onPress={stopAndTap(handleEmail)}
        />
      ) : null}
      {hasAddress ? (
        <Tile
          icon="map-marker"
          label="Map"
          labelColor={colors.primary}
          bgColor={colors.primaryBg}
          borderColor={colors.primary + '55'}
          iconSize={iconSize}
          sizeStyle={sizeStyle}
          labelStyle={labelStyle}
          showLabel={!compact}
          compact={compact}
          onPress={stopAndTap(handleMap)}
        />
      ) : null}
    </View>
  );
}

interface TileProps {
  icon: string;
  label: string;
  labelColor: string;
  bgColor: string;
  borderColor: string;
  iconSize: number;
  sizeStyle: any;
  labelStyle: any;
  showLabel: boolean;
  compact: boolean;
  onPress: (e: any) => void;
}

function Tile({
  icon,
  label,
  labelColor,
  bgColor,
  borderColor,
  iconSize,
  sizeStyle,
  labelStyle,
  showLabel,
  compact,
  onPress,
}: TileProps) {
  return (
    <View style={compact ? styles.colCompact : styles.col}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          sizeStyle,
          { backgroundColor: bgColor, borderColor },
          pressed && styles.pressed,
        ]}
      >
        <MaterialCommunityIcons
          name={icon as any}
          size={iconSize}
          color={labelColor}
        />
      </Pressable>
      {showLabel ? (
        <Text style={[labelStyle, { color: labelColor }]}>{label}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },
  rowCompact: {
    marginTop: 4,
  },
  col: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  colCompact: {
    // Still flex:1 so tiles spread evenly across the card width
    // regardless of count (1, 2, 3, or 4). Fixes the clustered-
    // to-left look on cards where only a subset of contact
    // channels are populated.
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  tileCompact: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.75,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  labelCompact: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
