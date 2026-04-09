/**
 * SupplierListCaptureModal
 *
 * Full-screen multi-photo capture flow used by the Supplier Book "Import
 * price list → Take photo" path. The user can snap multiple pages in one
 * session, review thumbnails, remove any they don't like, and tap Done
 * to hand the captured URIs back to the parent for extraction.
 *
 * Built on expo-camera's CameraView (the legacy `expo-image-picker`
 * `launchCameraAsync` only captures one image at a time).
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Modal as RNModal,
  Animated,
} from 'react-native';
import { Text } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';

const DEFAULT_MAX_PHOTOS = 10;

const TIPS = [
  'Hold steady and let the autofocus settle',
  'Capture one page at a time',
  'Make sure all text is sharp and readable',
  'Avoid glare from overhead lights',
  "Get close — don't crop the edges",
  'Multiple pages? Snap them all before hitting Done',
];

interface Props {
  visible: boolean;
  /** Called with the captured local URIs in order. Empty array means cancel. */
  onComplete: (uris: string[]) => void;
  /** Called when the user taps cancel without capturing anything. */
  onCancel: () => void;
  /** When true, the modal shows a full-screen processing overlay so the user
   *  can't double-trigger the import while extraction runs. */
  processing?: boolean;
  /** Optional label shown under the processing spinner. */
  processingLabel?: string;
  /** Maximum number of photos that can be captured in one session. */
  maxPhotos?: number;
  /** Optional unit label shown in the counter (e.g. "pages", "photos"). */
  counterLabel?: string;
  /** Optional rotating tip strings to override the default supplier-list tips. */
  tips?: string[];
}

export function SupplierListCaptureModal({
  visible,
  onComplete,
  onCancel,
  processing = false,
  processingLabel,
  maxPhotos = DEFAULT_MAX_PHOTOS,
  counterLabel = 'pages',
  tips,
}: Props) {
  const tipList = tips && tips.length ? tips : TIPS;
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [photos, setPhotos] = useState<string[]>([]);
  const [busyShutter, setBusyShutter] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const tipFade = useRef(new Animated.Value(1)).current;
  const safeInsets = useSafeAreaInsets();

  // Reset state whenever the modal opens fresh.
  useEffect(() => {
    if (visible) {
      setPhotos([]);
      setTipIndex(0);
    }
  }, [visible]);

  // Request permission lazily on first open.
  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  // Rotate tips every 4s with a quick fade.
  useEffect(() => {
    if (!visible || processing) return;
    const id = setInterval(() => {
      Animated.sequence([
        Animated.timing(tipFade, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(tipFade, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      setTimeout(() => setTipIndex((i) => (i + 1) % tipList.length), 200);
    }, 4000);
    return () => clearInterval(id);
  }, [visible, processing, tipFade]);

  const handleShutter = async () => {
    if (busyShutter || photos.length >= maxPhotos) return;
    if (!cameraRef.current) return;
    setBusyShutter(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: false,
      });
      if (photo?.uri) {
        setPhotos((prev) => [...prev, photo.uri]);
      }
    } catch {
      // swallow — user can retry
    } finally {
      setBusyShutter(false);
    }
  };

  const handleRemove = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDone = () => {
    if (photos.length === 0) return;
    onComplete(photos);
  };

  const handleCancel = () => {
    setPhotos([]);
    onCancel();
  };

  // Always render the Modal so it exists in the tree from mount; toggling
  // its `visible` prop is reliable on Android, whereas mounting with
  // visible=true immediately sometimes fails to actually present.
  const permissionDenied = !!permission && !permission.granted;

  return (
    <RNModal
      visible={visible}
      animationType="slide"
      onRequestClose={handleCancel}
      transparent={false}
    >
      {permissionDenied ? (
        <View style={styles.permissionWrap}>
          <MaterialCommunityIcons name="camera-off-outline" size={64} color={colors.textMuted} />
          <Text style={styles.permissionTitle}>Camera access needed</Text>
          <Text style={styles.permissionBody}>
            Enable camera access to snap your supplier price list.
          </Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.permissionBtnText}>Grant access</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.permissionCancel} onPress={handleCancel}>
            <Text style={styles.permissionCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.root}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: safeInsets.top + 8 }]}>
          <TouchableOpacity style={styles.topBtn} onPress={handleCancel} hitSlop={8}>
            <MaterialCommunityIcons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <View style={styles.topCounter}>
            <MaterialCommunityIcons name="image-multiple-outline" size={16} color="#fff" />
            <Text style={styles.topCounterText}>
              {photos.length} / {maxPhotos} {counterLabel}
            </Text>
          </View>
          <View style={styles.topSpacer} />
        </View>

        {/* Bottom controls — float over the preview, no backdrop */}
        <View style={[styles.bottomBar, { paddingBottom: safeInsets.bottom + 16 }]}>
          {/* Rotating tip — sits just above the thumbnail strip, small + subtle */}
          <Animated.View style={[styles.tipWrap, { opacity: tipFade }]}>
            <Text style={styles.tipText}>{tipList[tipIndex]}</Text>
          </Animated.View>

          {/* Thumbnail strip */}
          {photos.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbStrip}
            >
              {photos.map((uri, idx) => (
                <View key={`${uri}-${idx}`} style={styles.thumbWrap}>
                  <Image source={{ uri }} style={styles.thumbImg} />
                  <TouchableOpacity
                    style={styles.thumbRemove}
                    onPress={() => handleRemove(idx)}
                    hitSlop={6}
                  >
                    <MaterialCommunityIcons name="close" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Action row: shutter + done (done only renders once we have a photo) */}
          <View style={styles.actionRow}>
            <View style={styles.actionSide} />
            <TouchableOpacity
              style={[styles.shutter, busyShutter && styles.shutterBusy]}
              onPress={handleShutter}
              disabled={busyShutter || photos.length >= maxPhotos}
              activeOpacity={0.8}
            >
              <View style={styles.shutterInner} />
            </TouchableOpacity>
            <View style={styles.actionSide}>
              {photos.length > 0 && (
                <TouchableOpacity style={styles.doneBtn} onPress={handleDone}>
                  <Text style={styles.doneBtnText}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

          {/* Processing overlay — blocks all input while extraction runs */}
          {processing && (
            <View style={styles.processingOverlay}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.processingText}>{processingLabel || 'Reading your price list…'}</Text>
            </View>
          )}
        </View>
      )}
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    zIndex: 2,
  },
  topBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topSpacer: {
    width: 44,
    height: 44,
  },
  topCounter: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  topCounterText: {
    color: '#fff',
    fontWeight: '600',
    marginLeft: 6,
    fontSize: 13,
  },
  tipWrap: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  tipText: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
  },
  thumbStrip: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 8,
  },
  thumbWrap: {
    width: 64,
    height: 64,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
    marginRight: 8,
    position: 'relative',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  thumbRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
    paddingBottom: 8,
  },
  actionSide: {
    flex: 1,
    alignItems: 'center',
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterBusy: {
    opacity: 0.5,
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#fff',
  },
  doneBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: colors.primary,
  },
  doneBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  doneBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  doneBtnTextDisabled: {
    color: 'rgba(255,255,255,0.5)',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  processingText: {
    marginTop: 16,
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  permissionWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: colors.background,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginTop: 16,
  },
  permissionBody: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  permissionBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: colors.primary,
  },
  permissionBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  permissionCancel: {
    marginTop: 16,
  },
  permissionCancelText: {
    color: colors.textMuted,
    fontWeight: '600',
  },
});
