/**
 * SuppliersStep
 *
 * Onboarding step that lets a tradie load their first supplier price book by
 * snapping a recent receipt or uploading a price list (PDF/photo). Reuses the
 * shared `useSupplierListImport` hook so the pipeline matches the Settings →
 * Supplier Book flow exactly: same extraction, same review modal, same writes
 * to materialFavorites + supplierGroups.
 *
 * The step is always skippable (the parent renders the Skip button). Each
 * successful save appends to `addedSuppliers` so the user gets visible proof
 * of the wow moment ("Mitre 10 — 12 prices saved") and can stack more before
 * moving on.
 */

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import {
  Text,
  Title,
  Paragraph,
  Surface,
  Button,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { makeStyles, useThemeColors } from '../../theme';
import { successTap, lightTap, errorTap } from '../../utils/haptics';
import { useSupplierListImport } from '../../hooks/useSupplierListImport';
import { SupplierListCaptureModal } from '../../components/SupplierListCaptureModal';
import { SupplierListReviewModal } from '../../components/SupplierListReviewModal';
import { SpreadsheetColumnMapperModal } from '../../components/SpreadsheetColumnMapperModal';
import { ActionSheet, type ActionSheetOption } from '../../components/ActionSheet';

export interface AddedSupplier {
  name: string;
  itemCount: number;
  contactFieldsApplied: number;
  itemNames: string[];
}

interface Props {
  addedSuppliers: AddedSupplier[];
  onSupplierAdded: (s: AddedSupplier) => void;
}

export function SuppliersStep({ addedSuppliers, onSupplierAdded }: Props) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [uploadSheetVisible, setUploadSheetVisible] = useState(false);

  const importer = useSupplierListImport({
    mode: 'add',
    onSaved: (summary) => {
      successTap();
      onSupplierAdded({
        name: summary.supplierName || 'Supplier',
        itemCount: summary.itemCount,
        contactFieldsApplied: summary.contactFieldsApplied,
        itemNames: summary.itemNames,
      });
    },
    onError: () => {
      errorTap();
    },
  });

  const isWorking =
    importer.phase === 'capturing' ||
    importer.phase === 'extracting' ||
    importer.phase === 'saving';

  const handleSnapReceipt = () => {
    lightTap();
    importer.clearError();
    importer.startImport('camera');
  };

  const handleUploadPriceList = () => {
    lightTap();
    importer.clearError();
    setUploadSheetVisible(true);
  };

  const launchFromSheet = (source: 'gallery' | 'pdf' | 'spreadsheet') => {
    setUploadSheetVisible(false);
    importer.startImport(source);
  };

  const uploadSheetOptions: ActionSheetOption[] = [
    { icon: 'file-pdf-box', label: 'Pick a PDF', onPress: () => launchFromSheet('pdf') },
    { icon: 'image-multiple', label: 'Pick photos from gallery', onPress: () => launchFromSheet('gallery') },
    {
      icon: 'file-table-outline',
      label: 'Pick CSV / Excel',
      onPress: () => launchFromSheet('spreadsheet'),
    },
  ];

  const renderExtractingOverlay = () => (
    <Surface style={[styles.card, styles.loadingCard]}>
      <ActivityIndicator size="large" color={themeColors.accentText} />
      <Text style={styles.loadingTitle}>{importer.loadingLabel}</Text>
      <Text style={styles.loadingSubtitle}>This usually takes 5–10 seconds.</Text>
    </Surface>
  );

  const renderSavedList = () => {
    if (addedSuppliers.length === 0) return null;
    return (
      <Surface style={[styles.card, styles.savedCard]}>
        <View style={styles.savedHeader}>
          <MaterialCommunityIcons name="check-circle" size={22} color={themeColors.money} />
          <Text style={styles.savedHeaderText}>
            {addedSuppliers.length === 1 ? 'Supplier saved' : `${addedSuppliers.length} suppliers saved`}
          </Text>
        </View>
        {addedSuppliers.map((s, idx) => {
          const items = s.itemCount > 0
            ? `${s.itemCount} price${s.itemCount === 1 ? '' : 's'} saved`
            : 'Contact saved';
          const sample = s.itemNames.length > 0
            ? s.itemNames.slice(0, 3).join(', ') + (s.itemCount > s.itemNames.length ? ` …and ${s.itemCount - s.itemNames.length} more` : '')
            : null;
          return (
            <View key={`${s.name}-${idx}`} style={styles.savedRow}>
              <Text style={styles.savedRowTitle}>{s.name}</Text>
              <Text style={styles.savedRowMeta}>
                {items}
                {s.contactFieldsApplied > 0
                  ? ` · ${s.contactFieldsApplied} contact detail${s.contactFieldsApplied === 1 ? '' : 's'}`
                  : ''}
              </Text>
              {sample ? <Text style={styles.savedRowSample}>{sample}</Text> : null}
            </View>
          );
        })}
        <Button
          mode="text"
          onPress={handleUploadPriceList}
          icon="plus"
          style={styles.addAnotherButton}
          disabled={isWorking}
        >
          Add another supplier
        </Button>
      </Surface>
    );
  };

  return (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <MaterialCommunityIcons
          name="truck-delivery"
          size={64}
          color={themeColors.accentText}
          style={styles.stepIcon}
        />
        <Title style={styles.stepTitle}>Real prices, in seconds</Title>
        <Paragraph style={styles.stepDescription}>
          Snap a recent receipt and we'll turn it into your supplier price book — every quote uses your real numbers, not a guess.
        </Paragraph>
      </View>

      {importer.phase === 'extracting' || importer.phase === 'saving' ? (
        renderExtractingOverlay()
      ) : (
        <>
          <TouchableOpacity
            style={styles.primaryAction}
            onPress={handleSnapReceipt}
            disabled={isWorking}
            activeOpacity={0.85}
          >
            <View style={styles.primaryIconCircle}>
              <MaterialCommunityIcons name="camera" size={28} color={themeColors.accentText} />
            </View>
            <View style={styles.actionText}>
              <Text style={styles.actionTitle}>Snap a recent receipt</Text>
              <Text style={styles.actionSubtitle}>Photo of a paid invoice or docket</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={themeColors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryAction}
            onPress={handleUploadPriceList}
            disabled={isWorking}
            activeOpacity={0.85}
          >
            <View style={styles.secondaryIconCircle}>
              <MaterialCommunityIcons name="file-upload-outline" size={26} color={themeColors.text} />
            </View>
            <View style={styles.actionText}>
              <Text style={styles.actionTitle}>Upload a price list</Text>
              <Text style={styles.actionSubtitle}>PDF or photo from your supplier</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={themeColors.textMuted} />
          </TouchableOpacity>
        </>
      )}

      {importer.errorMessage ? (
        <Surface style={styles.errorCard}>
          <View style={styles.errorRow}>
            <MaterialCommunityIcons name="alert-circle-outline" size={20} color={themeColors.error} />
            <Text style={styles.errorText}>{importer.errorMessage}</Text>
          </View>
          <Button
            mode="text"
            onPress={() => {
              importer.clearError();
            }}
            compact
          >
            Dismiss
          </Button>
        </Surface>
      ) : null}

      {renderSavedList()}

      <SupplierListCaptureModal
        visible={importer.captureModalVisible}
        onCancel={importer.cancelCapture}
        onComplete={importer.handleCaptureComplete}
        processing={importer.phase === 'extracting'}
        processingLabel={importer.loadingLabel}
        counterLabel="photos"
        tips={[
          'Hold steady and let the autofocus settle',
          'Capture the whole receipt — including the supplier header',
          'Make sure prices and product names are sharp',
          'Multiple pages? Snap them all before hitting Done',
        ]}
      />

      <SpreadsheetColumnMapperModal
        visible={importer.columnMappingVisible}
        parsed={importer.parsedSpreadsheet}
        initialMapping={importer.autoDetectedMapping}
        onCancel={importer.cancelColumnMapping}
        onConfirm={importer.applyColumnMapping}
      />

      <SupplierListReviewModal
        visible={importer.reviewModalVisible}
        initialSupplierName={importer.extractedSupplierName}
        initialItems={importer.extractedItems}
        existingSupplierNames={importer.existingSupplierNames}
        saving={importer.saving}
        onCancel={importer.cancelReview}
        onSave={importer.handleSaveImported}
      />

      <ActionSheet
        visible={uploadSheetVisible}
        onDismiss={() => setUploadSheetVisible(false)}
        title="Upload a price list"
        options={uploadSheetOptions}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  stepContainer: {
    padding: 20,
  },
  stepHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  stepIcon: {
    marginBottom: 16,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: t.colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 16,
    color: t.colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    borderWidth: 2,
    borderColor: t.colors.accent,
  },
  secondaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
  },
  primaryIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  secondaryIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: t.colors.surfaceOverlay,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  actionText: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text,
    marginBottom: 2,
  },
  actionSubtitle: {
    fontSize: 13,
    color: t.colors.textMuted,
  },
  card: {
    padding: 16,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
  },
  loadingCard: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  loadingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.text,
    marginTop: 16,
  },
  loadingSubtitle: {
    fontSize: 13,
    color: t.colors.textMuted,
    marginTop: 6,
  },
  savedCard: {
    backgroundColor: t.colors.moneySubtle,
    borderWidth: 1,
    borderColor: t.colors.moneySubtle,
  },
  savedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  savedHeaderText: {
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.money,
  },
  savedRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: t.colors.moneySubtle,
  },
  savedRowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: t.colors.text,
  },
  savedRowMeta: {
    fontSize: 13,
    color: t.colors.textMuted,
    marginTop: 2,
  },
  savedRowSample: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 4,
    fontStyle: 'italic',
  },
  addAnotherButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  errorCard: {
    padding: 12,
    marginBottom: 16,
    borderRadius: 10,
    backgroundColor: t.colors.errorSubtle,
    borderWidth: 1,
    borderColor: t.colors.errorSubtle,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 6,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: t.colors.error,
    lineHeight: 18,
  },
}));
