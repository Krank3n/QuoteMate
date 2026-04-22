/**
 * JobChecklist
 *
 * Lightweight checkbox list stored on Job.checklist. Tradies brain-dump
 * materials, site tasks, follow-ups; tick them off as they go. No
 * project-management ambitions — just notes with a state flag.
 *
 * Visual:
 *  - Empty: dashed "Add checklist" CTA (matches the Notes empty-state
 *    pattern) so the screen stays uncluttered.
 *  - Populated: rounded card with each item as a tappable row; done items
 *    fade + strike through. A bottom "Add step" row with an inline
 *    TextInput lets the tradie type + Enter to append.
 *
 * Persistence: every mutation goes through useJobStore.saveJob with the
 * new checklist array. Optimistic via the store's local set().
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

import type { Job, JobChecklistItem } from '../../shared/job/types';
import { colors } from '../theme';
import { useJobStore } from '../store/useJobStore';
import { generateId } from '../utils/generateId';
import { selectionTap, lightTap } from '../utils/haptics';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface JobChecklistProps {
  job: Job;
}

export function JobChecklist({ job }: JobChecklistProps) {
  const saveJob = useJobStore((s) => s.saveJob);
  const items = job.checklist ?? [];
  const [pendingText, setPendingText] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(items.length > 0);

  const commit = async (next: JobChecklistItem[]) => {
    LayoutAnimation.configureNext({
      duration: 180,
      create: { type: 'easeInEaseOut', property: 'opacity' },
      update: { type: 'easeInEaseOut' },
      delete: { type: 'easeInEaseOut', property: 'opacity' },
    });
    await saveJob({ ...job, checklist: next });
  };

  const toggle = async (id: string) => {
    selectionTap();
    const next = items.map((it) =>
      it.id === id
        ? {
            ...it,
            done: !it.done,
            completedAt: !it.done ? Date.now() : undefined,
          }
        : it,
    );
    await commit(next);
  };

  const remove = async (id: string) => {
    lightTap();
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
    setAdding(false);
    await commit([...items, newItem]);
  };

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
          color={colors.textMuted}
        />
        <Text style={styles.emptyAddLabel}>Add checklist</Text>
      </Pressable>
    );
  }

  const done = items.filter((it) => it.done).length;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Checklist</Text>
        <Text style={styles.count}>
          {items.length === 0 ? 'New' : `${done} / ${items.length}`}
        </Text>
      </View>

      <View style={styles.list}>
        {items.map((item) => (
          <ChecklistRow
            key={item.id}
            item={item}
            onToggle={() => toggle(item.id)}
            onDelete={() => remove(item.id)}
          />
        ))}

        {adding ? (
          <View style={styles.addRow}>
            <View style={styles.checkbox}>
              <MaterialCommunityIcons
                name={'plus' as any}
                size={14}
                color={colors.primary}
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
              activeUnderlineColor={colors.primary}
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
              color={colors.primary}
            />
            <Text style={styles.addCtaLabel}>Add step</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ChecklistRow({
  item,
  onToggle,
  onDelete,
}: {
  item: JobChecklistItem;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [pressedDelete, setPressedDelete] = useState(false);
  const fadeAnim = React.useRef(new Animated.Value(item.done ? 0.55 : 1)).current;

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: item.done ? 0.55 : 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [item.done, fadeAnim]);

  return (
    <Animated.View style={[styles.row, { opacity: fadeAnim }]}>
      <Pressable onPress={onToggle} hitSlop={6} style={styles.checkboxPressable}>
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
              color={colors.white}
            />
          ) : null}
        </View>
      </Pressable>

      <Pressable style={styles.textWrap} onPress={onToggle}>
        <Text
          style={[styles.itemText, item.done && styles.itemTextDone]}
          numberOfLines={3}
        >
          {item.text}
        </Text>
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
          color={pressedDelete ? colors.error : colors.textMuted}
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  emptyAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  emptyAddLabel: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
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
    color: colors.text,
  },
  count: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  list: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  checkboxPressable: {
    paddingVertical: 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.inactive,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  checkboxDone: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  textWrap: {
    flex: 1,
  },
  itemText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  itemTextDone: {
    textDecorationLine: 'line-through',
    color: colors.textMuted,
  },
  deleteButton: {
    padding: 4,
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
    color: colors.primary,
  },
});
