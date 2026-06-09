/**
 * Quote Pitch Screen
 *
 * Manage the user's library of reusable sales-pitch templates. Each pitch
 * renders above the line items on customer-facing quotes/invoices. Pitches
 * support `{{key}}` template variables (e.g. R-value upgrade calc).
 *
 * First visit seeds Jesse's two starter pitches if the array is undefined.
 */

import React, { useEffect, useMemo, useState } from 'react';
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
  Switch,
  Divider,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import { generateId } from '../../utils/generateId';
import { resolveAndRenderPitch } from '../../utils/salesPitch';
import { buildStarterPitches } from '../../services/starterPitches';
import type { SalesPitch, SalesPitchVariable } from '../../types';

export function QuotePitchScreen() {
  const { businessSettings, setBusinessSettings } = useStore();
  const [pitches, setPitches] = useState<SalesPitch[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!businessSettings) return;
    if (businessSettings.salesPitches === undefined) {
      // First visit \u2014 seed Jesse's two starter pitches.
      const seeded = buildStarterPitches();
      setPitches(seeded);
      setDirty(true);
    } else {
      setPitches(businessSettings.salesPitches);
    }
  }, [businessSettings]);

  const editing = useMemo(
    () => pitches.find((p) => p.id === editingId) || null,
    [pitches, editingId],
  );

  const updatePitch = (id: string, patch: Partial<SalesPitch>) => {
    setPitches((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setDirty(true);
  };

  const addPitch = () => {
    const p: SalesPitch = {
      id: generateId(),
      name: 'New pitch',
      body: '',
    };
    setPitches((prev) => [...prev, p]);
    setEditingId(p.id);
    setDirty(true);
  };

  const setDefault = (id: string) => {
    setPitches((prev) => prev.map((p) => ({ ...p, isDefault: p.id === id })));
    setDirty(true);
  };

  const removePitch = (id: string) => {
    setPitches((prev) => prev.filter((p) => p.id !== id));
    setDeleteId(null);
    if (editingId === id) setEditingId(null);
    setDirty(true);
  };

  const save = async () => {
    if (!businessSettings) return;
    setSaving(true);
    try {
      await setBusinessSettings({ ...businessSettings, salesPitches: pitches });
      setDirty(false);
      setSavedMsg(`Saved ${pitches.length} pitch${pitches.length === 1 ? '' : 'es'}`);
    } catch {
      setSavedMsg('Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ---------- Variable editor ----------
  const addVariable = (pitchId: string) => {
    const p = pitches.find((x) => x.id === pitchId);
    if (!p) return;
    const next: SalesPitchVariable = {
      key: `var_${(p.variables?.length || 0) + 1}`,
      label: 'New variable',
      type: 'text',
    };
    updatePitch(pitchId, { variables: [...(p.variables || []), next] });
  };

  const updateVariable = (
    pitchId: string,
    idx: number,
    patch: Partial<SalesPitchVariable>,
  ) => {
    const p = pitches.find((x) => x.id === pitchId);
    if (!p) return;
    const vars = [...(p.variables || [])];
    vars[idx] = { ...vars[idx], ...patch };
    updatePitch(pitchId, { variables: vars });
  };

  const removeVariable = (pitchId: string, idx: number) => {
    const p = pitches.find((x) => x.id === pitchId);
    if (!p) return;
    const vars = (p.variables || []).filter((_, i) => i !== idx);
    updatePitch(pitchId, { variables: vars.length > 0 ? vars : undefined });
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          <Text style={styles.intro}>
            Reusable boilerplate that renders above the line items on every
            quote. Pick one per quote on the preview screen. Use
            <Text style={styles.code}>{` {{double_curly}} `}</Text>
            placeholders to drop in customer-specific values like R-value.
          </Text>

          {/* List */}
          <Surface style={styles.card}>
            {pitches.length === 0 && (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No pitches yet.</Text>
              </View>
            )}
            {pitches.map((p, idx) => {
              const isOpen = editingId === p.id;
              return (
                <View key={p.id}>
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => setEditingId(isOpen ? null : p.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.titleRow}>
                        <Text style={styles.pitchName}>{p.name}</Text>
                        {p.isDefault && (
                          <View style={styles.defaultBadge}>
                            <Text style={styles.defaultBadgeText}>DEFAULT</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.pitchPreview} numberOfLines={2}>
                        {resolveAndRenderPitch(p, {}).split('\n')[0]}
                      </Text>
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
                        onChangeText={(v) => updatePitch(p.id, { name: v })}
                        mode="outlined"
                        dense
                        style={styles.input}
                      />
                      <TextInput
                        label="Body"
                        value={p.body}
                        onChangeText={(v) => updatePitch(p.id, { body: v })}
                        mode="outlined"
                        multiline
                        numberOfLines={10}
                        style={[styles.input, { minHeight: 180 }]}
                      />

                      {/* Variables */}
                      <View style={styles.varHeader}>
                        <Text style={styles.varHeaderText}>Variables</Text>
                        <Button
                          mode="text"
                          compact
                          onPress={() => addVariable(p.id)}
                          icon="plus"
                        >
                          Add
                        </Button>
                      </View>
                      {(p.variables || []).map((v, i) => (
                        <View key={i} style={styles.varRow}>
                          <View style={styles.varGrid}>
                            <TextInput
                              label="Key"
                              value={v.key}
                              onChangeText={(val) =>
                                updateVariable(p.id, i, { key: val.trim() })
                              }
                              mode="outlined"
                              dense
                              style={styles.varInput}
                            />
                            <TextInput
                              label="Label"
                              value={v.label}
                              onChangeText={(val) => updateVariable(p.id, i, { label: val })}
                              mode="outlined"
                              dense
                              style={styles.varInput}
                            />
                            <TextInput
                              label="Default"
                              value={v.defaultValue || ''}
                              onChangeText={(val) =>
                                updateVariable(p.id, i, { defaultValue: val })
                              }
                              mode="outlined"
                              dense
                              style={styles.varInput}
                            />
                          </View>
                          <View style={styles.varMetaRow}>
                            <Text style={styles.varMetaLabel}>
                              {v.derive
                                ? `Derived: sum of [${v.derive.from.join(', ')}]`
                                : `Type: ${v.type}`}
                            </Text>
                            <IconButton
                              icon="delete-outline"
                              size={18}
                              onPress={() => removeVariable(p.id, i)}
                            />
                          </View>
                        </View>
                      ))}

                      <Divider style={{ marginVertical: 8 }} />

                      <View style={styles.editorFooter}>
                        <View style={styles.defaultToggleRow}>
                          <Text style={{ color: colors.text }}>Default for new quotes</Text>
                          <Switch
                            value={p.isDefault === true}
                            onValueChange={(v) => (v ? setDefault(p.id) : updatePitch(p.id, { isDefault: false }))}
                          />
                        </View>
                        <Button
                          mode="text"
                          textColor={colors.error || '#dc2626'}
                          onPress={() => setDeleteId(p.id)}
                          icon="delete"
                        >
                          Delete
                        </Button>
                      </View>

                      {/* Live preview */}
                      <View style={styles.previewCard}>
                        <Text style={styles.previewLabel}>Preview</Text>
                        <Text style={styles.previewBody}>
                          {resolveAndRenderPitch(p, {})}
                        </Text>
                      </View>
                    </View>
                  )}

                  {idx < pitches.length - 1 && <Divider />}
                </View>
              );
            })}
          </Surface>

          <Button
            mode="outlined"
            icon="plus"
            onPress={addPitch}
            style={{ marginTop: 12 }}
          >
            New pitch
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
        title="Delete pitch?"
        message="This removes the pitch from your library. Quotes that referenced it keep their snapshot."
        onDismiss={() => setDeleteId(null)}
        primaryButtonText="Delete"
        primaryButtonAction={() => deleteId && removePitch(deleteId)}
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
    ...(Platform.OS === 'web' && { maxWidth: 700, margin: 'auto' as any, width: '100%' }),
  },
  intro: { color: colors.onSurface, marginBottom: 16 },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    backgroundColor: colors.surfaceDark || colors.background,
    color: colors.primary,
  },
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pitchName: { fontSize: 15, fontWeight: '700', color: colors.text },
  pitchPreview: { fontSize: 13, color: colors.onSurface, marginTop: 2 },
  defaultBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  defaultBadgeText: { color: colors.surface, fontSize: 9, fontWeight: '800' },
  editor: { padding: 12, paddingTop: 4, backgroundColor: colors.surfaceDark || colors.background },
  input: { backgroundColor: colors.surface, marginBottom: 10 },
  varHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  varHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: colors.onSurface,
  },
  varRow: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  varGrid: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  varInput: { flex: 1, minWidth: 100, backgroundColor: colors.surface },
  varMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 4,
  },
  varMetaLabel: { fontSize: 12, color: colors.onSurface },
  editorFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 4,
  },
  defaultToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewCard: {
    marginTop: 12,
    borderRadius: 8,
    padding: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outline + '30',
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.onSurface,
    marginBottom: 6,
    letterSpacing: 0.6,
  },
  previewBody: { color: colors.text, fontSize: 13, lineHeight: 18 },
  footer: {
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.outline + '20',
  },
});
