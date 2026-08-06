/**
 * Logo preview + background chooser.
 *
 * Every "my logo looks wrong" ticket starts the same way: the logo is previewed
 * on the settings card, but it lands on invoice paper. A white or black plate
 * that is invisible against a dark app background is a hard rectangle there.
 *
 * So the two variants are shown side by side, on the surface they actually
 * print on, and the tradie picks by tapping the one that looks right. That is
 * the same decision a "remove background" switch would ask for, minus the part
 * where they have to imagine the result.
 *
 * Both surfaces matter: most templates print on light paper, but Bold runs a
 * dark header where a dark logo disappears instead — hence the surface toggle.
 */

import React, { useState } from 'react';
import { View, StyleSheet, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text, Button, IconButton } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../theme';

/** Matches the tradesman template's paper in shared/pdf/templates.ts. */
const PAPER = '#FDFCF8';
/** Matches the bold template's header. */
const DARK_HEADER = '#1F2937';

export type LogoBackgroundKind = 'transparent' | 'light' | 'dark' | 'busy';

export interface LogoPreviewCardProps {
  originalUri: string;
  noBackgroundUri?: string;
  background?: LogoBackgroundKind;
  /** Why no variant was produced — the real reason, not the classification. */
  noBackgroundReason?: 'transparent' | 'busy' | 'ragged';
  useNoBackground: boolean;
  onChangeUseNoBackground: (value: boolean) => void;
  onPickLogo: () => void;
  /** Re-open the cropper on the logo already chosen. */
  onRecropLogo?: () => void;
  onRemoveLogo: () => void;
  disabled?: boolean;
  /** Server is still producing the variants. */
  loading?: boolean;
}

