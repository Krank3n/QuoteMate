/**
 * Edit Supplier Screen
 *
 * Single full-screen form for creating or editing a supplier:
 *  - Name (renames any saved-items group with the old name in lockstep)
 *  - Contact details: contact person, phone, email, address, website, notes
 *
 * Reached from the Supplier Book — either via the pencil button on a section
 * header (passes `supplierName` route param) or the "Add Supplier" button at
 * the top of the list (no params).
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Text, Surface, TextInput, ActivityIndicator } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors } from '../../theme';
import { SupplierGroup } from '../../types';
import {
  loadGroups,
  saveGroup,
  deleteGroup,
  getSupplierGroupByName,
} from '../../services/supplierGroupService';
import { renameStoreOnFavorites } from '../../services/materialFavorites';
import { WebContainer } from '../../components/WebContainer';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

interface SupplierPrefill {
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
  notes?: string;
}

export function EditSupplierScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const params = (route.params as
    | { supplierName?: string; prefill?: SupplierPrefill }
    | undefined) || {};
  const supplierNameParam = params.supplierName;
  const prefillParam = params.prefill;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<SupplierGroup | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const [notes, setNotes] = useState('');

  const isEditing = !!original;

  // Load existing supplier (if any) on mount. When `prefill` is provided
  // (e.g. from an OCR'd contact-only photo), we use it to seed any field the
  // existing record hasn't already filled in — never overwriting user data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (supplierNameParam) {
        const existing = await getSupplierGroupByName(supplierNameParam);
        if (cancelled) return;
        if (existing) {
          setOriginal(existing);
          setName(existing.name);
          setContactPerson(existing.contactPerson || prefillParam?.contactPerson || '');
          setPhone(existing.phone || prefillParam?.phone || '');
          setEmail(existing.email || prefillParam?.email || '');
          setAddress(existing.address || prefillParam?.address || '');
          setWebsite(existing.searchUrl || prefillParam?.website || '');
          setNotes(existing.notes || prefillParam?.notes || '');
        } else {
          // No SupplierGroup record yet — pre-fill the name plus any prefill
          // values so the user can review and save.
          setName(supplierNameParam);
          if (prefillParam) {
            setContactPerson(prefillParam.contactPerson || '');
            setPhone(prefillParam.phone || '');
            setEmail(prefillParam.email || '');
            setAddress(prefillParam.address || '');
            setWebsite(prefillParam.website || '');
            setNotes(prefillParam.notes || '');
          }
        }
      } else if (prefillParam) {
        // No name provided — still seed the contact fields so the user only
        // needs to fill in the supplier name.
        setContactPerson(prefillParam.contactPerson || '');
        setPhone(prefillParam.phone || '');
        setEmail(prefillParam.email || '');
        setAddress(prefillParam.address || '');
        setWebsite(prefillParam.website || '');
        setNotes(prefillParam.notes || '');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supplierNameParam, prefillParam]);

  // Header title
  useEffect(() => {
    navigation.setOptions({
      title: isEditing ? 'Edit Supplier' : 'New Supplier',
    });
  }, [navigation, isEditing]);

  const trimOrUndef = (v: string) => (v.trim() ? v.trim() : undefined);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Enter Name', 'Please enter a supplier name');
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();

      // If renaming an existing supplier, also rename any saved-items group
      // under the old name so the join key stays in sync.
      if (original && original.name !== trimmedName) {
        await renameStoreOnFavorites(original.name, trimmedName);

        // If a different SupplierGroup already exists under the new name,
        // delete the old record so we don't end up with two.
        const collision = await getSupplierGroupByName(trimmedName);
        if (collision && collision.id !== original.id) {
          await deleteGroup(original.id);
        }
      }

      const record: SupplierGroup = original
        ? {
            ...original,
            name: trimmedName,
            searchUrl: trimOrUndef(website),
            contactPerson: trimOrUndef(contactPerson),
            phone: trimOrUndef(phone),
            email: trimOrUndef(email),
            address: trimOrUndef(address),
            notes: trimOrUndef(notes),
            updatedAt: now,
          }
        : {
            id: generateId(),
            name: trimmedName,
            searchUrl: trimOrUndef(website),
            contactPerson: trimOrUndef(contactPerson),
            phone: trimOrUndef(phone),
            email: trimOrUndef(email),
            address: trimOrUndef(address),
            notes: trimOrUndef(notes),
            sortOrder: (await loadGroups()).length,
            createdAt: now,
            updatedAt: now,
          };

      await saveGroup(record);
      navigation.goBack();
    } catch (err) {
      Alert.alert('Save failed', 'Could not save supplier. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!original) return;
    if (original.isDefault) {
      Alert.alert('Cannot Delete', 'Built-in suppliers cannot be deleted.');
      return;
    }
    Alert.alert(
      'Delete Supplier',
      `Delete "${original.name}"? This only removes the contact details — saved items keep their supplier label.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteGroup(original.id);
            navigation.goBack();
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <WebContainer>
          <Surface style={styles.formCard}>
            <TextInput
              label="Supplier Name"
              value={name}
              onChangeText={setName}
              mode="outlined"
              style={styles.input}
              placeholder="e.g. Local Timber Yard"
            />
            <TextInput
              label="Contact Person (optional)"
              value={contactPerson}
              onChangeText={setContactPerson}
              mode="outlined"
              style={styles.input}
              placeholder="e.g. Dave (Account Manager)"
            />
            <TextInput
              label="Phone (optional)"
              value={phone}
              onChangeText={setPhone}
              mode="outlined"
              style={styles.input}
              placeholder="e.g. 0412 345 678"
              keyboardType="phone-pad"
            />
            <TextInput
              label="Email (optional)"
              value={email}
              onChangeText={setEmail}
              mode="outlined"
              style={styles.input}
              placeholder="e.g. sales@timberyard.com.au"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TextInput
              label="Address (optional)"
              value={address}
              onChangeText={setAddress}
              mode="outlined"
              style={styles.input}
              placeholder="e.g. 12 Smith St, Melbourne"
              multiline
            />
            <TextInput
              label="Website URL (optional)"
              value={website}
              onChangeText={setWebsite}
              mode="outlined"
              style={styles.input}
              placeholder="e.g. https://mytimbersupplier.com.au"
              autoCapitalize="none"
              keyboardType="url"
            />
            <TextInput
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              mode="outlined"
              style={styles.input}
              placeholder="e.g. Trade discount on bulk orders"
              multiline
            />
          </Surface>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.btnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {isEditing && original && !original.isDefault && (
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
              <MaterialCommunityIcons name="delete-outline" size={18} color={colors.error} />
              <Text style={styles.deleteBtnText}>Delete supplier</Text>
            </TouchableOpacity>
          )}
        </WebContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  formCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: colors.surface,
    elevation: 1,
  },
  input: {
    marginBottom: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textMuted,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
    paddingVertical: 12,
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.error,
  },
});
