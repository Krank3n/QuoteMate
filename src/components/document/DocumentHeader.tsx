import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Title, Text, IconButton } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';

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
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <IconButton
        icon="arrow-left"
        size={24}
        iconColor={colors.white}
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
        iconColor={colors.white}
        onPress={onRightPress}
        disabled={rightDisabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
    backgroundColor: colors.primary,
  },
  titleContainer: {
    alignItems: 'center',
  },
  title: {
    color: colors.white,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '600',
  },
});
