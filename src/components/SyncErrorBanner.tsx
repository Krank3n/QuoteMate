/**
 * Sync Error Banner
 *
 * Surfaces a recent Firestore sync failure to the user. The original "changes
 * won't stick" bug went unnoticed for a long time because every sync failure
 * was silently swallowed — this banner exists so the next regression of that
 * kind is loud, not quiet. The user can dismiss it; the next successful sync
 * for the same record clears it automatically.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useStore } from '../store/useStore';
import { makeStyles, useThemeColors } from '../theme';

export function SyncErrorBanner() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const lastSyncError = useStore((s) => s.lastSyncError);
  const clearSyncError = useStore((s) => s.clearSyncError);

  if (!lastSyncError) return null;

  const label =
    lastSyncError.kind === 'invoice'
      ? 'invoice'
      : lastSyncError.kind === 'favorite'
      ? 'saved item'
      : 'quote';

  return (
    <Surface style={styles.banner} elevation={2}>
      <MaterialCommunityIcons
        name="cloud-off-outline"
        size={22}
        color={themeColors.warning}
        style={styles.icon}
      />
      <View style={styles.body}>
        <Text style={styles.title}>Latest {label} hasn't synced to the cloud</Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          Your changes are saved on this device. They'll sync once your connection's back.
        </Text>
      </View>
      <TouchableOpacity
        onPress={clearSyncError}
        accessibilityLabel="Dismiss sync warning"
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
        <MaterialCommunityIcons name="close" size={20} color={themeColors.textMuted} />
      </TouchableOpacity>
    </Surface>
  );
}

const useStyles = makeStyles((t) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.warningSubtle,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.colors.warning,
  },
  icon: {
    marginRight: 12,
  },
  body: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    color: t.colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  subtitle: {
    color: t.colors.textMuted,
    fontSize: 12,
  },
}));
