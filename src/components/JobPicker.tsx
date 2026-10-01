/**
 * Pick which job a time entry belongs to. Collapsed it's one row naming the
 * job; tapped it opens a searchable list of your jobs, most recent first.
 * Used to move hours logged on the wrong job.
 */

import React, { useMemo, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Job } from '../../shared/job/types';
import { makeStyles, useThemeColors } from '../theme';

const MAX_SHOWN = 25;

/** Jobs you'd log time against: not archived, most recently touched first, matching the search. */
export function pickableJobs(jobs: Job[], search: string, keepId?: string): Job[] {
  const q = search.trim().toLowerCase();
  return jobs
    .filter((j) => j.id === keepId || (!j.archivedAt && j.stage !== 'cancelled'))
    .filter((j) => !q || `${j.name} ${j.customerName} ${j.jobAddress}`.toLowerCase().includes(q))
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
    .slice(0, MAX_SHOWN);
}

interface JobPickerProps {
  jobs: Job[];
  value: string;
  onChange: (jobId: string) => void;
}

export function JobPicker({ jobs, value, onChange }: JobPickerProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const current = jobs.find((j) => j.id === value);
  const list = useMemo(() => pickableJobs(jobs, search, value), [jobs, search, value]);

  const label = (j: Job | undefined) =>
    j ? [j.customerName, j.name].filter(Boolean).join(' — ') || 'Untitled job' : 'Pick a job';

  return (
    <View>
      <TouchableOpacity
        style={styles.current}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`Job: ${label(current)}. Tap to change`}
      >
        <MaterialCommunityIcons name="briefcase-outline" size={18} color={themeColors.accentText} />
        <Text style={styles.currentText} numberOfLines={1}>
          {label(current)}
        </Text>
        <Text style={styles.change}>{open ? 'Done' : 'Change'}</Text>
      </TouchableOpacity>
      {open ? (
        <View style={styles.list}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search jobs"
            mode="outlined"
            dense
            accessibilityLabel="Search jobs"
          />
          {list.map((j) => (
            <TouchableOpacity
              key={j.id}
              style={[styles.option, j.id === value && styles.optionOn]}
              onPress={() => {
                onChange(j.id);
                setOpen(false);
                setSearch('');
              }}
              accessibilityRole="button"
            >
              <Text style={styles.optionTitle} numberOfLines={1}>
                {label(j)}
              </Text>
              {j.jobAddress ? (
                <Text style={styles.optionSub} numberOfLines={1}>
                  {j.jobAddress}
                </Text>
              ) : null}
            </TouchableOpacity>
          ))}
          {list.length === 0 ? <Text style={styles.none}>No jobs match.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  current: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
  },
  currentText: { flex: 1, fontSize: 15, fontWeight: '600', color: t.colors.text },
  change: { fontSize: 14, fontWeight: '700', color: t.colors.accentText },
  list: { gap: 6, marginTop: 8 },
  option: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: t.colors.surface,
  },
  optionOn: { borderWidth: 1, borderColor: t.colors.accent },
  optionTitle: { fontSize: 15, fontWeight: '600', color: t.colors.text },
  optionSub: { fontSize: 12, color: t.colors.textMuted, marginTop: 2 },
  none: { fontSize: 13, color: t.colors.textMuted, padding: 8 },
}));
