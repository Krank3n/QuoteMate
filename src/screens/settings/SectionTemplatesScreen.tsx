/**
 * Section Templates Screen
 * Manage reusable section templates (assemblies)
 * e.g. "Fence Bay" = posts + rails + sheets + labor
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
  Divider,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { SectionTemplate, LaborUnit, Material } from '../../types';
import {
  loadTemplates,
  deleteTemplate,
} from '../../services/sectionTemplateService';
import { WebContainer } from '../../components/WebContainer';
import { MaterialItemCard } from '../../components/MaterialItemCard';

export function SectionTemplatesScreen() {
  const navigation = useNavigation<any>();
  const [templates, setTemplates] = useState<SectionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedMaterialIds, setExpandedMaterialIds] = useState<Set<string>>(new Set());


  useFocusEffect(
    useCallback(() => {
      loadTemplates().then(t => {
        setTemplates(t);
        setLoading(false);
      });
    }, [])
  );

  const handleDelete = (template: SectionTemplate) => {
    Alert.alert(
      'Delete Template',
      `Are you sure you want to delete "${template.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteTemplate(template.id);
            setTemplates(prev => prev.filter(t => t.id !== template.id));
          },
        },
      ]
    );
  };

  const unitLabel = (unit: LaborUnit) => unit === 'days' ? 'days' : 'hrs';
  const rateLabel = (unit: LaborUnit) => unit === 'days' ? '/day' : '/hr';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          {templates.length === 0 && !loading ? (
            <Surface style={styles.emptyCard}>
              <MaterialCommunityIcons name="puzzle-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No Job Templates Yet</Text>
              <Text style={styles.emptySubtitle}>
                Create reusable templates for common jobs. Great for repeating work like fence bays, deck sections, etc.
              </Text>
            </Surface>
          ) : (
            templates.map(template => {
              const materialsCost = template.materials.reduce((sum, m) => sum + (m.quantity * m.price), 0);
              const isExpanded = expandedId === template.id;
              return (
                <TouchableOpacity
                  key={template.id}
                  activeOpacity={0.8}
                  onPress={() => setExpandedId(isExpanded ? null : template.id)}
                >
                <Surface style={styles.templateCard}>
                  <View style={styles.templateHeader}>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialCommunityIcons
                        name={isExpanded ? 'chevron-down' : 'chevron-right'}
                        size={20}
                        color={colors.textMuted}
                      />
                      <Text style={styles.templateName}>{template.name}</Text>
                    </View>
                    <View style={styles.templateActions}>
                      <TouchableOpacity onPress={() => navigation.navigate('JobTemplateEditor', { template })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDelete(template)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialCommunityIcons name="delete-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  {template.description && (
                    <Text style={styles.templateDescription}>{template.description}</Text>
                  )}
                  <Text style={styles.detailLabel}>
                    {template.materials.length} material{template.materials.length !== 1 ? 's' : ''} · {formatCurrency(materialsCost)} · Labor: {formatCurrency(template.laborHours * template.laborRate)}
                  </Text>
                  {isExpanded && (
                    <>
                      <Divider style={styles.divider} />
                      {template.materials.map((m, i) => {
                        const matId = `tpl-${template.id}-${i}`;
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
                          />
                        );
                      })}
                      <Divider style={styles.divider} />
                      <Text style={styles.detailLabel}>
                        Labor: {template.laborHours} {unitLabel(template.laborUnit)} @ {formatCurrency(template.laborRate)}{rateLabel(template.laborUnit)}
                      </Text>
                    </>
                  )}
                </Surface>
                </TouchableOpacity>
              );
            })
          )}
          {/* Create / Edit Template */}
          <TouchableOpacity style={styles.createBtn} onPress={() => navigation.navigate('JobTemplateEditor')}>
            <MaterialCommunityIcons name="plus" size={20} color={colors.primary} />
            <Text style={styles.createBtnText}>Create Template</Text>
          </TouchableOpacity>
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
  templateCard: {
    padding: 16,
    borderRadius: 10,
    marginBottom: 12,
    backgroundColor: colors.surface,
    elevation: 1,
  },
  templateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  templateActions: {
    flexDirection: 'row',
    gap: 12,
  },
  templateName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  templateDescription: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
  divider: {
    marginVertical: 10,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.onSurface,
    marginTop: 2,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  createBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
});
