import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text, Title, Surface, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useThemeColors} from '../../theme';
import { JobSpec } from '../../types';
import { useDocumentStyles } from './documentStyles';

interface JobSectionProps {
  job: JobSpec;
  onEdit?: () => void;
  isEditing?: boolean;
  onJobChange?: (job: JobSpec) => void;
  style?: any;
}

export function JobSection({
  job,
  onEdit,
  isEditing,
  onJobChange,
  style,
}: JobSectionProps) {
  const styles = useDocumentStyles();
  const themeColors = useThemeColors();
  const content = (
    <Surface style={[styles.section, style]}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <View style={[styles.sectionIconCircle, { backgroundColor: themeColors.accentSubtle }]}>
            <MaterialCommunityIcons name="text-long" size={18} color={themeColors.accentText} />
          </View>
          <Title style={styles.sectionTitle}>Job</Title>
        </View>
        {onEdit && (
          <View style={styles.editButton}>
            <MaterialCommunityIcons name={isEditing ? "check" : "pencil"} size={16} color={themeColors.accentText} />
          </View>
        )}
      </View>
      {isEditing && onJobChange ? (
        <>
          <TextInput
            label="Job Name"
            value={job.name}
            onChangeText={(text) => onJobChange({ ...job, name: text })}
            style={styles.input}
            mode="outlined"
          />
          <TextInput
            label="Description"
            value={job.description}
            onChangeText={(text) => onJobChange({ ...job, description: text })}
            style={styles.input}
            mode="outlined"
            multiline
          />
        </>
      ) : (
        <>
          <Text style={styles.text}>{job.name}</Text>
          <Text style={styles.subtext}>{job.description}</Text>
        </>
      )}
    </Surface>
  );

  if (onEdit) {
    return (
      <TouchableOpacity onPress={onEdit} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}