export function LogoPreviewCard({
  originalUri,
  noBackgroundUri,
  background,
  noBackgroundReason,
  useNoBackground,
  onChangeUseNoBackground,
  onPickLogo,
  onRecropLogo,
  onRemoveLogo,
  disabled,
  loading,
}: LogoPreviewCardProps) {
  const [surface, setSurface] = useState<'paper' | 'dark'>('paper');
  const backdrop = surface === 'paper' ? PAPER : DARK_HEADER;
  const canChoose = !!noBackgroundUri;

  return (
    <View>
      <View style={styles.surfaceRow}>
        <Text style={styles.caption}>How it prints</Text>
        <View style={styles.pills}>
          <Pill
            label="On paper"
            active={surface === 'paper'}
            onPress={() => setSurface('paper')}
            disabled={disabled}
          />
          <Pill
            label="On dark header"
            active={surface === 'dark'}
            onPress={() => setSurface('dark')}
            disabled={disabled}
          />
        </View>
      </View>

      {loading ? (
        <View style={[styles.single, { backgroundColor: backdrop }]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : canChoose ? (
        <View style={styles.choiceRow}>
          <ChoiceCard
            uri={originalUri}
            backdrop={backdrop}
            label="Keep background"
            selected={!useNoBackground}
            // Tap an unselected card to choose it; tap the one already chosen
            // to edit it. Keeps a single tap target per card instead of
            // nesting a button inside a button.
            onPress={() => (useNoBackground ? onChangeUseNoBackground(false) : onRecropLogo?.())}
            onEdit={onRecropLogo}
            disabled={disabled}
          />
          <ChoiceCard
            uri={noBackgroundUri!}
            backdrop={backdrop}
            label="Remove it"
            selected={useNoBackground}
            onPress={() => (useNoBackground ? onRecropLogo?.() : onChangeUseNoBackground(true))}
            onEdit={onRecropLogo}
            disabled={disabled}
          />
        </View>
      ) : (
        // Tapping the image is the obvious way to edit it, so make the preview
        // itself the target rather than hiding editing behind the button row.
        <TouchableOpacity
          style={[styles.single, { backgroundColor: backdrop }]}
          onPress={onRecropLogo}
          disabled={disabled || !onRecropLogo}
          accessibilityRole="button"
          accessibilityLabel="Crop this image"
        >
          <Image source={{ uri: originalUri }} style={styles.singleImage} resizeMode="contain" />
          {!!onRecropLogo && (
            <View style={styles.editBadge}>
              <MaterialCommunityIcons name="crop" size={13} color={colors.onPrimary} />
              <Text style={styles.editBadgeText}>Edit</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {!loading && (
        <Text style={styles.hint}>
          {canChoose
            ? 'Tap whichever looks right on the page, or tap it again to crop.'
            : unavailableReason(background, noBackgroundReason)}
        </Text>
      )}

      <View style={styles.buttons}>
        {!!onRecropLogo && (
          <Button
            mode="outlined"
            icon="crop"
            compact
            onPress={onRecropLogo}
            style={styles.button}
            disabled={disabled}
          >
            Crop
          </Button>
        )}
        <Button
          mode="outlined"
          icon="image-edit-outline"
          compact
          onPress={onPickLogo}
          style={styles.button}
          disabled={disabled}
        >
          Replace
        </Button>
        <IconButton
          icon="delete-outline"
          iconColor={colors.error}
          size={22}
          onPress={onRemoveLogo}
          disabled={disabled}
        />
      </View>
    </View>
  );
}

/**
 * Why there's nothing to choose between. Each case is a genuinely different
 * situation for the tradie, so name it rather than going quiet.
 */
function unavailableReason(
  background?: LogoBackgroundKind,
  reason?: 'transparent' | 'busy' | 'ragged',
): string {
  // Prefer the reason the server actually gave. Reading it off `background`
  // instead tells the wrong story — a dark logo can have a perfectly cuttable
  // plate, and a light one can be refused for a ragged edge.
  switch (reason) {
    case 'transparent':
      return 'Already has a clear background — nothing to remove.';
    case 'busy':
      return 'This looks like a photo of your signage rather than a logo file. A PNG from whoever made your branding will print much sharper.';
    case 'ragged':
      return 'The background here is too uneven to cut out cleanly — it would leave a ragged edge around the artwork.';
  }
  // No reason and no classification: never analysed. Claiming there is nothing
  // to remove would be a guess dressed up as a finding.
  return background
    ? 'No background we can remove cleanly on this one.'
    : "We haven't checked this logo's background yet.";
}

function ChoiceCard({
  uri,
  backdrop,
  label,
  selected,
  onPress,
  onEdit,
  disabled,
}: {
  uri: string;
  backdrop: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  onEdit?: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.choice, selected && styles.choiceSelected]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <View style={[styles.choicePreview, { backgroundColor: backdrop }]}>
        <Image source={{ uri }} style={styles.choiceImage} resizeMode="contain" />
        {selected && !!onEdit && (
          <View style={styles.editBadge}>
            <MaterialCommunityIcons name="crop" size={12} color={colors.onPrimary} />
            <Text style={styles.editBadgeText}>Edit</Text>
          </View>
        )}
      </View>
      <View style={styles.choiceFooter}>
        <MaterialCommunityIcons
          name={selected ? 'radiobox-marked' : 'radiobox-blank'}
          size={16}
          color={selected ? colors.primary : colors.textMuted}
        />
        <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function Pill({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.pill, active && styles.pillActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  surfaceRow: {
    marginTop: 10,
    marginBottom: 10,
  },
  caption: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginBottom: 6,
  },
  pills: {
    flexDirection: 'row',
    gap: 6,
  },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.primaryBg,
    borderColor: colors.primary,
  },
  pillText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  pillTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 10,
  },
  choice: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    backgroundColor: colors.surfaceDark,
  },
  choiceSelected: {
    borderColor: colors.primary,
  },
  choicePreview: {
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  choiceImage: {
    width: '100%',
    height: '100%',
  },
  choiceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  choiceLabel: {
    flex: 1,
    fontSize: 12,
    color: colors.textMuted,
  },
  choiceLabelSelected: {
    color: colors.text,
    fontWeight: '600',
  },
  editBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  editBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.onPrimary,
  },
  single: {
    height: 130,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    // The dark-header swatch is #1F2937, near-identical to the settings card,
    // so without an outline the preview has no visible edge and the logo just
    // floats. The border shows where the "paper" actually ends.
    borderWidth: 1,
    borderColor: colors.border,
  },
  singleImage: {
    width: '100%',
    height: '100%',
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 10,
    lineHeight: 17,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  button: {
    flex: 1,
  },
});
