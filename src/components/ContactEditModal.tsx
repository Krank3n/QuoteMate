/**
 * ContactEditModal
 *
 * The one form for customer details. Extracted from ContactsScreen so the
 * Customer screen edits the same fields the same way — a second form would
 * drift, and the two screens write to the same Contact record.
 *
 * `address` here is the CUSTOMER's address (where they are / where to post),
 * which is NOT the same thing as a job's site address. A customer can have
 * five sites. Callers must never fan this value out onto Job.jobAddress; see
 * planCustomerEdit, which deliberately leaves site addresses alone.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Modal, Portal, Text, TextInput } from 'react-native-paper';

import { makeStyles, useThemeColors } from '../theme';
import type { Contact } from '../types';

export interface ContactFormValues {
  name: string;
  businessName?: string;
  email?: string;
  phone?: string;
  /** The customer's own address — never a job site. */
  address?: string;
  website?: string;
  notes?: string;
}

interface ContactEditModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSave: (values: ContactFormValues) => void;
  /** Seed values. Pass a Contact to edit, or partial details to pre-fill. */
  initial?: Partial<ContactFormValues> | Contact | null;
  title?: string;
  /**
   * Only pass this where deleting is genuinely what happens. The Customer
   * screen omits it: removing the contact there would leave every job in
   * place, so a Delete button would promise something it doesn't do.
   */
  onDelete?: () => void;
}

function seed(initial?: Partial<ContactFormValues> | Contact | null): ContactFormValues {
  return {
    name: initial?.name ?? '',
    businessName: initial?.businessName ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    address: initial?.address ?? '',
    website: initial?.website ?? '',
    notes: initial?.notes ?? '',
  };
}

export function ContactEditModal({
  visible,
  onDismiss,
  onSave,
  initial,
  title,
  onDelete,
}: ContactEditModalProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [values, setValues] = useState<ContactFormValues>(() => seed(initial));

  // Re-seed whenever the modal opens, so editing contact A then contact B
  // doesn't show A's details.
  useEffect(() => {
    if (visible) setValues(seed(initial));
  }, [visible, initial]);

  const set = <K extends keyof ContactFormValues>(key: K, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const trimmed = (v?: string) => (v || '').trim() || undefined;

  const handleSave = () => {
    const name = (values.name || '').trim();
    if (!name) return;
    onSave({
      name,
      businessName: trimmed(values.businessName),
      email: trimmed(values.email),
      phone: trimmed(values.phone),
      address: trimmed(values.address),
      website: trimmed(values.website),
      notes: trimmed(values.notes),
    });
  };

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={styles.modalContainer}
      >
        <Text style={styles.modalTitle}>{title ?? 'Edit customer'}</Text>
        {/* flexGrow 0 so the modal hugs its fields instead of always standing
            80% tall with dead space under the buttons; flexShrink 1 so the
            fields still scroll when they genuinely don't fit (which is why the
            ScrollView is here — without it Website and Notes were unreachable
            on a short screen). */}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={styles.fields}
          contentContainerStyle={styles.fieldsContent}
        >
          <TextInput
            label="Name *"
            value={values.name}
            onChangeText={(v) => set('name', v)}
            mode="outlined"
            style={styles.modalInput}
            autoCapitalize="words"
          />
          <TextInput
            label="Business Name"
            value={values.businessName}
            onChangeText={(v) => set('businessName', v)}
            mode="outlined"
            style={styles.modalInput}
            autoCapitalize="words"
          />
          <TextInput
            label="Email"
            value={values.email}
            onChangeText={(v) => set('email', v)}
            mode="outlined"
            style={styles.modalInput}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            label="Phone"
            value={values.phone}
            onChangeText={(v) => set('phone', v)}
            mode="outlined"
            style={styles.modalInput}
            keyboardType="phone-pad"
          />
          <TextInput
            // Labelled to distinguish it from each job's site address, which
            // this never touches.
            label="Customer address"
            value={values.address}
            onChangeText={(v) => set('address', v)}
            mode="outlined"
            style={styles.modalInput}
            multiline
          />
          <TextInput
            label="Website"
            value={values.website}
            onChangeText={(v) => set('website', v)}
            mode="outlined"
            style={styles.modalInput}
            keyboardType="url"
            autoCapitalize="none"
          />
          <TextInput
            label="Notes"
            value={values.notes}
            onChangeText={(v) => set('notes', v)}
            mode="outlined"
            style={styles.modalInput}
            multiline
          />
        </ScrollView>
        <View style={styles.modalButtons}>
          <Button mode="text" onPress={onDismiss}>
            Cancel
          </Button>
          {onDelete ? (
            <Button mode="text" textColor={themeColors.error} onPress={onDelete}>
              Delete
            </Button>
          ) : null}
          <Button
            mode="contained"
            buttonColor={themeColors.accent}
            textColor={themeColors.onAccent}
            onPress={handleSave}
            disabled={!(values.name || '').trim()}
          >
            Save
          </Button>
        </View>
      </Modal>
    </Portal>
  );
}

const useStyles = makeStyles((t) => ({
  modalContainer: {
    backgroundColor: t.colors.surfaceRaised,
    margin: 20,
    padding: 20,
    borderRadius: 16,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: t.colors.text,
    marginBottom: 16,
  },
  fields: {
    flexGrow: 0,
    flexShrink: 1,
  },
  fieldsContent: {
    paddingBottom: 4,
  },
  modalInput: {
    marginBottom: 12,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
}));
