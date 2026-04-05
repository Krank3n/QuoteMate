/**
 * Job Template Editor Screen
 * Create or edit a job template (materials + labor).
 * Reusable for both creating new templates and editing existing ones.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Alert,
  TextInput as RNTextInput,
} from 'react-native';
import {
  Text,
  TextInput,
  Divider,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { SectionTemplate, LaborUnit, Material } from '../../types';
import { saveTemplate, suggestKeywordsFromName } from '../../services/sectionTemplateService';
import { WebContainer } from '../../components/WebContainer';
import { MaterialItemCard } from '../../components/MaterialItemCard';
import { useStore } from '../../store/useStore';
import { FixedBottomButton } from '../../components/FixedBottomButton';

export function JobTemplateEditorScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const existingTemplate = route.params?.template as SectionTemplate | undefined;

  const [name, setName] = useState(existingTemplate?.name || '');
  const [description, setDescription] = useState(existingTemplate?.description || '');
  const [laborHours, setLaborHours] = useState(existingTemplate?.laborHours?.toString() || '');
  const [laborRate, setLaborRate] = useState(existingTemplate?.laborRate?.toString() || '85');
  const [laborUnit, setLaborUnit] = useState<LaborUnit>(existingTemplate?.laborUnit || 'hours');
  const [keywords, setKeywords] = useState<string[]>(existingTemplate?.keywords || []);
  const [keywordInput, setKeywordInput] = useState('');
  const [materials, setMaterials] = useState<Omit<Material, 'id'>[]>(existingTemplate?.materials || []);

  const [expandedMaterialIds, setExpandedMaterialIds] = useState<Set<string>>(new Set());
  const [editingMaterialIndex, setEditingMaterialIndex] = useState<number | null>(null);

  const { pendingTemplateMaterial, setPendingTemplateMaterial } = useStore();

  // Pick up material from AddMaterialScreen
  useFocusEffect(
    useCallback(() => {
      if (pendingTemplateMaterial) {
        const m = pendingTemplateMaterial;
        const matData = {
          name: m.name,
          quantity: m.quantity,
          unit: m.unit,
          price: m.price,
          totalPrice: m.totalPrice,
          manualPriceOverride: m.manualPriceOverride,
          pricingSource: m.pricingSource,
          favoriteProduct: m.favoriteProduct,
          imageUrl: m.imageUrl,
          description: m.description,
          brand: m.brand,
        };
        if (editingMaterialIndex !== null) {
          setMaterials(prev => prev.map((mat, idx) => idx === editingMaterialIndex ? matData : mat));
          setEditingMaterialIndex(null);
        } else {
          setMaterials(prev => [...prev, matData]);
        }
        setPendingTemplateMaterial(null);
      }
    }, [pendingTemplateMaterial])
  );

  const handleAddMaterial = () => {
    navigation.navigate('AddMaterialStandalone', { templateMode: true });
  };

  const handleEditMaterial = (index: number) => {
    const m = materials[index];
    setEditingMaterialIndex(index);
    setPendingTemplateMaterial({ ...m, id: `edit-${index}` } as Material);
    navigation.navigate('AddMaterialStandalone', { templateMode: true, editingTemplate: true });
  };

  const handleRemoveMaterial = (index: number) => {
    setMaterials(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Enter Name', 'Please enter a template name');
      return;
    }
    const now = new Date().toISOString();
    // Auto-suggest keywords if none set
    const finalKeywords = keywords.length > 0 ? keywords : suggestKeywordsFromName(name);
    const template: SectionTemplate = {
      id: existingTemplate?.id || `tpl-${Date.now()}`,
      name: name.trim(),
      description: description.trim() || undefined,
      keywords: finalKeywords.length > 0 ? finalKeywords : undefined,
      materials,
      laborHours: parseFloat(laborHours) || 0,
      laborRate: parseFloat(laborRate) || 0,
      laborUnit,
      createdAt: existingTemplate?.createdAt || now,
      updatedAt: now,
    };
    await saveTemplate(template);
    navigation.goBack();
  };

  const materialsTotal = materials.reduce((sum, m) => sum + (m.quantity * m.price), 0);
  const laborTotal = (parseFloat(laborHours) || 0) * (parseFloat(laborRate) || 0);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <WebContainer>
          <TextInput
            label="Template Name"
            value={name}
            onChangeText={setName}
            mode="outlined"
            style={styles.input}
            placeholder="e.g. Standard Fence Bay"
          />
          <TextInput
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            mode="outlined"
            style={styles.input}
          />

          {/* Keywords */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionLine} />
            <Text style={styles.sectionHeaderTitle}>KEYWORDS</Text>
            <View style={styles.sectionLine} />
          </View>
          <Text style={styles.keywordHelpText}>
            Used to match this template to job descriptions
          </Text>
          {keywords.length > 0 && (
            <View style={styles.keywordChipsRow}>
              {keywords.map((kw, i) => (
                <View key={i} style={styles.keywordChip}>
                  <Text style={styles.keywordChipText}>{kw}</Text>
                  <Pressable onPress={() => setKeywords(prev => prev.filter((_, idx) => idx !== i))} hitSlop={8}>
                    <MaterialCommunityIcons name="close-circle" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <TextInput
            label="Add keyword"
            value={keywordInput}
            onChangeText={(text) => {
              if (text.endsWith(',')) {
                const kw = text.slice(0, -1).trim().toLowerCase();
                if (kw && !keywords.includes(kw)) setKeywords(prev => [...prev, kw]);
                setKeywordInput('');
              } else {
                setKeywordInput(text);
              }
            }}
            onSubmitEditing={() => {
              const kw = keywordInput.trim().toLowerCase();
              if (kw && !keywords.includes(kw)) setKeywords(prev => [...prev, kw]);
              setKeywordInput('');
            }}
            mode="outlined"
            style={styles.input}
            placeholder='e.g. fence bay, colorbond fence'
            returnKeyType="done"
          />
          {keywords.length === 0 && name.trim() && (
            <TouchableOpacity
              style={styles.keywordSuggestBtn}
              onPress={() => {
                const suggested = suggestKeywordsFromName(name);
                if (suggested.length > 0) setKeywords(suggested);
              }}
            >
              <MaterialCommunityIcons name="lightbulb-outline" size={16} color={colors.primary} />
              <Text style={styles.keywordSuggestText}>Suggest from name</Text>
            </TouchableOpacity>
          )}

          {/* Materials */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionLine} />
            <Text style={styles.sectionHeaderTitle}>MATERIALS</Text>
            <View style={styles.sectionLine} />
          </View>

          {materials.map((m, i) => {
            const matId = `mat-${i}`;
            return (
              <MaterialItemCard
                key={matId}
                material={{ ...m, id: matId } as Material}
                isExpanded={expandedMaterialIds.has(matId)}
                onToggleExpand={() => setExpandedMaterialIds(prev => {
                  const next = new Set(prev);
                  next.has(matId) ? next.delete(matId) : next.add(matId);
                  return next;
                })}
                onQuantityUpdate={(delta) => {
                  setMaterials(prev => prev.map((mat, idx) => {
                    if (idx !== i) return mat;
                    const newQty = Math.max(1, mat.quantity + delta);
                    return { ...mat, quantity: newQty, totalPrice: newQty * mat.price };
                  }));
                }}
                onQuantityBlur={(value) => {
                  const newQty = Math.max(1, parseInt(value) || 1);
                  setMaterials(prev => prev.map((mat, idx) => {
                    if (idx !== i) return mat;
                    return { ...mat, quantity: newQty, totalPrice: newQty * mat.price };
                  }));
                }}
                onEdit={() => handleEditMaterial(i)}
                onDelete={() => handleRemoveMaterial(i)}
              />
            );
          })}

          <TouchableOpacity style={styles.addMaterialBtn} onPress={handleAddMaterial}>
            <MaterialCommunityIcons name="plus" size={18} color={colors.primary} />
            <Text style={styles.addMaterialBtnText}>Add Material</Text>
          </TouchableOpacity>

          {materials.length > 0 && (
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Materials Subtotal</Text>
              <Text style={styles.subtotalValue}>{formatCurrency(materialsTotal)}</Text>
            </View>
          )}

          {/* Labour */}
          <View style={styles.sectionHeader}>
            <View style={styles.sectionLine} />
            <Text style={styles.sectionHeaderTitle}>LABOUR</Text>
            <View style={styles.sectionLine} />
          </View>

          <View style={styles.unitToggleRow}>
            <TouchableOpacity
              style={[styles.unitBtn, laborUnit === 'hours' && styles.unitBtnActive]}
              onPress={() => setLaborUnit('hours')}
            >
              <Text style={[styles.unitBtnText, laborUnit === 'hours' && styles.unitBtnTextActive]}>Hours</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.unitBtn, laborUnit === 'days' && styles.unitBtnActive]}
              onPress={() => setLaborUnit('days')}
            >
              <Text style={[styles.unitBtnText, laborUnit === 'days' && styles.unitBtnTextActive]}>Days</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.laborRow}>
            <TextInput
              label={laborUnit === 'days' ? 'Days' : 'Hours'}
              value={laborHours}
              onChangeText={setLaborHours}
              mode="outlined"
              keyboardType="decimal-pad"
              style={styles.laborInput}
            />
            <TextInput
              label={laborUnit === 'days' ? '$/day' : '$/hr'}
              value={laborRate}
              onChangeText={setLaborRate}
              mode="outlined"
              keyboardType="decimal-pad"
              left={<TextInput.Affix text="$" />}
              style={styles.laborInput}
            />
          </View>

          {laborTotal > 0 && (
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Labour Total</Text>
              <Text style={styles.subtotalValue}>{formatCurrency(laborTotal)}</Text>
            </View>
          )}

          {(materialsTotal > 0 || laborTotal > 0) && (
            <>
              <Divider style={{ marginVertical: 12 }} />
              <View style={styles.subtotalRow}>
                <Text style={[styles.subtotalLabel, { fontWeight: '700', fontSize: 16 }]}>Template Total</Text>
                <Text style={[styles.subtotalValue, { fontSize: 18 }]}>{formatCurrency(materialsTotal + laborTotal)}</Text>
              </View>
            </>
          )}

          <View style={{ height: 100 }} />
        </WebContainer>
      </ScrollView>

      <FixedBottomButton
        label={existingTemplate ? 'Save Changes' : 'Save Template'}
        onPress={handleSave}
      />
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
    paddingBottom: 120,
  },
  input: {
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
    gap: 10,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  sectionHeaderTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  addMaterialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  addMaterialBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  subtotalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  subtotalValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  unitToggleRow: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 8,
  },
  unitBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  unitBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  unitBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
  unitBtnTextActive: {
    color: '#FFFFFF',
  },
  laborRow: {
    flexDirection: 'row',
    gap: 12,
  },
  laborInput: {
    flex: 1,
  },
  keywordHelpText: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
  },
  keywordChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  keywordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surfaceDark,
    borderWidth: 1,
    borderColor: colors.border,
  },
  keywordChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
  },
  keywordSuggestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -4,
    marginBottom: 8,
    paddingVertical: 6,
  },
  keywordSuggestText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.primary,
  },
});
