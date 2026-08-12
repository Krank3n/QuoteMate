import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Title, Text, IconButton } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useThemeColors } from '../../theme';

interface DocumentHeaderProps {
  title: string;
  subtitle?: string;
  onBackPress: () => void;
  rightIcon: string;
  onRightPress: () => void;
  rightDisabled?: boolean;
}

export function DocumentHeader({
  title,
  subtitle,
  onBackPress,
  rightIcon,
  onRightPress,
  rightDisabled,
}: DocumentHeaderProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <IconButton
        icon="arrow-left"
        size={24}
        iconColor={themeColors.onAccent}
        onPress={onBackPress}
      />
      <View style={styles.titleContainer}>
        <Title style={styles.title}>{title}</Title>
        {subtitle ? (
          <Text style={styles.subtitle}>{subtitle}</Text>
        ) : null}
      </View>
      <IconButton
        icon={rightIcon}
        size={24}
        iconColor={themeColors.onAccent}
        onPress={onRightPress}
        disabled={rightDisabled}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
    backgroundColor: t.colors.accent,
  },
  titleContainer: {
    alignItems: 'center',
  },
  title: {
    color: t.colors.onAccent,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 12,
    color: t.colors.onAccent,
    fontWeight: '600',
  },
}));
