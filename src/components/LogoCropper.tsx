/**
 * Free-form logo cropper that works on every platform.
 *
 * expo-image-picker's `allowsEditing` opens the OS crop tool on iOS and
 * Android but is silently ignored on web — its web implementation is a plain
 * <input type="file">. So web users had no way to crop at all, and native
 * users were forced into the platform's default frame (square on iOS, 4:3 on
 * Android), which is the wrong shape for the wide wordmark most trade logos
 * actually are.
 *
 * expo-image-manipulator's crop action IS implemented on web (canvas-backed),
 * so doing the framing ourselves gives one cropper, one behaviour, any shape.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Image,
  StyleSheet,
  PanResponder,
  LayoutChangeEvent,
  Modal,
} from 'react-native';
import { Text, Button } from 'react-native-paper';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { colors } from '../theme';
import {
  fitImage,
  clampToImage,
  toSourceCrop,
  resizeFromCorner,
  type Rect,
} from './logoCropMath';

export interface LogoCropperProps {
  visible: boolean;
  uri: string;
  onCancel: () => void;
  onCropped: (uri: string) => void;
}

/** Smallest crop we allow, in on-screen points. */
const MIN_SIZE = 40;
const HANDLE = 28;

export function LogoCropper({ visible, uri, onCancel, onCropped }: LogoCropperProps) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live copy for the gesture handlers — PanResponder closures capture state
  // from the render they were created in, so reading `box` there goes stale.
  const boxRef = useRef<Rect | null>(null);
  boxRef.current = box;
  const startRef = useRef<Rect | null>(null);

  useEffect(() => {
    if (!visible || !uri) return;
    setNatural(null);
    setBox(null);
    setError(null);
    Image.getSize(
      uri,
      (w, h) => setNatural({ w, h }),
      () => setNatural(null),
    );
  }, [uri, visible]);

  /** Where the image actually sits inside the frame once letterboxed. */
  const fit = useMemo(
    () => (natural && frame ? fitImage(natural, frame) : null),
    [natural, frame],
  );

  useEffect(() => {
    if (fit) setBox({ x: fit.x, y: fit.y, w: fit.w, h: fit.h });
  }, [fit]);

  const clamp = (r: Rect): Rect => (fit ? clampToImage(r, fit, MIN_SIZE) : r);

  const bodyPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startRef.current = boxRef.current;
        },
        onPanResponderMove: (_e, g) => {
          const s = startRef.current;
          if (!s) return;
          setBox(clamp({ ...s, x: s.x + g.dx, y: s.y + g.dy }));
        },
      }),
    [fit],
  );

  /** One resize handle. `sx`/`sy` say which edges this corner moves. */
  const cornerPan = (sx: -1 | 1, sy: -1 | 1) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = boxRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const s = startRef.current;
        if (!s || !fit) return;
        setBox(clamp(resizeFromCorner(s, g.dx, g.dy, sx, sy, MIN_SIZE)));
      },
    });

  const corners = useMemo(
    () => ({
      tl: cornerPan(-1, -1),
      tr: cornerPan(1, -1),
      bl: cornerPan(-1, 1),
      br: cornerPan(1, 1),
    }),
    [fit],
  );

  const onFrameLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setFrame({ w: width, h: height });
  };

  const apply = async () => {
    if (!box || !fit || !natural) return onCropped(uri);
    setBusy(true);
    try {
      const crop = toSourceCrop(box, fit, natural);
      const result = await manipulateAsync(uri, [{ crop }], { format: SaveFormat.PNG });
      onCropped(result.uri);
    } catch {
      // Stay open and say so rather than silently handing back the uncropped
      // image — a Crop button that quietly does nothing is worse than none.
      // The usual cause on web is re-cropping an already-stored logo: reading
      // a cross-origin image into a canvas taints it unless the Storage bucket
      // has a CORS rule for this origin. A freshly picked file is a blob URL,
      // so it is same-origin and crops fine.
      setError("We couldn't crop that image. You can still use it as it is.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => fit && setBox({ x: fit.x, y: fit.y, w: fit.w, h: fit.h });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Crop your logo</Text>
          <Text style={styles.subtitle}>
            Drag the corners in to cut off any empty space around the artwork.
          </Text>

          <View style={styles.frame} onLayout={onFrameLayout}>
            {!!uri && <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />}
            {box && (
              <>
                <View style={[styles.shade, { left: 0, top: 0, right: 0, height: box.y }]} />
                <View style={[styles.shade, { left: 0, top: box.y + box.h, right: 0, bottom: 0 }]} />
                <View style={[styles.shade, { left: 0, top: box.y, width: box.x, height: box.h }]} />
                <View
                  style={[styles.shade, { left: box.x + box.w, top: box.y, right: 0, height: box.h }]}
                />
                <View
                  {...bodyPan.panHandlers}
                  style={[styles.box, { left: box.x, top: box.y, width: box.w, height: box.h }]}
                />
                <Handle pan={corners.tl} style={{ left: box.x - HANDLE / 2, top: box.y - HANDLE / 2 }} />
                <Handle
                  pan={corners.tr}
                  style={{ left: box.x + box.w - HANDLE / 2, top: box.y - HANDLE / 2 }}
                />
                <Handle
                  pan={corners.bl}
                  style={{ left: box.x - HANDLE / 2, top: box.y + box.h - HANDLE / 2 }}
                />
                <Handle
                  pan={corners.br}
                  style={{ left: box.x + box.w - HANDLE / 2, top: box.y + box.h - HANDLE / 2 }}
                />
              </>
            )}
          </View>

          {!!error && (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{error}</Text>
              <Button mode="text" compact onPress={() => onCropped(uri)} disabled={busy}>
                Use uncropped
              </Button>
            </View>
          )}

          <View style={styles.actions}>
            <Button mode="text" onPress={reset} disabled={busy}>
              Reset
            </Button>
            <View style={styles.spacer} />
            <Button mode="text" onPress={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button mode="contained" onPress={apply} loading={busy} disabled={busy || !box}>
              Use this
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Handle({ pan, style }: { pan: ReturnType<typeof PanResponder.create>; style: object }) {
  return (
    <View {...pan.panHandlers} style={[styles.handleHit, style]}>
      <View style={styles.handleDot} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 12,
  },
  frame: {
    height: 300,
    borderRadius: 8,
    backgroundColor: '#0B1220',
    overflow: 'hidden',
  },
  shade: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  handleHit: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.onPrimary,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: colors.error,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  spacer: {
    flex: 1,
  },
});
