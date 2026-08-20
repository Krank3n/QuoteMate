/**
 * The heading above a job's competing quote options, and the one action that
 * belongs to the SET rather than to any single option: previewing them as one
 * document.
 *
 * Each option card already carries its own Preview PDF — that is the document
 * for that price on its own. This is the sheet the customer actually gets when
 * a job is quoted several ways: an option per block, a total each, and no
 * grand total. See shared/pdf/htmlBuilders.buildQuoteOptionsPdfHtml.
 */

import React, { useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Document } from '../types/document';
import { useStore } from '../store/useStore';
import { previewOptionsPDF } from '../utils/pdfGenerator';
import { makeStyles, useThemeColors } from '../theme';
import { selectionTap } from '../utils/haptics';
import { useAlertModal } from '../hooks/useAlertModal';

interface QuoteOptionsHeaderProps {
  options: Document[];
}

export function QuoteOptionsHeader({ options }: QuoteOptionsHeaderProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const businessSettings = useStore((s) => s.businessSettings);
  const subscriptionStatus = useStore((s) => s.subscriptionStatus);
  const isTrialActive = !!(
    subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired
  );
  const isPro = subscriptionStatus?.isPro || isTrialActive;
  const { showAlert, alertNode } = useAlertModal();
  const [previewing, setPreviewing] = useState(false);

  const handlePreview = async () => {
    selectionTap();
    setPreviewing(true);
    try {
      await previewOptionsPDF(options, businessSettings, { isPro });
    } catch (err) {
      console.error('[options PDF preview] failed:', err);
      showAlert({
        type: 'error',
        title: 'Preview failed',
        message: "Couldn't open the PDF. Try again in a moment.",
      });
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Options</Text>
      <Text style={styles.hint}>
        Alternative prices for the same job. Your customer picks one, and
        accepting it takes the others off the table.
      </Text>
      <Pressable
        onPress={handlePreview}
        disabled={previewing}
        style={({ pressed }) => [
          styles.previewBoth,
          pressed && styles.previewBothPressed,
          previewing && styles.previewBothDisabled,
        ]}
      >
        {previewing ? (
          <ActivityIndicator size="small" color={themeColors.accentText} />
        ) : (
          <MaterialCommunityIcons
            name={'file-eye-outline' as any}
            size={16}
            color={themeColors.accentText}
          />
        )}
        <Text style={styles.previewBothLabel}>
          Preview all {options.length} as one PDF
        </Text>
      </Pressable>
      {alertNode}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { marginTop: 4, gap: 6 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: t.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 20,
  },
  hint: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginHorizontal: 20,
    lineHeight: 16,
  },
  previewBoth: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 20,
    marginTop: 4,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.accent + '55',
    backgroundColor: t.colors.accentSubtle,
  },
  previewBothPressed: { opacity: 0.7 },
  previewBothDisabled: { opacity: 0.5 },
  previewBothLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.accentText,
  },
}));
