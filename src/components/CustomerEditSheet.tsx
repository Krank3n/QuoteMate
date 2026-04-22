/**
 * CustomerEditSheet
 *
 * Small bottom sheet for editing the customer fields on a Job — used
 * when the Job was auto-created from a draft quote with no customer
 * info yet ("Unknown customer"). Four fields, save → useJobStore.saveJob.
 *
 * Independent of the wizard's CustomerDetailsScreen on purpose: editing
 * the Job's customer should update the Job, not drag the tradie into
 * a quote-wizard context.
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, Button } from 'react-native-paper';

import type { Job } from '../../shared/job/types';
import { colors } from '../theme';
import { useJobStore } from '../store/useJobStore';
import { BottomSheet } from './BottomSheet';

interface CustomerEditSheetProps {
  visible: boolean;
  onDismiss: () => void;
  job: Job;
}

export function CustomerEditSheet({ visible, onDismiss, job }: CustomerEditSheetProps) {
  const saveJob = useJobStore((s) => s.saveJob);

  const [name, setName] = useState(job.customerName || '');
  const [email, setEmail] = useState(job.customerEmail || '');
  const [phone, setPhone] = useState(job.customerPhone || '');
  const [address, setAddress] = useState(job.jobAddress || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(
        job.customerName && job.customerName !== 'Unknown customer'
          ? job.customerName
          : '',
      );
      setEmail(job.customerEmail || '');
      setPhone(job.customerPhone || '');
      setAddress(job.jobAddress || '');
      setSaving(false);
    }
  }, [visible, job.id, job.customerName, job.customerEmail, job.customerPhone, job.jobAddress]);

  const dirty =
    (name.trim() || '') !== (job.customerName && job.customerName !== 'Unknown customer' ? job.customerName : '') ||
    (email.trim() || '') !== (job.customerEmail || '') ||
    (phone.trim() || '') !== (job.customerPhone || '') ||
    (address.trim() || '') !== (job.jobAddress || '');

  const canSubmit = !saving && (!!name.trim() || !!address.trim() || !!email.trim() || !!phone.trim());

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveJob({
        ...job,
        customerName: name.trim() || job.customerName,
        customerEmail: email.trim() || undefined,
        customerPhone: phone.trim() || undefined,
        jobAddress: address.trim() || job.jobAddress,
      });
      onDismiss();
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Customer details" scrollable>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <TextInput
            mode="outlined"
            label="Customer name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            returnKeyType="next"
            style={styles.input}
          />
          <TextInput
            mode="outlined"
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="next"
            style={styles.input}
          />
          <TextInput
            mode="outlined"
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            returnKeyType="next"
            style={styles.input}
          />
          <TextInput
            mode="outlined"
            label="Job address"
            value={address}
            onChangeText={setAddress}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={dirty && canSubmit ? handleSave : undefined}
            style={styles.input}
          />

          <Button
            mode="contained"
            onPress={handleSave}
            disabled={!dirty || !canSubmit}
            loading={saving}
            style={styles.submit}
            contentStyle={styles.submitContent}
          >
            Save
          </Button>
        </View>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingVertical: 4,
    gap: 10,
  },
  input: {
    backgroundColor: colors.surface,
  },
  submit: {
    marginTop: 8,
    borderRadius: 12,
  },
  submitContent: {
    paddingVertical: 4,
  },
});
