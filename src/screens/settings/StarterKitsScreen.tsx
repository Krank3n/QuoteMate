/**
 * Starter Kits Screen
 *
 * Trade-specific line-item libraries pre-built for common niches. Installs
 * a SupplierGroup + a set of FavoriteProductMappings + matching
 * SectionTemplates in one tap. Idempotent \u2014 re-running refreshes
 * descriptions and prices without creating duplicates.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { Text, Surface, Button, ActivityIndicator } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import {
  installStarterKit,
  isStarterKitInstalled,
  type StarterKit,
} from '../../services/starterKitInstaller';
import { insulationStarterKit } from '../../services/starterKits/insulation';

const KITS: StarterKit[] = [insulationStarterKit];

export function StarterKitsScreen() {
  const [installedFlags, setInstalledFlags] = useState<Record<string, boolean>>({});
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const flags: Record<string, boolean> = {};
      for (const kit of KITS) {
        flags[kit.id] = await isStarterKitInstalled(kit);
      }
      setInstalledFlags(flags);
    })();
  }, []);

  const handleInstall = async (kit: StarterKit) => {
    setInstallingId(kit.id);
    try {
      const res = await installStarterKit(kit);
      const supplierBit = res.supplierCreated
        ? `Created supplier "${kit.supplierName}". `
        : '';
      const favBit = `${res.favorites.created} new, ${res.favorites.updated} updated.`;
      const tplBit = res.templatesCreated > 0
        ? ` Added ${res.templatesCreated} job template${res.templatesCreated === 1 ? '' : 's'}.`
        : '';
      setResultMsg(`${supplierBit}${favBit}${tplBit}`);
      setInstalledFlags((prev) => ({ ...prev, [kit.id]: true }));
    } catch (error) {
      setResultMsg('Install failed. Please try again.');
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          <Text style={styles.intro}>
            Pre-built line-item libraries for common trades. Each kit drops a
            supplier, a set of products with descriptions, and a matching set
            of job templates into your account. Re-installing keeps your edits.
          </Text>

          {KITS.map((kit) => {
            const installed = installedFlags[kit.id] === true;
            const installing = installingId === kit.id;
            return (
              <Surface key={kit.id} style={styles.card}>
                <View style={styles.titleRow}>
                  <View style={styles.iconWrap}>
                    <MaterialCommunityIcons
                      name="briefcase-plus-outline"
                      size={22}
                      color={colors.primary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{kit.supplierName}</Text>
                    <Text style={styles.cardMeta}>
                      {kit.items.length} item{kit.items.length === 1 ? '' : 's'} \u00b7{' '}
                      {kit.tradeNiche}
                    </Text>
                  </View>
                  {installed && (
                    <View style={styles.installedBadge}>
                      <Text style={styles.installedBadgeText}>INSTALLED</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.cardDesc}>{kit.description}</Text>

                <View style={styles.itemPreview}>
                  {kit.items.slice(0, 4).map((it) => (
                    <View key={it.productName} style={styles.itemPill}>
                      <Text style={styles.itemPillText} numberOfLines={1}>
                        {it.productName}
                      </Text>
                    </View>
                  ))}
                  {kit.items.length > 4 && (
                    <View style={styles.itemPill}>
                      <Text style={styles.itemPillText}>
                        +{kit.items.length - 4} more
                      </Text>
                    </View>
                  )}
                </View>

                <Button
                  mode={installed ? 'outlined' : 'contained'}
                  onPress={() => handleInstall(kit)}
                  loading={installing}
                  disabled={installing}
                  icon={installed ? 'refresh' : 'download'}
                  style={{ marginTop: 12, borderRadius: 8 }}
                >
                  {installing
                    ? 'Installing\u2026'
                    : installed
                    ? 'Refresh from latest'
                    : 'Install kit'}
                </Button>
              </Surface>
            );
          })}

          {installedFlags && (
            <View style={styles.footnote}>
              <ActivityIndicator size={12} animating={installingId !== null} />
              <Text style={styles.footnoteText}>
                More kits coming soon \u2014 fencing, decking, painting and more.
              </Text>
            </View>
          )}
        </WebContainer>
      </ScrollView>

      <AlertModal
        visible={!!resultMsg}
        type="success"
        title="Kit installed"
        message={resultMsg || ''}
        onDismiss={() => setResultMsg(null)}
        primaryButtonText="OK"
        primaryButtonAction={() => setResultMsg(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: {
    padding: 16,
    paddingBottom: 80,
    ...(Platform.OS === 'web' && { maxWidth: 700, margin: 'auto' as any, width: '100%' }),
  },
  intro: { color: colors.onSurface, marginBottom: 16 },
  card: {
    padding: 14,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: colors.surface,
    marginBottom: 12,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: 12, color: colors.onSurface, marginTop: 2 },
  cardDesc: { color: colors.onSurface, fontSize: 13, marginTop: 12, lineHeight: 18 },
  itemPreview: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 10 },
  itemPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: colors.surfaceDark || colors.background,
    maxWidth: 260,
  },
  itemPillText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  installedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  installedBadgeText: { color: colors.surface, fontSize: 10, fontWeight: '800' },
  footnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    padding: 12,
  },
  footnoteText: { color: colors.onSurface, fontSize: 12 },
});
