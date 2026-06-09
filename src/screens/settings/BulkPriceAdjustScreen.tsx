/**
 * Bulk Price Adjust Screen
 *
 * Apply an annual supplier price rise (+%) and/or a GST mode flip across
 * every saved favorite under a chosen supplier in one tap. Built so Jesse
 * (and every tradie dealing with annual supplier rises) doesn't have to
 * re-import the PDF — he picks the supplier, enters 5.8%, and confirms.
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
  ActivityIndicator,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import {
  loadFavoritesFromLocal,
  bulkAdjustFavoritePrices,
} from '../../services/materialFavorites';
import { loadGroups } from '../../services/supplierGroupService';
import type { FavoriteProductMapping, SupplierGroup } from '../../types';
import { adjustPrice, GstAction } from '../../utils/priceAdjust';

type SupplierSummary = {
  name: string;
  itemCount: number;
  group?: SupplierGroup;
};

export function BulkPriceAdjustScreen() {
  const navigation = useNavigation<any>();

  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<Record<string, FavoriteProductMapping>>({});
  const [groups, setGroups] = useState<SupplierGroup[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);

  const [percentText, setPercentText] = useState('');
  const [gstAction, setGstAction] = useState<GstAction>('none');
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    (async () => {
      const [favs, grps] = await Promise.all([loadFavoritesFromLocal(), loadGroups()]);
      setFavorites(favs);
      setGroups(grps);
      setLoading(false);
    })();
  }, []);

  const suppliers: SupplierSummary[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const fav of Object.values(favorites)) {
      const store = fav.store?.trim();
      if (!store) continue;
      if (store.toLowerCase() === 'manual') continue;
      if (store.toLowerCase().includes('bunnings.com.au')) continue;
      counts.set(store, (counts.get(store) || 0) + 1);
    }
    const groupByName = new Map(groups.map((g) => [g.name.trim().toLowerCase(), g]));
    return Array.from(counts.entries())
      .map(([name, itemCount]) => ({
        name,
        itemCount,
        group: groupByName.get(name.toLowerCase()),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [favorites, groups]);

  const percent = parseFloat(percentText);
  const percentIsValid = percentText.trim() === '' || Number.isFinite(percent);
  const percentApplied = Number.isFinite(percent) ? percent : 0;
  const hasChange = (percentApplied !== 0 || gstAction !== 'none') && !!selectedSupplier;

  // Preview: show what the user's first 3 selected items would become.
  const preview = useMemo(() => {
    if (!selectedSupplier) return [];
    const rows = Object.values(favorites).filter((f) => f.store === selectedSupplier);
    return rows.slice(0, 3).map((row) => {
      const from = row.price || 0;
      return {
        name: row.productName,
        from,
        to: adjustPrice(from, { percent: percentApplied, gstAction }),
      };
    });
  }, [favorites, selectedSupplier, percentApplied, gstAction]);

  const itemCount = useMemo(() => {
    if (!selectedSupplier) return 0;
    return Object.values(favorites).filter((f) => f.store === selectedSupplier).length;
  }, [favorites, selectedSupplier]);

  const handleApply = async () => {
    if (!selectedSupplier || !hasChange) return;
    setApplying(true);
    try {
      const { updated, skipped } = await bulkAdjustFavoritePrices({
        filter: { supplier: selectedSupplier },
        percentChange: percentApplied,
        gstAction,
      });
      // Reload to reflect new prices and audit stamp.
      const [favs, grps] = await Promise.all([loadFavoritesFromLocal(), loadGroups()]);
      setFavorites(favs);
      setGroups(grps);
      setPercentText('');
      setGstAction('none');
      setResultMsg(
        `Updated ${updated} item${updated === 1 ? '' : 's'}` +
          (skipped > 0 ? ` (${skipped} unchanged)` : '')
      );
    } catch (error) {
      setResultMsg('Something went wrong. Please try again.');
    } finally {
      setApplying(false);
      setConfirmVisible(false);
    }
  };

  const selectedGroup = suppliers.find((s) => s.name === selectedSupplier)?.group;

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          <Text style={styles.intro}>
            Apply an annual price rise or flip GST mode across every saved
            product under a supplier. Useful when a supplier announces a
            price increase — no need to re-import the PDF.
          </Text>

          <Text style={styles.sectionLabel}>Supplier</Text>
          <Surface style={styles.card}>
            {suppliers.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  No saved supplier products yet. Import a price list first.
                </Text>
              </View>
            ) : (
              suppliers.map((s, idx) => {
                const active = s.name === selectedSupplier;
                return (
                  <TouchableOpacity
                    key={s.name}
                    onPress={() => setSelectedSupplier(s.name)}
                    style={[
                      styles.supplierRow,
                      idx < suppliers.length - 1 && styles.supplierRowBorder,
                      active && styles.supplierRowActive,
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.supplierName}>{s.name}</Text>
                      <Text style={styles.supplierMeta}>
                        {s.itemCount} item{s.itemCount === 1 ? '' : 's'}
                        {s.group?.lastPriceAdjustment
                          ? ` · last +${s.group.lastPriceAdjustment.percent}% on ${formatShortDate(s.group.lastPriceAdjustment.appliedAt)}`
                          : ''}
                      </Text>
                    </View>
                    {active && (
                      <MaterialCommunityIcons
                        name="check-circle"
                        size={22}
                        color={colors.primary}
                      />
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </Surface>

          {selectedGroup?.lastPriceAdjustment && (
            <View style={styles.auditBanner}>
              <MaterialCommunityIcons
                name="information-outline"
                size={18}
                color={colors.warning || '#f59e0b'}
              />
              <Text style={styles.auditText}>
                {selectedGroup.name} was last adjusted by{' '}
                <Text style={{ fontWeight: '700' }}>
                  {selectedGroup.lastPriceAdjustment.percent >= 0 ? '+' : ''}
                  {selectedGroup.lastPriceAdjustment.percent}%
                </Text>{' '}
                on {formatShortDate(selectedGroup.lastPriceAdjustment.appliedAt)}.
                Applying another % will compound.
              </Text>
            </View>
          )}

          <Text style={styles.sectionLabel}>Price increase</Text>
          <Surface style={styles.card}>
            <View style={styles.inputRow}>
              <TextInput
                value={percentText}
                onChangeText={setPercentText}
                mode="outlined"
                dense
                keyboardType="decimal-pad"
                placeholder="e.g. 5.8"
                style={{ flex: 1 }}
                right={<TextInput.Affix text="%" />}
                error={!percentIsValid}
              />
            </View>
            <Text style={styles.hint}>
              Positive for an increase, negative for a discount. Leave blank
              for no change.
            </Text>
          </Surface>

          <Text style={styles.sectionLabel}>GST</Text>
          <Surface style={styles.card}>
            <View style={styles.segmented}>
              {([
                { value: 'none', label: 'No change' },
                { value: 'addGst', label: '+10% GST' },
                { value: 'removeGst', label: '−10% GST' },
              ] as { value: GstAction; label: string }[]).map((opt) => {
                const active = gstAction === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.segment, active && styles.segmentActive]}
                    onPress={() => setGstAction(opt.value)}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.hint}>
              Use +GST if your saved prices are ex-GST and you want them
              stored inc-GST.
            </Text>
          </Surface>

          {preview.length > 0 && hasChange && (
            <>
              <Text style={styles.sectionLabel}>Preview</Text>
              <Surface style={styles.card}>
                {preview.map((row, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.previewRow,
                      idx < preview.length - 1 && styles.supplierRowBorder,
                    ]}
                  >
                    <Text style={styles.previewName} numberOfLines={1}>
                      {row.name}
                    </Text>
                    <Text style={styles.previewPrice}>
                      ${row.from.toFixed(2)} → ${row.to.toFixed(2)}
                    </Text>
                  </View>
                ))}
                {itemCount > preview.length && (
                  <Text style={styles.previewMore}>
                    + {itemCount - preview.length} more
                  </Text>
                )}
              </Surface>
            </>
          )}
        </WebContainer>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          mode="contained"
          onPress={() => setConfirmVisible(true)}
          disabled={!hasChange || !percentIsValid || applying}
          loading={applying}
          style={{ borderRadius: 8 }}
        >
          {hasChange
            ? `Apply to ${itemCount} item${itemCount === 1 ? '' : 's'}`
            : 'Choose a supplier and a change'}
        </Button>
      </View>

      <AlertModal
        visible={confirmVisible}
        type="warning"
        title="Apply price changes?"
        message={buildConfirmMessage({
          itemCount,
          supplier: selectedSupplier,
          percent: percentApplied,
          gstAction,
        })}
        onDismiss={() => !applying && setConfirmVisible(false)}
        primaryButtonText={applying ? 'Applying…' : 'Apply'}
        primaryButtonAction={handleApply}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setConfirmVisible(false)}
        secondaryButtonLoading={applying}
      />

      <AlertModal
        visible={!!resultMsg}
        type="success"
        title="Done"
        message={resultMsg || ''}
        onDismiss={() => setResultMsg(null)}
        primaryButtonText="OK"
        primaryButtonAction={() => setResultMsg(null)}
      />
    </View>
  );
}

function buildConfirmMessage(opts: {
  itemCount: number;
  supplier: string | null;
  percent: number;
  gstAction: GstAction;
}): string {
  const parts: string[] = [];
  if (opts.percent !== 0) {
    parts.push(`${opts.percent >= 0 ? '+' : ''}${opts.percent}%`);
  }
  if (opts.gstAction === 'addGst') parts.push('+10% GST');
  if (opts.gstAction === 'removeGst') parts.push('−10% GST');
  const change = parts.join(' then ');
  return `${change || 'No change'} on ${opts.itemCount} item${opts.itemCount === 1 ? '' : 's'} under ${opts.supplier || 'this supplier'}.\n\nThis writes new prices to your supplier book. Existing quotes are not affected.`;
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
    ...(Platform.OS === 'web' && { maxWidth: 600, margin: 'auto' as any, width: '100%' }),
  },
  intro: { color: colors.onSurface, marginBottom: 16 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurface,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 8,
  },
  card: {
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    marginBottom: 12,
  },
  supplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  supplierRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.outline + '20' },
  supplierRowActive: { backgroundColor: colors.primary + '08' },
  supplierName: { fontSize: 15, fontWeight: '600', color: colors.text },
  supplierMeta: { fontSize: 12, color: colors.onSurface, marginTop: 2 },
  empty: { padding: 18 },
  emptyText: { color: colors.onSurface },
  auditBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: (colors.warning || '#f59e0b') + '15',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    gap: 8,
  },
  auditText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  inputRow: { padding: 12 },
  hint: {
    color: colors.onSurface,
    fontSize: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  segmented: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.outline + '40',
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.primary + '12',
    borderColor: colors.primary,
  },
  segmentText: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: colors.primary },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 8,
  },
  previewName: { flex: 1, color: colors.text, fontSize: 14 },
  previewPrice: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  previewMore: { padding: 12, color: colors.onSurface, fontSize: 12 },
  footer: {
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.outline + '20',
  },
});
