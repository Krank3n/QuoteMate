/**
 * Photo Annotator Component
 * Full-screen modal with drawing, arrow, circle, and text annotation tools
 * Aspect-ratio-preserving canvas with color/stroke options
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  Dimensions,
  Platform,
  TextInput,
  Keyboard,
} from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Svg, { Path, Line, Ellipse, G, Polygon, Text as SvgText, Rect } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { colors } from '../theme';
import { selectionTap, lightTap } from '../utils/haptics';
import { useTourRefs } from './tour/useTourRefs';

// --- Types ---

type AnnotationTool = 'draw' | 'arrow' | 'circle' | 'text';

interface BaseAnnotation {
  id: string;
  tool: AnnotationTool;
  color: string;
  strokeWidth: number;
}

interface DrawAnnotation extends BaseAnnotation {
  tool: 'draw';
  pathData: string;
}

interface ArrowAnnotation extends BaseAnnotation {
  tool: 'arrow';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface CircleAnnotation extends BaseAnnotation {
  tool: 'circle';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

interface TextAnnotation extends BaseAnnotation {
  tool: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

type Annotation = DrawAnnotation | ArrowAnnotation | CircleAnnotation | TextAnnotation;

// --- Constants ---

const COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'White', value: '#ffffff' },
  { name: 'Green', value: '#22c55e' },
];

const STROKE_WIDTHS = [
  { label: 'Thin', value: 2 },
  { label: 'Medium', value: 4 },
  { label: 'Thick', value: 7 },
];

const TOOLS: { tool: AnnotationTool; icon: string }[] = [
  { tool: 'draw', icon: 'draw' },
  { tool: 'arrow', icon: 'arrow-top-right' },
  { tool: 'circle', icon: 'circle-outline' },
  { tool: 'text', icon: 'format-text' },
];

const TAP_THRESHOLD = 10;
const ARROW_HEAD_LENGTH = 28;
const ARROW_HEAD_ANGLE = Math.PI / 6; // 30 degrees
const TEXT_FONT_SIZE = 16;

// --- Props ---

interface PhotoAnnotatorProps {
  visible: boolean;
  imageUri: string;
  onSave: (annotatedUri: string) => void;
  onCancel: () => void;
  /** When true, renders as absolute View (not Modal) so tour overlay can appear on top */
  tourMode?: boolean;
}

// --- Helpers ---

let idCounter = 0;
function nextId(): string {
  return `ann_${Date.now()}_${++idCounter}`;
}

function getArrowHeadPoints(endX: number, endY: number, startX: number, startY: number): string {
  const angle = Math.atan2(endY - startY, endX - startX);
  const x1 = endX - ARROW_HEAD_LENGTH * Math.cos(angle - ARROW_HEAD_ANGLE);
  const y1 = endY - ARROW_HEAD_LENGTH * Math.sin(angle - ARROW_HEAD_ANGLE);
  const x2 = endX - ARROW_HEAD_LENGTH * Math.cos(angle + ARROW_HEAD_ANGLE);
  const y2 = endY - ARROW_HEAD_LENGTH * Math.sin(angle + ARROW_HEAD_ANGLE);
  return `${endX},${endY} ${x1},${y1} ${x2},${y2}`;
}

// --- Component ---

