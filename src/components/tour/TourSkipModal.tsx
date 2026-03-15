/**
 * Tour Skip Confirmation Modal
 * Aussie-themed "are you sure?" when user tries to bail from the guided tour.
 * Uses native Modal to render ABOVE the tour spotlight overlay (which uses Portal).
 */

import React from 'react';
import { Modal, View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Button } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme';

interface TourSkipModalProps {
  visible: boolean;
  onResume: () => void;
  onConfirmSkip: () => void;
}

export function TourSkipModal({ visible, onResume, onConfirmSkip }: TourSkipModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onResume}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <MaterialCommunityIcons name="alert-circle-outline" size={48} color="#eab308" style={styles.icon} />
          <Text style={styles.title}>Sure you want to bail?</Text>
          <Text style={styles.message}>
            We're just getting to the good stuff! Stick around to see how quick it is to
            finish Davo's quote. If you skip now, the demo resets, but you can always suss
            the app out on your own.
          </Text>
          <Button
            mode="contained"
            onPress={onResume}
            style={styles.primaryButton}
            labelStyle={styles.primaryLabel}
          >
            Nah, keep going
          </Button>
          <Button
            mode="contained"
            onPress={onConfirmSkip}
            style={styles.secondaryButton}
            buttonColor={colors.surface}
            textColor={colors.text}
          >
            Yeah, skip the tour
          </Button>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  icon: {
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  message: {
    fontSize: 14,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  primaryButton: {
    width: '100%',
    marginBottom: 12,
    borderRadius: 12,
  },
  primaryLabel: {
    color: colors.white,
  },
  secondaryButton: {
    width: '100%',
    borderRadius: 12,
  },
});
