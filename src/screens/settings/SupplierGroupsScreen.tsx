/**
 * Supplier Groups Screen
 * Manage user-defined supplier groups for material search
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {
  Text,
  Surface,
  TextInput,
  Divider,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../../theme';
import { SupplierGroup } from '../../types';
import {
  loadGroups,
  saveGroup,
  deleteGroup,
} from '../../services/supplierGroupService';
import { WebContainer } from '../../components/WebContainer';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export function SupplierGroupsScreen() {
  const [groups, setGroups] = useState<SupplierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SupplierGroup | null>(null);
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');

  useFocusEffect(
    useCallback(() => {
      loadGroups().then(g => {
        setGroups(g);
        setLoading(false);
      });
    }, [])
  );

  const handleSave = async () => {
    if (!formName.trim()) {
      Alert.alert('Enter Name', 'Please enter a supplier group name');
      return;
    }

    const now = new Date().toISOString();
    const group: SupplierGroup = editingGroup
      ? { ...editingGroup, name: formName.trim(), searchUrl: formUrl.trim() || undefined, updatedAt: now }
      : {
          id: generateId(),
          name: formName.trim(),
          searchUrl: formUrl.trim() || undefined,
          sortOrder: groups.length,
          createdAt: now,
          updatedAt: now,
        };

    await saveGroup(group);
    const updated = await loadGroups();
    setGroups(updated);
    resetForm();
  };

  const handleEdit = (group: SupplierGroup) => {
    setEditingGroup(group);
    setFormName(group.name);
    setFormUrl(group.searchUrl || '');
    setShowAddForm(true);
  };

  const handleDelete = (group: SupplierGroup) => {
    if (group.isDefault) {
      Alert.alert('Cannot Delete', 'Built-in supplier groups cannot be deleted.');
      return;
    }
    Alert.alert(
      'Delete Group',
      `Are you sure you want to delete "${group.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteGroup(group.id);
            setGroups(prev => prev.filter(g => g.id !== group.id));
          },
        },
      ]
    );
  };

  const resetForm = () => {
    setShowAddForm(false);
    setEditingGroup(null);
    setFormName('');
    setFormUrl('');
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          {groups.length === 0 && !loading && !showAddForm ? (
            <Surface style={styles.emptyCard}>
              <MaterialCommunityIcons name="store-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No Supplier Groups Yet</Text>
              <Text style={styles.emptySubtitle}>
                Add your suppliers here so you can quickly filter material searches by supplier.
              </Text>
            </Surface>
          ) : (
            groups.map(group => (
              <Surface key={group.id} style={styles.groupCard}>
                <View style={styles.groupHeader}>
                  <View style={styles.groupInfo}>
                    <Text style={styles.groupName}>{group.name}</Text>
                    {group.searchUrl && (
                      <Text style={styles.groupUrl} numberOfLines={1}>{group.searchUrl}</Text>
                    )}
                    {group.isDefault && (
                      <Text style={styles.defaultBadge}>Built-in</Text>
                    )}
                  </View>
                  <View style={styles.groupActions}>
                    <TouchableOpacity onPress={() => handleEdit(group)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                    {!group.isDefault && (
                      <TouchableOpacity onPress={() => handleDelete(group)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialCommunityIcons name="delete-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </Surface>
            ))
          )}

          {/* Add/Edit Form */}
          {showAddForm && (
            <Surface style={styles.formCard}>
              <Text style={styles.formTitle}>{editingGroup ? 'Edit Supplier' : 'New Supplier Group'}</Text>
              <TextInput
                label="Supplier Name"
                value={formName}
                onChangeText={setFormName}
                mode="outlined"
                style={styles.input}
                placeholder="e.g. Local Timber Yard"
              />
              <TextInput
                label="Website URL (optional)"
                value={formUrl}
                onChangeText={setFormUrl}
                mode="outlined"
                style={styles.input}
                placeholder="e.g. https://mytimbersupplier.com.au"
                autoCapitalize="none"
                keyboardType="url"
              />
              <View style={styles.formActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={resetForm}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </Surface>
          )}

          {!showAddForm && (
            <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddForm(true)}>
              <MaterialCommunityIcons name="plus" size={20} color={colors.primary} />
              <Text style={styles.addBtnText}>Add Supplier Group</Text>
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
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyCard: {
    padding: 32,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: colors.surface,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  groupCard: {
    padding: 16,
    borderRadius: 10,
    marginBottom: 10,
    backgroundColor: colors.surface,
    elevation: 1,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  groupInfo: {
    flex: 1,
    marginRight: 12,
  },
  groupName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  groupUrl: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  defaultBadge: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '500',
    marginTop: 4,
  },
  groupActions: {
    flexDirection: 'row',
    gap: 12,
  },
  formCard: {
    padding: 16,
    borderRadius: 10,
    marginBottom: 12,
    backgroundColor: colors.surface,
    elevation: 1,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  input: {
    marginBottom: 12,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  addBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
});