export function PhotoAnnotator({ visible, imageUri, onSave, onCancel, tourMode = false }: PhotoAnnotatorProps) {
  // Tool & style state
  const [activeTool, setActiveTool] = useState<AnnotationTool>('draw');
  const [selectedColor, setSelectedColor] = useState(COLORS[0].value);
  const [selectedStrokeWidth, setSelectedStrokeWidth] = useState(STROKE_WIDTHS[1].value);
  const [showOptions, setShowOptions] = useState(false);

  // Annotation state
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  // In-progress drawing state
  const [currentDraw, setCurrentDraw] = useState<string>('');
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  // Text input state
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);
  const textInputRef = useRef<TextInput>(null);

  // Canvas sizing
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const canvasRef = useRef<View>(null);
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

  // Track touch start position for tap detection
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  // Overlay ref for coordinate calculation
  const overlayRef = useRef<View>(null);

  // Tour mode refs — registered so the tour spotlight can target annotator elements
  const { registerRef } = useTourRefs();
  const tourCanvasRef = useRef<View>(null);
  const tourToolbarRef = useRef<View>(null);
  const tourDoneRef = useRef<View>(null);

  // Only register tour refs once the canvas has sized (image loaded).
  // This prevents the tour from measuring before the layout is ready.
  useEffect(() => {
    if (tourMode && visible && canvasSize) {
      // Small delay to let layout settle after canvasSize is set
      const timer = setTimeout(() => {
        if (tourCanvasRef.current) registerRef('annotatorCanvas', tourCanvasRef.current);
        if (tourToolbarRef.current) registerRef('annotatorTools', tourToolbarRef.current);
        if (tourDoneRef.current) registerRef('annotatorDone', tourDoneRef.current);
      }, 100);
      return () => {
        clearTimeout(timer);
        registerRef('annotatorCanvas', null);
        registerRef('annotatorTools', null);
        registerRef('annotatorDone', null);
      };
    }
  }, [tourMode, visible, canvasSize]);

  const getCanvasCoords = useCallback((e: any): { x: number; y: number } => {
    if (Platform.OS === 'web') {
      // Raw MouseEvent (from DOM listener) or RN synthetic event
      const clientX = e.clientX ?? e.nativeEvent?.clientX ?? 0;
      const clientY = e.clientY ?? e.nativeEvent?.clientY ?? 0;
      const node = overlayRef.current as unknown as HTMLElement | null;
      if (node?.getBoundingClientRect) {
        const rect = node.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
      }
      return { x: clientX, y: clientY };
    }
    // Native: use locationX/locationY from responder events
    const { locationX, locationY } = e.nativeEvent;
    return { x: locationX, y: locationY };
  }, []);

  // Load image dimensions on mount
  useEffect(() => {
    if (!visible || !imageUri) return;

    Image.getSize(
      imageUri,
      (imgWidth, imgHeight) => {
        const maxWidth = screenWidth - 32;
        const maxHeight = screenHeight - 220; // Leave room for header + toolbar
        const ratio = Math.min(maxWidth / imgWidth, maxHeight / imgHeight);
        setCanvasSize({
          width: Math.round(imgWidth * ratio),
          height: Math.round(imgHeight * ratio),
        });
      },
      () => {
        // Fallback to square if getSize fails
        const size = screenWidth - 32;
        setCanvasSize({ width: size, height: size });
      },
    );
  }, [visible, imageUri, screenWidth, screenHeight]);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      // In tour mode, pre-populate demo annotations
      if (tourMode) {
        setAnnotations([
          {
            id: 'demo-circle',
            tool: 'circle',
            color: '#ef4444',
            strokeWidth: 4,
            cx: 160, cy: 110, rx: 50, ry: 40,
          },
          {
            id: 'demo-arrow',
            tool: 'arrow',
            color: '#ef4444',
            strokeWidth: 4,
            startX: 100, startY: 260, endX: 160, endY: 320,
          },
        ]);
      } else {
        setAnnotations([]);
      }
      setCurrentDraw('');
      setDragStart(null);
      setDragCurrent(null);
      setTextInput(null);
      setShowOptions(false);
      setActiveTool('draw');
      setCanvasSize(null);
    }
  }, [visible, tourMode]);

  // Track whether mouse is pressed (for web)
  const isDrawing = useRef(false);

  // Use refs to always access the latest state inside DOM event listeners,
  // avoiding stale closure issues with useEffect-attached handlers.
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const selectedColorRef = useRef(selectedColor);
  selectedColorRef.current = selectedColor;
  const selectedStrokeWidthRef = useRef(selectedStrokeWidth);
  selectedStrokeWidthRef.current = selectedStrokeWidth;
  const currentDrawRef = useRef(currentDraw);
  currentDrawRef.current = currentDraw;
  const dragStartRef = useRef(dragStart);
  dragStartRef.current = dragStart;

  // --- Touch handlers ---

  const handleTouchStart = useCallback((e: any) => {
    setShowOptions(false);

    const { x, y } = getCanvasCoords(e);
    touchStartPos.current = { x, y };

    const tool = activeToolRef.current;
    if (tool === 'draw') {
      setCurrentDraw(`M ${x} ${y}`);
    } else if (tool === 'arrow' || tool === 'circle') {
      setDragStart({ x, y });
      setDragCurrent({ x, y });
    }
  }, [getCanvasCoords]);

  const handleTouchMove = useCallback((e: any) => {
    const { x, y } = getCanvasCoords(e);
    const tool = activeToolRef.current;

    if (tool === 'draw') {
      setCurrentDraw(prev => `${prev} L ${x} ${y}`);
    } else if ((tool === 'arrow' || tool === 'circle') && dragStartRef.current) {
      setDragCurrent({ x, y });
    }
  }, [getCanvasCoords]);

  const handleTouchEnd = useCallback((e: any) => {
    const { x, y } = getCanvasCoords(e);
    const tool = activeToolRef.current;
    const color = selectedColorRef.current;
    const sw = selectedStrokeWidthRef.current;
    const draw = currentDrawRef.current;
    const ds = dragStartRef.current;

    if (tool === 'draw' && draw) {
      setAnnotations(prev => [...prev, {
        id: nextId(),
        tool: 'draw',
        color,
        strokeWidth: sw,
        pathData: draw,
      }]);
      setCurrentDraw('');
    } else if (tool === 'arrow' && ds) {
      const dx = x - ds.x;
      const dy = y - ds.y;
      if (Math.sqrt(dx * dx + dy * dy) > TAP_THRESHOLD) {
        setAnnotations(prev => [...prev, {
          id: nextId(),
          tool: 'arrow',
          color,
          strokeWidth: sw,
          startX: ds.x,
          startY: ds.y,
          endX: x,
          endY: y,
        }]);
      }
      setDragStart(null);
      setDragCurrent(null);
    } else if (tool === 'circle' && ds) {
      const cx = (ds.x + x) / 2;
      const cy = (ds.y + y) / 2;
      const rx = Math.abs(x - ds.x) / 2;
      const ry = Math.abs(y - ds.y) / 2;
      if (rx > 5 || ry > 5) {
        setAnnotations(prev => [...prev, {
          id: nextId(),
          tool: 'circle',
          color,
          strokeWidth: sw,
          cx, cy, rx, ry,
        }]);
      }
      setDragStart(null);
      setDragCurrent(null);
    } else if (tool === 'text' && touchStartPos.current) {
      const dx = x - touchStartPos.current.x;
      const dy = y - touchStartPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) < TAP_THRESHOLD) {
        setTextInput({ x, y, value: '' });
        setTimeout(() => textInputRef.current?.focus(), 100);
      }
    }

    touchStartPos.current = null;
  }, [getCanvasCoords]);

  // Attach native DOM mouse listeners for web (responder system is unreliable for drag on web)
  useEffect(() => {
    if (Platform.OS !== 'web' || !canvasSize || tourMode) return;

    const node = overlayRef.current as unknown as HTMLElement | null;
    if (!node) return;

    // Prevent default drag/select behavior
    node.style.touchAction = 'none';
    node.style.userSelect = 'none';
    (node.style as any).webkitUserSelect = 'none';
    node.style.cursor = 'crosshair';

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      isDrawing.current = true;
      handleTouchStart(e);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDrawing.current) return;
      e.preventDefault();
      handleTouchMove(e);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      handleTouchEnd(e);
    };

    node.addEventListener('mousedown', onMouseDown);
    node.addEventListener('mousemove', onMouseMove);
    node.addEventListener('mouseup', onMouseUp);
    node.addEventListener('mouseleave', onMouseUp);

    return () => {
      node.removeEventListener('mousedown', onMouseDown);
      node.removeEventListener('mousemove', onMouseMove);
      node.removeEventListener('mouseup', onMouseUp);
      node.removeEventListener('mouseleave', onMouseUp);
    };
  }, [canvasSize, handleTouchStart, handleTouchMove, handleTouchEnd]);

  // --- Text submission ---

  const handleTextSubmit = useCallback(() => {
    if (textInput && textInput.value.trim()) {
      setAnnotations(prev => [...prev, {
        id: nextId(),
        tool: 'text',
        color: selectedColor,
        strokeWidth: selectedStrokeWidth,
        x: textInput.x,
        y: textInput.y,
        text: textInput.value.trim(),
        fontSize: TEXT_FONT_SIZE,
      }]);
    }
    setTextInput(null);
    Keyboard.dismiss();
  }, [textInput, selectedColor, selectedStrokeWidth]);

  // --- Actions ---

  const handleUndo = useCallback(() => {
    setAnnotations(prev => prev.slice(0, -1));
  }, []);

  // Ctrl+Z / Cmd+Z to undo on web
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, handleUndo]);

  const handleClear = () => {
    setAnnotations([]);
    setCurrentDraw('');
    setDragStart(null);
    setDragCurrent(null);
    setTextInput(null);
  };

  const handleToolPress = (tool: AnnotationTool) => {
    if (tool === activeTool) {
      setShowOptions(prev => !prev);
    } else {
      setActiveTool(tool);
      setShowOptions(false);
      selectionTap();
    }
  };

  const handleColorSelect = (color: string) => {
    setSelectedColor(color);
    lightTap();
  };

  const handleStrokeWidthSelect = (width: number) => {
    setSelectedStrokeWidth(width);
    lightTap();
  };

  const handleSave = async () => {
    if (!canvasRef.current) return;

    // Dismiss text input before capture
    if (textInput) {
      handleTextSubmit();
      await new Promise(r => setTimeout(r, 150));
    }

    if (Platform.OS === 'web') {
      // captureRef doesn't work on web — use canvas API to composite image + SVG
      try {
        const node = canvasRef.current as unknown as HTMLElement;
        const img = node?.querySelector?.('img');
        const svg = node?.querySelector?.('svg');

        if (!img || !canvasSize) {
          onSave(imageUri);
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = canvasSize.width;
        canvas.height = canvasSize.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { onSave(imageUri); return; }

        // Draw the photo
        ctx.drawImage(img, 0, 0, canvasSize.width, canvasSize.height);

        // Draw the SVG overlay
        if (svg && annotations.length > 0) {
          const svgData = new XMLSerializer().serializeToString(svg);
          const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
          const svgUrl = URL.createObjectURL(svgBlob);
          const svgImg = new window.Image();
          await new Promise<void>((resolve, reject) => {
            svgImg.onload = () => resolve();
            svgImg.onerror = reject;
            svgImg.src = svgUrl;
          });
          ctx.drawImage(svgImg, 0, 0);
          URL.revokeObjectURL(svgUrl);
        }

        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        onSave(dataUrl);
      } catch (error) {
        console.error('Failed to capture annotated image on web:', error);
        // Fallback: save original image
        onSave(imageUri);
      }
      return;
    }

    try {
      const uri = await captureRef(canvasRef.current, {
        format: 'jpg',
        quality: 0.9,
      });
      onSave(uri);
    } catch (error) {
      console.error('Failed to capture annotated image:', error);
    }
  };

  // --- SVG Renderers ---

  const renderAnnotation = (ann: Annotation) => {
    switch (ann.tool) {
      case 'draw':
        return (
          <Path
            key={ann.id}
            d={ann.pathData}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'arrow': {
        const headPoints = getArrowHeadPoints(ann.endX, ann.endY, ann.startX, ann.startY);
        return (
          <G key={ann.id}>
            <Line
              x1={ann.startX}
              y1={ann.startY}
              x2={ann.endX}
              y2={ann.endY}
              stroke={ann.color}
              strokeWidth={ann.strokeWidth}
              strokeLinecap="round"
            />
            <Polygon
              points={headPoints}
              fill={ann.color}
            />
          </G>
        );
      }
      case 'circle':
        return (
          <Ellipse
            key={ann.id}
            cx={ann.cx}
            cy={ann.cy}
            rx={ann.rx}
            ry={ann.ry}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            fill="none"
          />
        );
      case 'text': {
        const bgWidth = ann.text.length * ann.fontSize * 0.6;
        const bgHeight = ann.fontSize * 1.4;
        return (
          <G key={ann.id}>
            <Rect
              x={ann.x - 4}
              y={ann.y - bgHeight + 4}
              width={bgWidth + 8}
              height={bgHeight}
              fill="rgba(0,0,0,0.6)"
              rx={4}
            />
            <SvgText
              x={ann.x}
              y={ann.y}
              fill={ann.color}
              fontSize={ann.fontSize}
              fontWeight="600"
            >
              {ann.text}
            </SvgText>
          </G>
        );
      }
    }
  };

  const renderInProgress = () => {
    // Draw tool in-progress
    if (activeTool === 'draw' && currentDraw) {
      return (
        <Path
          d={currentDraw}
          stroke={selectedColor}
          strokeWidth={selectedStrokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }

    // Arrow tool in-progress
    if (activeTool === 'arrow' && dragStart && dragCurrent) {
      const headPoints = getArrowHeadPoints(dragCurrent.x, dragCurrent.y, dragStart.x, dragStart.y);
      return (
        <G>
          <Line
            x1={dragStart.x}
            y1={dragStart.y}
            x2={dragCurrent.x}
            y2={dragCurrent.y}
            stroke={selectedColor}
            strokeWidth={selectedStrokeWidth}
            strokeLinecap="round"
          />
          <Polygon
            points={headPoints}
            fill={selectedColor}
          />
        </G>
      );
    }

    // Circle tool in-progress
    if (activeTool === 'circle' && dragStart && dragCurrent) {
      const cx = (dragStart.x + dragCurrent.x) / 2;
      const cy = (dragStart.y + dragCurrent.y) / 2;
      const rx = Math.abs(dragCurrent.x - dragStart.x) / 2;
      const ry = Math.abs(dragCurrent.y - dragStart.y) / 2;
      return (
        <Ellipse
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          stroke={selectedColor}
          strokeWidth={selectedStrokeWidth}
          fill="none"
        />
      );
    }

    return null;
  };

  const hasAnnotations = annotations.length > 0;

  const Wrapper = tourMode ? View : Modal;
  const wrapperProps = tourMode
    ? { style: [StyleSheet.absoluteFill, { zIndex: 999 }] }
    : { visible, animationType: 'slide' as const, presentationStyle: 'fullScreen' as const };

  return (
    <Wrapper {...wrapperProps as any}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={tourMode ? undefined : onCancel} style={styles.headerButton} disabled={tourMode}>
            <Text style={[styles.headerButtonText, tourMode && { opacity: 0.3 }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Annotate Photo</Text>
          <TouchableOpacity ref={tourDoneRef} onPress={tourMode ? undefined : handleSave} style={styles.headerButton} disabled={tourMode}>
            <Text style={[styles.headerButtonText, { color: colors.primary }]}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Canvas */}
        <View style={styles.canvasContainer}>
          {canvasSize ? (
            <View
              ref={(node) => { (canvasRef as any).current = node; (tourCanvasRef as any).current = node; }}
              style={[styles.canvas, { width: canvasSize.width, height: canvasSize.height }]}
              collapsable={false}
            >
              <Image
                source={{ uri: imageUri }}
                style={[styles.imageLayer, { width: canvasSize.width, height: canvasSize.height }]}
                resizeMode="cover"
              />
              <View
                style={styles.touchOverlay}
                ref={overlayRef}
                {...(Platform.OS !== 'web' && !tourMode ? {
                  onStartShouldSetResponder: () => true,
                  onMoveShouldSetResponder: () => true,
                  onResponderStart: handleTouchStart,
                  onResponderMove: handleTouchMove,
                  onResponderRelease: handleTouchEnd,
                } : {})}
              >
                <Svg
                  style={styles.svgLayer}
                  width={canvasSize.width}
                  height={canvasSize.height}
                  viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
                  pointerEvents="none"
                >
                  {annotations.map(renderAnnotation)}
                  {renderInProgress()}
                </Svg>
              </View>

              {/* Floating text input */}
              {textInput && (
                <View
                  style={[
                    styles.textInputContainer,
                    { left: textInput.x - 4, top: textInput.y - 24 },
                  ]}
                >
                  <TextInput
                    ref={textInputRef}
                    style={[styles.textInput, { color: selectedColor }]}
                    value={textInput.value}
                    onChangeText={(val) => setTextInput(prev => prev ? { ...prev, value: val } : null)}
                    onSubmitEditing={handleTextSubmit}
                    onBlur={handleTextSubmit}
                    placeholder="Label..."
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    autoCapitalize="none"
                    returnKeyType="done"
                    blurOnSubmit
                  />
                </View>
              )}
            </View>
          ) : (
            <View style={styles.canvasPlaceholder} />
          )}
        </View>

        {/* Options panel (floating above toolbar) */}
        {showOptions && (
          <View style={styles.optionsPanel}>
            {/* Colors */}
            <View style={styles.optionsRow}>
              {COLORS.map((color) => (
                <TouchableOpacity
                  key={color.value}
                  onPress={() => handleColorSelect(color.value)}
                  style={[
                    styles.colorCircle,
                    { backgroundColor: color.value },
                    selectedColor === color.value && styles.colorCircleSelected,
                    color.value === '#ffffff' && styles.colorCircleWhiteBorder,
                  ]}
                />
              ))}
            </View>
            {/* Stroke widths */}
            <View style={styles.optionsRow}>
              {STROKE_WIDTHS.map((sw) => (
                <TouchableOpacity
                  key={sw.value}
                  onPress={() => handleStrokeWidthSelect(sw.value)}
                  style={[
                    styles.strokeButton,
                    selectedStrokeWidth === sw.value && styles.strokeButtonSelected,
                  ]}
                >
                  <View
                    style={[
                      styles.strokePreview,
                      {
                        height: sw.value,
                        width: 24,
                        backgroundColor: selectedColor,
                        borderRadius: sw.value / 2,
                      },
                    ]}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Bottom toolbar */}
        <View ref={tourToolbarRef} style={styles.toolbar}>
          {/* Tool buttons */}
          <View style={styles.toolButtons}>
            {TOOLS.map(({ tool, icon }) => (
              <TouchableOpacity
                key={tool}
                onPress={() => handleToolPress(tool)}
                style={[
                  styles.toolButton,
                  activeTool === tool && styles.toolButtonActive,
                ]}
              >
                <MaterialCommunityIcons
                  name={icon as any}
                  size={24}
                  color={activeTool === tool ? '#fff' : 'rgba(255,255,255,0.45)'}
                />
              </TouchableOpacity>
            ))}
          </View>

          {/* Action buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity
              onPress={handleUndo}
              style={styles.actionButton}
              disabled={!hasAnnotations}
            >
              <MaterialCommunityIcons
                name="undo"
                size={24}
                color={hasAnnotations ? colors.text : 'rgba(255,255,255,0.2)'}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleClear}
              style={styles.actionButton}
              disabled={!hasAnnotations}
            >
              <MaterialCommunityIcons
                name="delete-outline"
                size={24}
                color={hasAnnotations ? colors.text : 'rgba(255,255,255,0.2)'}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 16,
    paddingBottom: 12,
  },
  headerButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 60,
  },
  headerButtonText: {
    fontSize: 16,
    color: colors.text,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  canvasContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  canvas: {
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    position: 'relative',
  },
  imageLayer: {
    borderRadius: 8,
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 1,
  },
  canvasPlaceholder: {
    width: 100,
    height: 100,
  },
  touchOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
  },
  svgLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 2,
  },
  textInputContainer: {
    position: 'absolute',
    minWidth: 120,
    zIndex: 20,
  },
  textInput: {
    fontSize: TEXT_FONT_SIZE,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  optionsPanel: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    gap: 12,
  },
  optionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    alignItems: 'center',
  },
  colorCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorCircleSelected: {
    borderColor: '#fff',
    borderWidth: 3,
  },
  colorCircleWhiteBorder: {
    borderColor: 'rgba(255,255,255,0.3)',
    borderWidth: 1,
  },
  strokeButton: {
    padding: 8,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 44,
    minHeight: 36,
  },
  strokeButtonSelected: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  strokePreview: {},
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  toolButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  toolButton: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  toolButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  actionButton: {
    padding: 8,
  },
});
