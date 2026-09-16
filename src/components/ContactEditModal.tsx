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
// A paper <Modal> renders through <Portal> into the app's own React tree — the
// same window — so the keyboard provider reaches it and the controller's
// KeyboardAvoidingView works here. (A react-native <Modal> is a separate
// window and needs hooks/useKeyboardHeight instead.) Paper does no keyboard
// avoidance of its own. See components/keyboardAvoidance.guard.test.ts.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button, Modal, Portal, Text, TextInput } from 'react-native-paper';

import { makeStyles, useThemeColors } from '../theme';
import type { Contact } from '../types';
import { isEmailAddress } from '../utils/sendFlow';

/** How many addresses a customer can have on top of the primary one. */
export const MAX_ADDITIONAL_EMAILS = 3;

export interface ContactFormValues {
  name: string;
  businessName?: string;
  email?: string;
  /**
   * Extra addresses that get every quote and invoice — an accounts
   * department, a second owner. Blanks are dropped on save.
   */
  additionalEmails?: string[];
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
    additionalEmails: (initial?.additionalEmails ?? []).slice(0, MAX_ADDITIONAL_EMAILS),
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
  // Which extra-email rows hold something that isn't an address. Checked on
  // Save, not per keystroke, so a half-typed address isn't shouted at.
  const [badExtraEmails, setBadExtraEmails] = useState<number[]>([]);

  // Re-seed whenever the modal opens, so editing contact A then contact B
  // doesn't show A's details.
  useEffect(() => {
    if (visible) {
      setValues(seed(initial));
      setBadExtraEmails([]);
    }
  }, [visible, initial]);

  const set = <K extends keyof ContactFormValues>(key: K, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const extraEmails = values.additionalEmails ?? [];
  const setExtraEmail = (index: number, value: string) => {
    setValues((prev) => {
      const next = [...(prev.additionalEmails ?? [])];
      next[index] = value;
      return { ...prev, additionalEmails: next };
    });
    setBadExtraEmails((prev) => prev.filter((i) => i !== index));
  };
  const addExtraEmail = () =>
    setValues((prev) => {
      const current = prev.additionalEmails ?? [];
      if (current.length >= MAX_ADDITIONAL_EMAILS) return prev;
      return { ...prev, additionalEmails: [...current, ''] };
    });
  const removeExtraEmail = (index: number) => {
    setValues((prev) => ({
      ...prev,
      additionalEmails: (prev.additionalEmails ?? []).filter((_, i) => i !== index),
    }));
    setBadExtraEmails([]);
  };

  const trimmed = (v?: string) => (v || '').trim() || undefined;

  const handleSave = () => {
    const name = (values.name || '').trim();
    if (!name) return;
    // Empty rows are just rows the tradie didn't fill in; anything else has
    // to be an address, or the send composer would prefill junk.
    const bad = extraEmails
      .map((e, i) => (e.trim() && !isEmailAddress(e) ? i : -1))
      .filter((i) => i >= 0);
    if (bad.length) {
      setBadExtraEmails(bad);
      return;
    }
    const additionalEmails = extraEmails
      .map((e) => e.trim().toLowerCase())
      .filter((e, i, all) => e && all.indexOf(e) === i);
    onSave({
      name,
      businessName: trimmed(values.businessName),
      email: trimmed(values.email),
      additionalEmails: additionalEmails.length ? additionalEmails : undefined,
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
        <KeyboardAvoidingView
          behavior="padding"
          // automaticOffset: the lift is computed from onLayout's y, which is
          // relative to the PARENT. Behind a nav header or inside a centred modal
          // that reads far too small and the view under-lifts — which is why iOS
          // stayed covered while Android (container at window top) looked fine.
          // This asks native for the true screen position instead.
          automaticOffset
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
          {extraEmails.map((extra, index) => (
            <View key={index}>
              <TextInput
                label={`Email ${index + 2}`}
                value={extra}
                onChangeText={(v) => setExtraEmail(index, v)}
                mode="outlined"
                style={styles.modalInput}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                error={badExtraEmails.includes(index)}
                right={
                  <TextInput.Icon
                    icon="close"
                    accessibilityLabel={`Remove email ${index + 2}`}
                    onPress={() => removeExtraEmail(index)}
                  />
                }
              />
              {badExtraEmails.includes(index) ? (
                <Text style={styles.fieldError}>That doesn't look like an email address.</Text>
              ) : null}
            </View>
          ))}
          {extraEmails.length < MAX_ADDITIONAL_EMAILS ? (
            <Button
              mode="text"
              compact
              icon="plus"
              onPress={addExtraEmail}
              style={styles.addEmailButton}
              accessibilityLabel="Add another email"
            >
              Add another email
            </Button>
          ) : null}
          {extraEmails.length > 0 ? (
            <Text style={styles.helper}>
              Extra addresses get every quote and invoice you send this customer — handy for
              an accounts department.
            </Text>
          ) : null}
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
        </KeyboardAvoidingView>
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
  addEmailButton: {
    alignSelf: 'flex-start',
    marginTop: -4,
    marginBottom: 8,
  },
  helper: {
    fontSize: 13,
    lineHeight: 18,
    color: t.colors.textMuted,
    marginBottom: 12,
  },
  fieldError: {
    fontSize: 13,
    color: t.colors.error,
    marginTop: -8,
    marginBottom: 12,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
}));
