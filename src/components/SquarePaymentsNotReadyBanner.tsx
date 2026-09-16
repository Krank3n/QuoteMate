/**
 * SquarePaymentsNotReadyBanner
 *
 * Shown on the Square settings screen when the backend's readiness verdict
 * says the connected Square account can't take card payments (never
 * activated, inactive, or not an Australian account). Without it a tradie
 * connects, sees "Connected", and ships invoices whose Pay Now button opens
 * Square's "This business is currently not accepting payments" page. The
 * server refuses to mint while the verdict stands; this is the only place
 * the tradie learns why. Sibling of SquareReconnectBanner, same styling.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { makeStyles, useThemeColors } from '../theme';
import { squareNotReadyCopy, type SquarePaymentReadiness } from '../utils/squareReadinessCopy';

interface Props {
  readiness: SquarePaymentReadiness | null | undefined;
  merchantName?: string | null;
  /** Re-runs the connection check; the server re-asks Square when it's due. */
  onCheckAgain: () => void;
  checking?: boolean;
}

export function SquarePaymentsNotReadyBanner({ readiness, merchantName, onCheckAgain, checking }: Props) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  if (!readiness || readiness.ready !== false) return null;

  const copy = squareNotReadyCopy(readiness, merchantName);

  return (
    <View style={styles.banner} accessibilityRole="alert" testID="square-not-ready-banner">
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name="credit-card-off-outline" size={20} color={themeColors.warning} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
          <Text style={styles.action}>{copy.action}</Text>
        </View>
      </View>
      <Button
        mode="outlined"
        compact
        onPress={onCheckAgain}
        loading={!!checking}
        disabled={!!checking}
        textColor={themeColors.warning}
        style={styles.button}
        icon="refresh"
      >
        Check again
      </Button>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  banner: {
    backgroundColor: t.colors.warningSubtle,
    borderLeftWidth: 4,
    borderLeftColor: t.colors.warning,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconWrap: {
    marginRight: 10,
    paddingTop: 1,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.warning,
    marginBottom: 2,
  },
  body: {
    fontSize: 12,
    color: t.colors.warning,
    lineHeight: 16,
  },
  action: {
    fontSize: 12,
    fontWeight: '600',
    color: t.colors.warning,
    lineHeight: 16,
    marginTop: 6,
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderColor: t.colors.warning,
  },
}));
