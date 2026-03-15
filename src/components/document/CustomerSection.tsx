import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text, Title, Surface, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme';
import { documentStyles as styles } from './documentStyles';

interface CustomerSectionProps {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  onEdit?: () => void;
  isEditing?: boolean;
  onFieldChange?: (field: string, value: string) => void;
}

export function CustomerSection({
  customerName,
  customerEmail,
  customerPhone,
  jobAddress,
  onEdit,
  isEditing,
  onFieldChange,
}: CustomerSectionProps) {
  const content = (
    <Surface style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <View style={[styles.sectionIconCircle, { backgroundColor: colors.infoBg }]}>
            <MaterialCommunityIcons name="account" size={18} color={colors.info} />
          </View>
          <Title style={styles.sectionTitle}>Customer</Title>
        </View>
        {onEdit && (
          <View style={styles.editButton}>
            <MaterialCommunityIcons name="pencil" size={16} color={colors.primary} />
          </View>
        )}
      </View>
      {isEditing && onFieldChange ? (
        <>
          <TextInput
            label="Customer Name"
            value={customerName}
            onChangeText={(text) => onFieldChange('customerName', text)}
            style={styles.input}
            mode="outlined"
          />
          <TextInput
            label="Email"
            value={customerEmail || ''}
            onChangeText={(text) => onFieldChange('customerEmail', text)}
            style={styles.input}
            mode="outlined"
            keyboardType="email-address"
          />
          <TextInput
            label="Phone"
            value={customerPhone || ''}
            onChangeText={(text) => onFieldChange('customerPhone', text)}
            style={styles.input}
            mode="outlined"
            keyboardType="phone-pad"
          />
          <TextInput
            label="Job Address"
            value={jobAddress || ''}
            onChangeText={(text) => onFieldChange('jobAddress', text)}
            style={styles.input}
            mode="outlined"
            multiline
          />
        </>
      ) : (
        <>
          <Text style={styles.text}>{customerName}</Text>
          {customerEmail ? <Text style={styles.subtext}>{customerEmail}</Text> : null}
          {customerPhone ? <Text style={styles.subtext}>{customerPhone}</Text> : null}
          {jobAddress ? <Text style={styles.subtext}>{jobAddress}</Text> : null}
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
