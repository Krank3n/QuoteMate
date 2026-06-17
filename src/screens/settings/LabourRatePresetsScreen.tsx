/**
 * Labour Rate Presets Screen
 *
 * Manage reusable $/N-unit labour presets. Pick one on the quote labour
 * screen to convert a measured area to a labour dollar figure with one
 * tap. Ships empty — the tradie adds their own rates from a blank slate.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import {
  Text,
  TextInput,
  Surface,
  Button,
  IconButton,
  Divider,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import { generateId } from '../../utils/generateId';
import { formatPresetRate } from '../../utils/labourPreset';
import type { LabourRatePreset } from '../../types';

const UNITS: LabourRatePreset['unit'][] = ['m\u00b2', 'm', 'each', 'm\u00b3'];

export function LabourRatePresetsScreen() {
  const { businessSettings, setBusinessSettings } = useStore();
  const [presets, setPresets] = useState<LabourRatePreset[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!businessSettings) return;
    // Library starts empty \u2014 no auto-seeded rates. The tradie adds their own.
    setPresets(businessSettings.labourRatePresets ?? []);
  }, [businessSettings]);

  const updatePreset = (id: string, patch: Partial<LabourRatePreset>) => {
    setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setDirty(true);
  };

  const addPreset = () => {
    const p: LabourRatePreset = {
      id: generateId(),
      name: 'New preset',
      amount: 0,
      denominator: 100,
      unit: 'm\u00b2',
    };
    setPresets((prev) => [...prev, p]);
    setEditingId(p.id);
    setDirty(true);
  };

  const removePreset = (id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
    setDeleteId(null);
    if (editingId === id) setEditingId(null);
    setDirty(true);
  };

  const save = async () => {
    if (!businessSettings) return;
    setSaving(true);
    try {
      await setBusinessSettings({ ...businessSettings, labourRatePresets: presets });
      setDirty(false);
      setSavedMsg(
        `Saved ${presets.length} preset${presets.length === 1 ? '' : 's'}`,
      );
    } catch {
      setSavedMsg('Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          <Text style={styles.intro}>
            Reusable labour rates by area. On a quote's labour screen, tap a
            preset and enter the measured area to set the labour total in one
            go. You can still nudge the final figure before sending.
          </Text>

          <Surface style={styles.card}>
            {presets.length === 0 && (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No presets yet.</Text>
              </View>
            )}
            {presets.map((p, idx) => {
              const isOpen = editingId === p.id;
              return (
                <View key={p.id}>
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => setEditingId(isOpen ? null : p.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.presetName}>{p.name}</Text>
                      <Text style={styles.presetRate}>{formatPresetRate(p)}</Text>
                    </View>
                    <MaterialCommunityIcons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={22}
                      color={colors.onSurface}
                    />
                  </TouchableOpacity>

                  {isOpen && (
                    <View style={styles.editor}>
                      <TextInput
                        label="Name"
                        value={p.name}
                        onChangeText={(v) => updatePreset(p.id, { name: v })}
                        mode="outlined"
                        dense
                        style={styles.input}
                      />
                      <View style={styles.amountRow}>
                        <TextInput
                          label="Amount"
                          value={String(p.amount)}
                          onChangeText={(v) =>
                            updatePreset(p.id, { amount: parseFloat(v) || 0 })
                          }
                          mode="outlined"
                          dense
                          keyboardType="decimal-pad"
                          left={<TextInput.Affix text="$" />}
                          style={[styles.input, { flex: 2 }]}
                        />
                        <Text style={styles.perText}>per</Text>
                        <TextInput
                          label="Denominator"
                          value={String(p.denominator)}
                          onChangeText={(v) =>
                            updatePreset(p.id, {
                              denominator: parseFloat(v) || 1,
                            })
                          }
                          mode="outlined"
                          dense
                          keyboardType="decimal-pad"
                          style={[styles.input, { flex: 1 }]}
                        />
                      </View>
                      <View style={styles.unitRow}>
                        {UNITS.map((u) => {
                          const active = p.unit === u;
                          return (
                            <TouchableOpacity
                              key={u}
                              onPress={() => updatePreset(p.id, { unit: u })}
                              style={[styles.unitBtn, active && styles.unitBtnActive]}
                            >
                              <Text
                                style={[
                                  styles.unitBtnText,
                                  active && styles.unitBtnTextActive,
                                ]}
                              >
                                {u}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <TextInput
                        label="Notes (optional)"
                        value={p.notes || ''}
                        onChangeText={(v) => updatePreset(p.id, { notes: v })}
                        mode="outlined"
                        dense
                        style={styles.input}
                      />
                      <View style={styles.editorFooter}>
                        <Text style={styles.previewText}>
                          {formatPresetRate(p)}
                        </Text>
                        <Button
                          mode="text"
                          textColor={colors.error || '#dc2626'}
                          onPress={() => setDeleteId(p.id)}
                          icon="delete"
                        >
                          Delete
                        </Button>
                      </View>
                    </View>
                  )}

                  {idx < presets.length - 1 && <Divider />}
                </View>
              );
            })}
          </Surface>

          <Button
            mode="outlined"
            icon="plus"
            onPress={addPreset}
            style={{ marginTop: 12 }}
          >
            New preset
          </Button>
        </WebContainer>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          mode="contained"
          onPress={save}
          disabled={!dirty || saving}
          loading={saving}
          style={{ borderRadius: 8 }}
        >
          Save changes
        </Button>
      </View>

      <AlertModal
        visible={!!deleteId}
        type="warning"
        title="Delete preset?"
        message="Quotes that already used this preset keep their snapshot. New quotes will lose this option."
        onDismiss={() => setDeleteId(null)}
        primaryButtonText="Delete"
        primaryButtonAction={() => deleteId && removePreset(deleteId)}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setDeleteId(null)}
      />
      <AlertModal
        visible={!!savedMsg}
        type="success"
        title="Done"
        message={savedMsg || ''}
        onDismiss={() => setSavedMsg(null)}
        primaryButtonText="OK"
        primaryButtonAction={() => setSavedMsg(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
    ...(Platform.OS === 'web' && { maxWidth: 600, margin: 'auto' as any, width: '100%' }),
  },
  intro: { color: colors.onSurface, marginBottom: 16 },
  card: {
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  empty: { padding: 18 },
  emptyText: { color: colors.onSurface },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  presetName: { fontSize: 15, fontWeight: '700', color: colors.text },
  presetRate: { fontSize: 13, color: colors.onSurface, marginTop: 2 },
  editor: {
    padding: 12,
    paddingTop: 4,
    backgroundColor: colors.surfaceDark || colors.background,
  },
  input: { backgroundColor: colors.surface, marginBottom: 10 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  perText: { color: colors.onSurface, marginHorizontal: 4, fontSize: 13 },
  unitRow: { flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  unitBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.outline + '40',
  },
  unitBtnActive: { backgroundColor: colors.primary + '12', borderColor: colors.primary },
  unitBtnText: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  unitBtnTextActive: { color: colors.primary },
  editorFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  previewText: { color: colors.primary, fontWeight: '700' },
  footer: {
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.outline + '20',
  },
});
