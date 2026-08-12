/**
 * SendGateModal — the hard gate that fires when a free-tier user (trial
 * expired, no Square) tries to send a quote or invoice. By the time they
 * reach this modal they've already invested time building the document
 * (sunk-cost flow), so the copy frames each path as a no-brainer rather
 * than a wall.
 *
 * Two paths:
 *   • Send instantly (free) — connect Square. 1.7% platform fee added on
 *     top of Square's standard card processing rate.
 *   • Upgrade to Pro — $49/mo. Send unlimited, any payment method.
 */

import React from 'react';
import { View, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Text, Surface, Button } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { makeStyles, useThemeColors } from '../theme';

interface SendGateModalProps {
  visible: boolean;
  onDismiss: () => void;
  onConnectSquare: () => void;
  onUpgrade: () => void;
}

export function SendGateModal({
  visible,
  onDismiss,
  onConnectSquare,
  onUpgrade,
}: SendGateModalProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <Surface style={styles.card} elevation={4}>
          <TouchableOpacity style={styles.closeButton} onPress={onDismiss}>
            <MaterialCommunityIcons name="close" size={20} color={themeColors.textSecondary} />
          </TouchableOpacity>

          <Text style={styles.title}>You're ready to send</Text>
          <Text style={styles.subtitle}>Pick how you'd like to get paid.</Text>

          <Surface style={styles.option} elevation={1}>
            <View style={styles.optionHeader}>
              <View style={[styles.iconCircle, { backgroundColor: themeColors.accentSubtle }]}>
                <MaterialCommunityIcons name="bank-outline" size={20} color={themeColors.accentText} />
              </View>
              <View style={styles.optionHeaderText}>
                <Text style={styles.optionTitle}>Send instantly</Text>
                <Text style={styles.optionBadge}>Free</Text>
              </View>
            </View>
            <Text style={styles.optionBody}>
              Connect Square — your customer pays online with a card or Apple Pay.
              A small platform fee (1.7%) is added to their bill on payment.
            </Text>
            <Button
              mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent}
              onPress={onConnectSquare}
              style={styles.optionButton}
              icon="bank-outline"
            >
              Connect Square
            </Button>
          </Surface>

          <Surface style={styles.option} elevation={1}>
            <View style={styles.optionHeader}>
              <View style={[styles.iconCircle, { backgroundColor: themeColors.accentSubtle }]}>
                <MaterialCommunityIcons name="crown-outline" size={20} color={themeColors.accentText} />
              </View>
              <View style={styles.optionHeaderText}>
                <Text style={styles.optionTitle}>Upgrade to Pro</Text>
                <Text style={styles.optionBadge}>$49/mo</Text>
              </View>
            </View>
            <Text style={styles.optionBody}>
              Send unlimited quotes and invoices. Use any payment method —
              bank, PayID, PayPal, or Square.
            </Text>
            <Button
              mode="outlined"
              onPress={onUpgrade}
              style={styles.optionButton}
              icon="crown-outline"
            >
              Upgrade
            </Button>
          </Surface>
        </Surface>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 16,
    padding: 20,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: t.colors.text,
    marginBottom: 4,
    marginTop: 4,
  },
  subtitle: {
    fontSize: 13,
    color: t.colors.textSecondary,
    marginBottom: 16,
  },
  option: {
    backgroundColor: t.colors.bg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  optionHeaderText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.text,
  },
  optionBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: t.colors.accentText,
    backgroundColor: t.colors.accentSubtle,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  optionBody: {
    fontSize: 13,
    color: t.colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  optionButton: {
    width: '100%',
  },
}));
