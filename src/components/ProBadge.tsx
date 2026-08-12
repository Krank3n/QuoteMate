/**
 * Pro Badge Component
 * Small "PRO" label shown on premium features for free users
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { makeStyles } from '../theme';

interface ProBadgeProps {
  size?: 'small' | 'default';
}

export function ProBadge({ size = 'default' }: ProBadgeProps) {
  const styles = useStyles();

  return (
    <View style={[styles.badge, size === 'small' && styles.badgeSmall]}>
      <Text style={[styles.text, size === 'small' && styles.textSmall]}>PRO</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  badge: {
    backgroundColor: t.colors.warningSubtle,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: t.colors.warning,
  },
  badgeSmall: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  text: {
    fontSize: 10,
    fontWeight: '800',
    color: t.colors.warning,
    letterSpacing: 0.5,
  },
  textSmall: {
    fontSize: 8,
  },
}));
