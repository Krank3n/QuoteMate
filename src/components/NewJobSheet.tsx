/**
 * NewJobSheet
 * Bottom sheet that captures the minimum info needed to create a Job
 * (customer name + job address + job title) and drops the tradie straight
 * into the quote wizard. The wizard's draft will already carry the created
 * jobId, so saveDraft / saveQuote in useStore will see it and no-op the
 * ensureJobForQuote path.
 *
 * Keeping this as a sheet (rather than a full screen) lets it feel like a
 * quick capture step — the heavy wizard is still the place to flesh out
 * description, photos, materials, and totals.
 */

import React, { useState } from 'react';
import { View, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import { useJobStore } from '../store/useJobStore';
import { colors } from '../theme';
import { BottomSheet } from './BottomSheet';

interface NewJobSheetProps {
  visible: boolean;
  onDismiss: () => void;
}

export function NewJobSheet({ visible, onDismiss }: NewJobSheetProps) {
  const navigation = useNavigation<any>();
  const createNewQuote = useStore((s) => s.createNewQuote);
  const setCurrentQuote = useStore((s) => s.setCurrentQuote);
  const canCreateQuote = useStore((s) => s.canCreateQuote);
  const createJob = useJobStore((s) => s.createJob);

  const [customerName, setCustomerName] = useState('');
  const [jobAddress, setJobAddress] = useState('');
  const [jobName, setJobName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (!visible) {
      // Reset on close so next open starts clean.
      setCustomerName('');
      setJobAddress('');
      setJobName('');
      setSubmitting(false);
    }
  }, [visible]);

  const canSubmit =
    !submitting &&
    (customerName.trim().length > 0 ||
      jobAddress.trim().length > 0 ||
      jobName.trim().length > 0);

  const handleCreate = async () => {
    if (!canSubmit) return;
    if (!canCreateQuote()) {
      onDismiss();
      navigation.navigate('Paywall');
      return;
    }
    setSubmitting(true);

    try {
      const job = await createJob({
        customerName: customerName.trim() || 'Unknown customer',
        jobAddress: jobAddress.trim(),
        name: jobName.trim() || 'New job',
      });

      // Seed the wizard's draft Quote with the Job's customer + job-name so
      // the wizard screens are pre-filled. Stamping jobId up front means the
      // save path's ensureJobForQuote() will no-op — no duplicate Job is
      // created downstream.
      createNewQuote();
      const state = useStore.getState();
      const draft = state.currentQuote;
      if (draft) {
        setCurrentQuote({
          ...draft,
          customerName: job.customerName,
          jobAddress: job.jobAddress,
          job: {
            ...draft.job,
            name: job.name,
          },
          jobId: job.id,
        });
      }

      onDismiss();
      navigation.navigate('NewQuote');
    } catch (err) {
      Alert.alert('Error', 'Couldn’t start the job. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Start a new job">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Text style={styles.helper}>
            Capture the basics now — you can flesh everything else out in the quote.
          </Text>

          <TextInput
            mode="outlined"
            label="Customer name"
            value={customerName}
            onChangeText={setCustomerName}
            style={styles.input}
            autoCapitalize="words"
            returnKeyType="next"
          />

          <TextInput
            mode="outlined"
            label="Job address"
            value={jobAddress}
            onChangeText={setJobAddress}
            style={styles.input}
            autoCapitalize="words"
          />

          <TextInput
            mode="outlined"
            label="Job title"
            value={jobName}
            onChangeText={setJobName}
            placeholder="e.g. Jones pergola"
            style={styles.input}
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />

          <Button
            mode="contained"
            onPress={handleCreate}
            disabled={!canSubmit}
            loading={submitting}
            style={styles.submit}
            contentStyle={styles.submitContent}
          >
            Start quote
          </Button>
        </View>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingVertical: 8,
    gap: 12,
  },
  helper: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.surface,
  },
  submit: {
    marginTop: 8,
    borderRadius: 12,
  },
  submitContent: {
    paddingVertical: 6,
  },
});
