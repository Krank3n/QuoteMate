import React from 'react';
import { View, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Text, Surface, TextInput, Divider } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { Tokens } from '../../theme';
import { makeStyles, useThemeColors} from '../../theme';
import { useDocumentStyles } from './documentStyles';

interface CustomerSectionProps {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobAddress?: string;
  website?: string;
  onEdit?: () => void;
  isEditing?: boolean;
  onFieldChange?: (field: string, value: string) => void;
  /** Show quick-action buttons (call, text, email, web) below the details */
  showActions?: boolean;
}

interface ActionItem {
  icon: string;
  label: string;
  color: string;
  bgColor: string;
  onPress: () => void;
}

function buildActions(themeColors: Tokens, phone?: string, email?: string, website?: string): ActionItem[] {
  const actions: ActionItem[] = [];

  if (phone) {
    const cleanPhone = phone.replace(/\s/g, '');
    actions.push({
      icon: 'phone',
      label: 'Call',
      color: themeColors.money,
      bgColor: themeColors.moneySubtle,
      onPress: () => Linking.openURL(`tel:${cleanPhone}`),
    });
    actions.push({
      icon: 'message-text',
      label: 'Text',
      color: themeColors.info,
      bgColor: themeColors.infoSubtle,
      onPress: () => Linking.openURL(`sms:${cleanPhone}`),
    });
  }

  if (email) {
    actions.push({
      icon: 'email-outline',
      label: 'Email',
      color: themeColors.warning,
      bgColor: themeColors.warningSubtle,
      onPress: () => Linking.openURL(`mailto:${email}`),
    });
  }

  if (website) {
    const url = website.startsWith('http') ? website : `https://${website}`;
    actions.push({
      icon: 'web',
      label: 'Web',
      color: themeColors.accentText,
      bgColor: themeColors.accentSubtle,
      onPress: () => Linking.openURL(url),
    });
  }

  return actions;
}

export function CustomerSection({
  customerName,
  customerEmail,
  customerPhone,
  jobAddress,
  website,
  onEdit,
  isEditing,
  onFieldChange,
  showActions = false,
}: CustomerSectionProps) {
  const docStyles = useDocumentStyles();
  const s = useLocalStyles();
  const themeColors = useThemeColors();
  const actions = showActions && !isEditing
    ? buildActions(themeColors, customerPhone, customerEmail, website)
    : [];

  // Editing mode — keep the old header + form style
  if (isEditing && onFieldChange) {
    return (
      <Surface style={docStyles.section}>
        <View style={docStyles.sectionHeader}>
          <View style={docStyles.sectionHeaderLeft}>
            <View style={[docStyles.sectionIconCircle, { backgroundColor: themeColors.infoSubtle }]}>
              <MaterialCommunityIcons name="account" size={18} color={themeColors.info} />
            </View>
            <Text style={docStyles.sectionTitle}>Customer</Text>
          </View>
        </View>
        <TextInput
          label="Customer Name"
          value={customerName}
          onChangeText={(text) => onFieldChange('customerName', text)}
          style={docStyles.input}
          mode="outlined"
        />
        <TextInput
          label="Email"
          value={customerEmail || ''}
          onChangeText={(text) => onFieldChange('customerEmail', text)}
          style={docStyles.input}
          mode="outlined"
          keyboardType="email-address"
        />
        <TextInput
          label="Phone"
          value={customerPhone || ''}
          onChangeText={(text) => onFieldChange('customerPhone', text)}
          style={docStyles.input}
          mode="outlined"
          keyboardType="phone-pad"
        />
        <TextInput
          label="Job Address"
          value={jobAddress || ''}
          onChangeText={(text) => onFieldChange('jobAddress', text)}
          style={docStyles.input}
          mode="outlined"
          multiline
        />
      </Surface>
    );
  }

  // Profile card view
  const initials = customerName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  const card = (
    <Surface style={s.card}>
      {/* Profile header */}
      <View style={s.profileHeader}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initials || '?'}</Text>
        </View>
        <View style={s.nameBlock}>
          <Text style={s.name} numberOfLines={1}>{customerName}</Text>
          {jobAddress ? (
            <View style={s.addressRow}>
              <MaterialCommunityIcons name="map-marker-outline" size={13} color={themeColors.textMuted} />
              <Text style={s.addressText} numberOfLines={1}>{jobAddress}</Text>
            </View>
          ) : null}
        </View>
        {onEdit && (
          <View style={s.editButton}>
            <MaterialCommunityIcons name="pencil" size={15} color={themeColors.accentText} />
          </View>
        )}
      </View>

      {/* Contact details */}
      {(customerPhone || customerEmail) && (
        <View style={s.detailsRow}>
          {customerPhone ? (
            <View style={s.detailItem}>
              <MaterialCommunityIcons name="phone-outline" size={14} color={themeColors.textMuted} />
              <Text style={s.detailText}>{customerPhone}</Text>
            </View>
          ) : null}
          {customerEmail ? (
            <View style={s.detailItem}>
              <MaterialCommunityIcons name="email-outline" size={14} color={themeColors.textMuted} />
              <Text style={s.detailText} numberOfLines={1}>{customerEmail}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Action buttons */}
      {actions.length > 0 && (
        <>
          <Divider style={s.divider} />
          <View style={s.actionsRow}>
            {actions.map((action) => (
              <TouchableOpacity
                key={action.label}
                style={s.actionButton}
                onPress={action.onPress}
                activeOpacity={0.7}
              >
                <View style={[s.iconCircle, { backgroundColor: action.bgColor }]}>
                  <MaterialCommunityIcons
                    name={action.icon as any}
                    size={18}
                    color={action.color}
                  />
                </View>
                <Text style={[s.actionLabel, { color: action.color }]}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </Surface>
  );

  if (onEdit) {
    return (
      <TouchableOpacity onPress={onEdit} activeOpacity={0.7}>
        {card}
      </TouchableOpacity>
    );
  }

  return card;
}

const useLocalStyles = makeStyles((t) => ({
  card: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
    overflow: 'hidden',
  },
  // Profile header
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 17,
    fontWeight: '800',
    color: t.colors.accentText,
    letterSpacing: 1,
  },
  nameBlock: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text,
    marginBottom: 2,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  addressText: {
    fontSize: 12,
    color: t.colors.textMuted,
    flex: 1,
  },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Contact details
  detailsRow: {
    marginTop: 12,
    gap: 6,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailText: {
    fontSize: 13,
    color: t.colors.textMuted,
    flex: 1,
  },
  // Actions
  divider: {
    marginTop: 14,
    marginBottom: 12,
    backgroundColor: t.colors.border,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  actionButton: {
    alignItems: 'center',
    gap: 5,
    minWidth: 50,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
}));
