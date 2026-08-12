/**
 * The whole brand-image flow in one place: pick → crop → process → choose.
 *
 * Company logos, accreditation badges and the onboarding logo step all want
 * exactly this, and all three previously did it differently — onboarding and
 * settings each had their own picker, and credential badges had no cropper or
 * background handling at all. Anything a tradie puts on a document should get
 * the same treatment, so the flow lives here and the screens just say where to
 * store it and what to call it.
 *
 * Nothing it does is destructive: the untouched original is always kept, and
 * the background-removed variant is offered alongside rather than instead.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { makeStyles, useThemeColors } from '../theme';
import { LogoCropper } from './LogoCropper';
import { LogoPreviewCard } from './LogoPreviewCard';
import {
  uploadAndProcessBrandImage,
  processUploadedLogo,
  storagePathFromDownloadUrl,
  type ProcessedLogoVariants,
} from '../services/photoService';

export interface BrandImageValue {
  /** The variant currently in use — this is what goes on the PDF. */
  uri?: string;
  originalUri?: string;
  noBackgroundUri?: string;
  background?: ProcessedLogoVariants['background'];
  useNoBackground?: boolean;
}

export interface BrandImageEditorProps {
  value: BrandImageValue;
  onChange: (next: BrandImageValue) => void;
  /** Firebase Auth uid — uploads land under users/<uid>/. */
  userId?: string;
  /** Folder under the user's path, e.g. 'logo-uploads' or 'credential-uploads'. */
  folder: string;
  /** Empty-state wording. */
  emptyTitle: string;
  emptyHint?: string;
  /** Shown instead of the picker when the feature is gated. */
  locked?: boolean;
  onLockedPress?: () => void;
  disabled?: boolean;
}

export function BrandImageEditor({
  value,
  onChange,
  userId,
  folder,
  emptyTitle,
  emptyHint,
  locked,
  onLockedPress,
  disabled,
}: BrandImageEditorProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [pending, setPending] = useState<{ uri: string; mimeType?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Analysis of an image that was uploaded before any of this existed. Held
  // locally rather than pushed through onChange, because arriving on a screen
  // must not silently mark the form dirty — that would fire the unsaved-changes
  // guard over work the tradie never did. It is promoted into `value` only when
  // they actually pick a variant.
  const [analysed, setAnalysed] = useState<ProcessedLogoVariants | null>(null);

  const alreadyAnalysed = !!value.originalUri;
  const variants: ProcessedLogoVariants | null = alreadyAnalysed
    ? {
        originalUrl: value.originalUri!,
        noBackgroundUrl: value.noBackgroundUri,
        background: value.background || 'transparent',
        recommendNoBackground: !!value.useNoBackground,
      }
    : analysed;

  useEffect(() => {
    if (!userId || !value.uri || alreadyAnalysed) return;
    const path = storagePathFromDownloadUrl(value.uri);
    if (!path || !path.startsWith(`users/${userId}/`)) return;

    let cancelled = false;
    setBusy(true);
    processUploadedLogo(path)
      .then((result) => {
        if (!cancelled && result) setAnalysed(result);
      })
      .catch(() => {
        /* leave it un-analysed; the card explains that plainly */
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, value.uri, alreadyAnalysed]);

  const pick = async () => {
    if (locked) return onLockedPress?.();
    setError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.granted === false) {
        setError('Permission to access your photos is required.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        // Framing is LogoCropper's job — the OS editor is ignored on web and
        // forces a square / 4:3 frame on native.
        allowsEditing: false,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setPending({ uri: result.assets[0].uri, mimeType: result.assets[0].mimeType });
      }
    } catch {
      setError("Couldn't open the image picker. Please try again.");
    }
  };

  const handleCropped = async (croppedUri: string) => {
    // The cropper always writes PNG, so a changed URI means PNG regardless of
    // what was picked. Mislabelling it re-encodes a transparent image as JPEG
    // and flattens its alpha onto black.
    const mimeType = croppedUri !== pending?.uri ? 'image/png' : pending?.mimeType;
    setPending(null);
    if (!userId) {
      onChange({ ...value, uri: croppedUri, originalUri: croppedUri });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const variants = await uploadAndProcessBrandImage(userId, folder, croppedUri, mimeType);
      onChange({
        uri:
          variants.recommendNoBackground && variants.noBackgroundUrl
            ? variants.noBackgroundUrl
            : variants.originalUrl,
        originalUri: variants.originalUrl,
        noBackgroundUri: variants.noBackgroundUrl,
        background: variants.background,
        useNoBackground: variants.recommendNoBackground,
      });
    } catch {
      // Keep the crop even if the server pass fails — it still uploads on save.
      onChange({ ...value, uri: croppedUri, originalUri: croppedUri });
      setError("We couldn't analyse that image, but it will still be used.");
    } finally {
      setBusy(false);
    }
  };

  /** Picking a variant is the point at which a lazily-analysed logo gets
   *  committed into the form's own state. */
  const chooseVariant = (useNoBackground: boolean) => {
    const original = variants?.originalUrl || value.originalUri || value.uri;
    const noBg = variants?.noBackgroundUrl || value.noBackgroundUri;
    onChange({
      ...value,
      originalUri: original,
      noBackgroundUri: noBg,
      background: variants?.background || value.background,
      useNoBackground,
      uri: useNoBackground && noBg ? noBg : original,
    });
  };

  return (
    <View>
      {value.uri ? (
        <LogoPreviewCard
          originalUri={variants?.originalUrl || value.uri}
          noBackgroundUri={variants?.noBackgroundUrl}
          background={variants?.background}
          noBackgroundReason={variants?.noBackgroundReason}
          useNoBackground={!!value.useNoBackground}
          onChangeUseNoBackground={chooseVariant}
          onPickLogo={pick}
          onRecropLogo={() =>
            setPending({ uri: variants?.originalUrl || value.uri!, mimeType: undefined })
          }
          onRemoveLogo={() => onChange({})}
          disabled={disabled || busy}
          loading={busy}
        />
      ) : (
        <TouchableOpacity style={styles.empty} onPress={pick} disabled={disabled}>
          <MaterialCommunityIcons
            name={locked ? 'lock-outline' : 'image-plus'}
            size={40}
            color={locked ? themeColors.textMuted : themeColors.accent}
          />
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          {!!emptyHint && <Text style={styles.emptyHint}>{emptyHint}</Text>}
        </TouchableOpacity>
      )}

      {!!error && <Text style={styles.error}>{error}</Text>}

      <LogoCropper
        visible={!!pending}
        uri={pending?.uri || ''}
        onCancel={() => setPending(null)}
        onCropped={handleCropped}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.border,
    borderRadius: 10,
    paddingVertical: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  emptyTitle: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    color: t.colors.text,
  },
  emptyHint: {
    marginTop: 2,
    fontSize: 12,
    color: t.colors.textMuted,
  },
  error: {
    marginTop: 8,
    fontSize: 12,
    color: t.colors.error,
  },
}));
