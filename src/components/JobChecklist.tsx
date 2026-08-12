/**
 * JobChecklist
 *
 * Lightweight checkbox list stored on Job.checklist. Tradies brain-dump
 * materials, site tasks, follow-ups; tick them off as they go. Each item
 * can optionally carry notes and a due date (chip on the row, overdue
 * tint when past).
 *
 * Interactions:
 *   - Tap the checkbox: toggle done / undone.
 *   - Tap the row body: expand/collapse the notes + due-date editor.
 *   - Long-press the drag handle on native: reorder (DraggableFlatList).
 *     Web falls back to a static list — no drag there today.
 *   - "Add step" row at the bottom: inline TextInput, Enter to append.
 *
 * Lives inside ViewJobScreen's NestableScrollContainer so the
 * DraggableFlatList can sit inline without fighting the outer scroll.
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  NestableDraggableFlatList,
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import { format } from 'date-fns';

import type { Job, JobChecklistItem } from '../../shared/job/types';
import { makeStyles, useThemeColors } from '../theme';
import { useJobStore } from '../store/useJobStore';
import { generateId } from '../utils/generateId';
import { selectionTap, lightTap } from '../utils/haptics';
import { DueDateSheet } from './DueDateSheet';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface JobChecklistProps {
  job: Job;
}

export function JobChecklist({ job }: JobChecklistProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const saveJob = useJobStore((s) => s.saveJob);
  const items = job.checklist ?? [];
  const [pendingText, setPendingText] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(items.length > 0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dueSheetItemId, setDueSheetItemId] = useState<string | null>(null);

  const commit = async (next: JobChecklistItem[], skipAnim?: boolean) => {
    if (!skipAnim) {
      LayoutAnimation.configureNext({
        duration: 180,
        create: { type: 'easeInEaseOut', property: 'opacity' },
        update: { type: 'easeInEaseOut' },
        delete: { type: 'easeInEaseOut', property: 'opacity' },
      });
    }
    await saveJob({ ...job, checklist: next });
  };

  const patch = async (id: string, changes: Partial<JobChecklistItem>) => {
    const next = items.map((it) => (it.id === id ? { ...it, ...changes } : it));
    await commit(next);
  };

  const toggle = async (id: string) => {
    selectionTap();
    const target = items.find((it) => it.id === id);
    if (!target) return;
    const done = !target.done;
    await patch(id, { done, completedAt: done ? Date.now() : undefined });
  };

  const remove = async (id: string) => {
    lightTap();
    if (expandedId === id) setExpandedId(null);
    await commit(items.filter((it) => it.id !== id));
  };

  const add = async () => {
    const text = pendingText.trim();
    if (!text) return;
    const newItem: JobChecklistItem = {
      id: generateId(),
      text,
      done: false,
      createdAt: Date.now(),
    };
    setPendingText('');
    // Leave "adding" open so the tradie can rip through a list in one go.
    await commit([...items, newItem]);
  };

  const reorder = async (next: JobChecklistItem[]) => {
    // Drag-end fires a lot; skip LayoutAnimation to avoid a double bounce.
    await commit(next, true);
  };

  const dueSheetItem = items.find((it) => it.id === dueSheetItemId) || null;

  // Collapsed empty state — tap to open and start typing.
  if (!editing && items.length === 0) {
    return (
      <Pressable
        onPress={() => {
          selectionTap();
          setEditing(true);
          setAdding(true);
        }}
        style={({ pressed }) => [styles.emptyAdd, pressed && { opacity: 0.85 }]}
      >
        <MaterialCommunityIcons
          name={'checkbox-marked-circle-plus-outline' as any}
          size={18}
          color={themeColors.textMuted}
        />
        <Text style={styles.emptyAddLabel}>Add checklist</Text>
      </Pressable>
    );
  }

  const done = items.filter((it) => it.done).length;

  const renderRow = ({
    item,
    drag,
    isActive,
  }: RenderItemParams<JobChecklistItem>) => (
    <ScaleDecorator>
      <ChecklistRow
        item={item}
        isActive={isActive}
        expanded={expandedId === item.id}
        onToggleDone={() => toggle(item.id)}
        onToggleExpand={() =>
          setExpandedId((prev) => (prev === item.id ? null : item.id))
        }
        onDelete={() => remove(item.id)}
        onDrag={drag}
        onNotesChange={(text) => patch(item.id, { notes: text })}
        onOpenDueSheet={() => setDueSheetItemId(item.id)}
      />
    </ScaleDecorator>
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Checklist</Text>
        <Text style={styles.count}>
          {items.length === 0 ? 'New' : `${done} / ${items.length}`}
        </Text>
      </View>

      <View style={styles.list}>
        {Platform.OS !== 'web' ? (
          <NestableDraggableFlatList
            data={items}
            keyExtractor={(it) => it.id}
            renderItem={renderRow}
            onDragEnd={({ data }) => reorder(data)}
            activationDistance={10}
          />
        ) : (
          items.map((item) => (
            <ChecklistRow
              key={item.id}
              item={item}
              isActive={false}
              expanded={expandedId === item.id}
              onToggleDone={() => toggle(item.id)}
              onToggleExpand={() =>
                setExpandedId((prev) => (prev === item.id ? null : item.id))
              }
              onDelete={() => remove(item.id)}
              onNotesChange={(text) => patch(item.id, { notes: text })}
              onOpenDueSheet={() => setDueSheetItemId(item.id)}
            />
          ))
        )}

        {adding ? (
          <View style={styles.addRow}>
            <View style={styles.checkbox}>
              <MaterialCommunityIcons
                name={'plus' as any}
                size={14}
                color={themeColors.accentText}
              />
            </View>
            <TextInput
              mode="flat"
              value={pendingText}
              onChangeText={setPendingText}
              placeholder="New item"
              onSubmitEditing={add}
              onBlur={() => {
                if (!pendingText.trim()) setAdding(false);
              }}
              autoFocus
              dense
              style={styles.addInput}
              underlineColor="transparent"
              activeUnderlineColor={themeColors.accent}
            />
          </View>
        ) : (
          <Pressable
            onPress={() => {
              lightTap();
              setAdding(true);
            }}
            style={({ pressed }) => [styles.addCta, pressed && { opacity: 0.85 }]}
          >
            <MaterialCommunityIcons
              name={'plus' as any}
              size={16}
              color={themeColors.accentText}
            />
            <Text style={styles.addCtaLabel}>Add step</Text>
          </Pressable>
        )}
      </View>

      <DueDateSheet
        visible={!!dueSheetItem}
        onDismiss={() => setDueSheetItemId(null)}
        value={dueSheetItem?.dueAt}
        onChange={(next) => {
          if (!dueSheetItem) return;
          patch(dueSheetItem.id, { dueAt: next });
        }}
        title={dueSheetItem?.text || 'Due date'}
      />
    </View>
  );
}

interface ChecklistRowProps {
  item: JobChecklistItem;
  isActive: boolean;
  expanded: boolean;
  onToggleDone: () => void;
  onToggleExpand: () => void;
  onDelete: () => void;
  onDrag?: () => void;
  onNotesChange: (text: string) => void;
  onOpenDueSheet: () => void;
}

function ChecklistRow({
  item,
  isActive,
  expanded,
  onToggleDone,
  onToggleExpand,
  onDelete,
  onDrag,
  onNotesChange,
  onOpenDueSheet,
}: ChecklistRowProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [pressedDelete, setPressedDelete] = useState(false);
  const fadeAnim = React.useRef(new Animated.Value(item.done ? 0.55 : 1)).current;

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: item.done ? 0.55 : 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [item.done, fadeAnim]);

  const now = Date.now();
  const dueLabel = formatDueLabel(item.dueAt);
  const overdue = !!(item.dueAt && !item.done && item.dueAt < now - 24 * 60 * 60 * 1000);
  const dueToday = !!(item.dueAt && !item.done && !overdue && isSameDay(item.dueAt, now));

  return (
    <Animated.View
      style={[
        styles.rowWrap,
        { opacity: fadeAnim },
        isActive && styles.rowActive,
      ]}
    >
      <View style={styles.row}>
        {onDrag ? (
          <Pressable
            onLongPress={onDrag}
            delayLongPress={150}
            style={styles.dragHandle}
            hitSlop={4}
          >
            <MaterialCommunityIcons
              name={'drag-vertical' as any}
              size={18}
              color={themeColors.textDisabled}
            />
          </Pressable>
        ) : null}

        <Pressable onPress={onToggleDone} hitSlop={6} style={styles.checkboxPressable}>
          <View
            style={[
              styles.checkbox,
              item.done && styles.checkboxDone,
            ]}
          >
            {item.done ? (
              <MaterialCommunityIcons
                name={'check' as any}
                size={14}
                color={themeColors.onAccent}
              />
            ) : null}
          </View>
        </Pressable>

        <Pressable style={styles.textWrap} onPress={onToggleExpand}>
          <Text
            style={[styles.itemText, item.done && styles.itemTextDone]}
            numberOfLines={expanded ? undefined : 2}
          >
            {item.text}
          </Text>
          {(dueLabel || item.notes) && !expanded ? (
            <View style={styles.metaRow}>
              {dueLabel ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    onOpenDueSheet();
                  }}
                  hitSlop={6}
                  style={[
                    styles.dueChip,
                    overdue && styles.dueChipOverdue,
                    dueToday && styles.dueChipToday,
                  ]}
                >
                  <MaterialCommunityIcons
                    name={'calendar-clock-outline' as any}
                    size={10}
                    color={
                      overdue
                        ? themeColors.error
                        : dueToday
                          ? themeColors.warning
                          : themeColors.textMuted
                    }
                  />
                  <Text
                    style={[
                      styles.dueChipLabel,
                      overdue && { color: themeColors.error },
                      dueToday && { color: themeColors.warning },
                    ]}
                  >
                    {dueLabel}
                  </Text>
                </Pressable>
              ) : null}
              {item.notes ? (
                <View style={styles.notesHintPill}>
                  <MaterialCommunityIcons
                    name={'text-box-outline' as any}
                    size={10}
                    color={themeColors.textMuted}
                  />
                  <Text style={styles.notesHintLabel}>Notes</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </Pressable>

        <Pressable
          onPress={onDelete}
          onPressIn={() => setPressedDelete(true)}
          onPressOut={() => setPressedDelete(false)}
          hitSlop={6}
          style={styles.deleteButton}
        >
          <MaterialCommunityIcons
            name={'close' as any}
            size={16}
            color={pressedDelete ? themeColors.error : themeColors.textMuted}
          />
        </Pressable>
      </View>

      {expanded ? (
        <View style={styles.expandedBlock}>
          <Pressable onPress={onOpenDueSheet} style={styles.dueButton}>
            <MaterialCommunityIcons
              name={'calendar-clock-outline' as any}
              size={14}
              color={item.dueAt ? themeColors.accent : themeColors.textMuted}
            />
            <Text
              style={[
                styles.dueButtonLabel,
                item.dueAt
                  ? { color: themeColors.text, fontWeight: '700' as const }
                  : null,
              ]}
            >
              {item.dueAt ? formatDueLong(item.dueAt) : 'Set due date'}
            </Text>
          </Pressable>
          <TextInput
            mode="outlined"
            multiline
            placeholder="Notes (optional)…"
            value={item.notes || ''}
            onChangeText={onNotesChange}
            style={styles.notesInput}
            numberOfLines={3}
          />
        </View>
      ) : null}
    </Animated.View>
  );
}

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function formatDueLabel(ms?: number): string | null {
  if (!ms) return null;
  try {
    const d = new Date(ms);
    const now = Date.now();
    if (isSameDay(ms, now)) return 'Today';
    const tomorrow = now + 24 * 60 * 60 * 1000;
    if (isSameDay(ms, tomorrow)) return 'Tomorrow';
    const daysAgo = Math.floor((now - ms) / (24 * 60 * 60 * 1000));
    if (daysAgo === 1) return 'Yesterday';
    if (daysAgo > 1 && daysAgo <= 14) return `${daysAgo} days ago`;
    return format(d, 'd MMM');
  } catch {
    return null;
  }
}

function formatDueLong(ms: number): string {
  try {
    return format(new Date(ms), 'EEE d MMM yyyy');
  } catch {
    return '';
  }
}

const useStyles = makeStyles((t) => ({
  emptyAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.border,
  },
  emptyAddLabel: {
    fontSize: 13,
    color: t.colors.textMuted,
    fontWeight: '500',
  },
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: t.colors.surfaceRaised,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  heading: {
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.text,
  },
  count: {
    fontSize: 12,
    fontWeight: '600',
    color: t.colors.textMuted,
  },
  list: {
    gap: 4,
  },
  rowWrap: {
    borderRadius: 10,
  },
  rowActive: {
    backgroundColor: t.colors.surfacePressed,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  dragHandle: {
    paddingHorizontal: 2,
    paddingVertical: 6,
  },
  checkboxPressable: {
    paddingVertical: 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: t.colors.textDisabled,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  checkboxDone: {
    backgroundColor: t.colors.money,
    borderColor: t.colors.money,
  },
  textWrap: {
    flex: 1,
  },
  itemText: {
    fontSize: 14,
    color: t.colors.text,
    lineHeight: 20,
  },
  itemTextDone: {
    textDecorationLine: 'line-through',
    color: t.colors.textMuted,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  dueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: t.colors.surfacePressed,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  dueChipOverdue: {
    backgroundColor: t.colors.errorSubtle,
    borderColor: t.colors.errorSubtle,
  },
  dueChipToday: {
    backgroundColor: t.colors.warningSubtle,
    borderColor: t.colors.warningSubtle,
  },
  dueChipLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: t.colors.textMuted,
  },
  notesHintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: t.colors.surfacePressed,
  },
  notesHintLabel: {
    fontSize: 11,
    color: t.colors.textMuted,
    fontWeight: '600',
  },
  deleteButton: {
    padding: 4,
  },
  expandedBlock: {
    paddingHorizontal: 2,
    paddingBottom: 10,
    paddingTop: 2,
    gap: 8,
  },
  dueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: t.colors.surfacePressed,
    alignSelf: 'flex-start',
  },
  dueButtonLabel: {
    fontSize: 13,
    color: t.colors.textMuted,
    fontWeight: '600',
  },
  notesInput: {
    backgroundColor: 'transparent',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  addInput: {
    flex: 1,
    backgroundColor: 'transparent',
    fontSize: 14,
    height: 36,
  },
  addCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    marginTop: 2,
  },
  addCtaLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.accentText,
  },
}));
