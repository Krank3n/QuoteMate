/**
 * Cancellation Reason Modal
 * Collects feedback when user cancels their subscription
 */

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import {
  Portal,
  Modal,
  Surface,
  Text,
  Button,
  RadioButton,
  TextInput,
} from 'react-native-paper';
import { colors } from '../theme';

interface CancellationReasonModalProps {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: (reason: string, feedback: string) => void;
  isLoading?: boolean;
  periodEndDate?: Date;
}

const CANCELLATION_REASONS = [
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'not_using', label: 'Not using it enough' },
  { value: 'missing_features', label: 'Missing features I need' },
  { value: 'technical_issues', label: 'Technical issues' },
  { value: 'switching_competitor', label: 'Switching to a competitor' },
  { value: 'other', label: 'Other reason' },
];

export function CancellationReasonModal({
  visible,
  onDismiss,
  onConfirm,
  isLoading = false,
  periodEndDate,
}: CancellationReasonModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [feedback, setFeedback] = useState<string>('');

  // Format the period end date
  const formattedEndDate = periodEndDate
    ? periodEndDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  const handleConfirm = () => {
    if (!selectedReason) {
      return;
    }
    onConfirm(selectedReason, feedback);
  };

  const handleDismiss = () => {
    if (!isLoading) {
      setSelectedReason('');
      setFeedback('');
      onDismiss();
    }
  };

  if (Platform.OS !== 'web') {
    return null;
  }

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={handleDismiss}
        contentContainerStyle={styles.modalContainer}
      >
        <Surface style={styles.surface}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>We're sorry to see you go</Text>
            <Text style={styles.subtitle}>
              Please tell us why you're canceling. Your feedback helps us improve.
            </Text>

            <View style={styles.reasonsContainer}>
              <RadioButton.Group
                onValueChange={setSelectedReason}
                value={selectedReason}
              >
                {CANCELLATION_REASONS.map((reason) => (
                  <View key={reason.value} style={styles.reasonItem}>
                    <RadioButton.Item
                      label={reason.label}
                      value={reason.value}
                      position="leading"
                      style={styles.radioButton}
                      labelStyle={styles.radioLabel}
                      color={colors.primary}
                    />
                  </View>
                ))}
              </RadioButton.Group>
            </View>

            <TextInput
              label="Additional feedback (optional)"
              value={feedback}
              onChangeText={setFeedback}
              mode="outlined"
              multiline
              numberOfLines={4}
              placeholder="Tell us more about why you're canceling..."
              style={styles.feedbackInput}
              disabled={isLoading}
            />

            <Text style={styles.notice}>
              {formattedEndDate
                ? `Your subscription will remain active until ${formattedEndDate}.`
                : 'Your subscription will remain active until the end of your current billing period.'}
            </Text>

            <View style={styles.buttonContainer}>
              <Button
                mode="outlined"
                onPress={handleDismiss}
                disabled={isLoading}
                style={styles.button}
              >
                Keep Subscription
              </Button>
              <Button
                mode="contained"
                onPress={handleConfirm}
                disabled={!selectedReason || isLoading}
                loading={isLoading}
                buttonColor={colors.error}
                style={styles.button}
              >
                Cancel Subscription
              </Button>
            </View>
          </ScrollView>
        </Surface>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  surface: {
    width: '100%',
    maxWidth: 600,
    maxHeight: '90%',
    padding: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
    color: colors.text,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 24,
    color: colors.textMuted,
    lineHeight: 22,
  },
  reasonsContainer: {
    marginBottom: 24,
  },
  reasonItem: {
    marginBottom: 4,
  },
  radioButton: {
    paddingVertical: 4,
  },
  radioLabel: {
    fontSize: 16,
  },
  feedbackInput: {
    marginBottom: 16,
  },
  notice: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 24,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
  },
});
