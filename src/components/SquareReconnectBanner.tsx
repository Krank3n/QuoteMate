/**
 * SquareReconnectBanner
 *
 * Amber call-to-action shown whenever the backend has flagged the tradie's
 * Square connection as disconnected (e.g. token_refresh_failed). Tapping
 * takes them straight to SquareIntegrationScreen to re-authorise. Without
 * this banner, a revoked connection silently stops pay-links and tap-to-pay
 * working — the tradie only finds out when a customer calls confused.
 */

import React from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { colors } from '../theme';

interface Props {
  reason?: string | null;
  /** Optional prefix, e.g. "Invoice can't accept card payments —" */
  contextMessage?: string;
}

function humanise(reason?: string | null): string {
  switch (reason) {
    case 'token_refresh_failed':
      return 'Square has signed us out. Reconnect to keep taking card payments.';
    case 'revoked':
      return 'Square access was revoked. Reconnect to resume payments.';
    default:
      return 'Your Square connection needs attention. Reconnect to resume payments.';
  }
}

export function SquareReconnectBanner({ reason, contextMessage }: Props) {
  const navigation = useNavigation<any>();
  if (!reason) return null;

  return (
    <TouchableOpacity
      style={styles.banner}
      activeOpacity={0.85}
      onPress={() => navigation.navigate('SquareIntegration' as never)}
      accessibilityRole="button"
      accessibilityLabel="Reconnect Square"
    >
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name="alert" size={20} color={colors.warning} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>
          {contextMessage ? contextMessage : 'Reconnect Square'}
        </Text>
        <Text style={styles.body}>{humanise(reason)}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.warning} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 10,
  },
  iconWrap: {
    marginRight: 10,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.warning,
    marginBottom: 2,
  },
  body: {
    fontSize: 12,
    color: colors.warning,
    lineHeight: 16,
  },
});
