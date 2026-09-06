/**
 * Cancellation Reason Modal
 * Collects feedback when user cancels their subscription
 */

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
// A paper <Modal> renders through <Portal> into the app's own React tree — the
// same window — so the keyboard provider reaches it and the controller's
// KeyboardAvoidingView works here. (A react-native <Modal> is a separate
// window and needs hooks/useKeyboardHeight instead.) Paper does no keyboard
// avoidance of its own. See components/keyboardAvoidance.guard.test.ts.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import {
  Portal,
  Modal,
  Surface,
  Text,
  Button,
  RadioButton,
  TextInput,
} from 'react-native-paper';
import { makeStyles, useThemeColors } from '../theme';

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
  const styles = useStyles();
  const themeColors = useThemeColors();
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
        <KeyboardAvoidingView
          behavior="padding"
          // automaticOffset: the lift is computed from onLayout's y, which is
          // relative to the PARENT. Behind a nav header or inside a centred modal
          // that reads far too small and the view under-lifts — which is why iOS
          // stayed covered while Android (container at window top) looked fine.
          // This asks native for the true screen position instead.
          automaticOffset
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
                      color={themeColors.accentText}
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
                buttonColor={themeColors.error}
                style={styles.button}
              >
                Cancel Subscription
              </Button>
            </View>
          </ScrollView>
        </Surface>
        </KeyboardAvoidingView>
      </Modal>
    </Portal>
  );
}

const useStyles = makeStyles((t) => ({
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
    backgroundColor: t.colors.surfaceRaised,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
    color: t.colors.text,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 24,
    color: t.colors.textMuted,
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
    color: t.colors.textMuted,
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
}));
