/**
 * Contacts Screen
 * Manage customer contacts — view, add, edit, delete, import from phone.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { Text, Surface, Searchbar, Chip, FAB } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useNavigation } from '@react-navigation/native';
import { useStore } from '../store/useStore';
import { makeStyles, useThemeColors } from '../theme';
import { Contact } from '../types';
import {
  createContact,
  updateContact,
  getAllPhoneContacts,
  requestPhoneContactsPermission,
  normalizePhone,
} from '../services/contactService';
import { SOURCE_COLORS } from '../hooks/useUnifiedContactSearch';
import { ContactActionsBar } from '../components/document/ContactActionsBar';
import { ContactEditModal, type ContactFormValues } from '../components/ContactEditModal';
import { AlertModal, AlertType } from '../components/AlertModal';
import { GridBackground } from '../components/GridBackground';
import { WebContainer } from '../components/WebContainer';

type AlertConfig = {
  type: AlertType;
  title: string;
  message: string;
  primaryText?: string;
  primaryAction?: () => void;
  secondaryText?: string;
  secondaryAction?: () => void;
};

type FilterType = 'all' | 'saved' | 'xero';

export function ContactsScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const contacts = useStore((s) => s.contacts);
  const xeroContacts = useStore((s) => s.xeroContacts);
  const xeroConnection = useStore((s) => s.xeroConnection);
  const saveContact = useStore((s) => s.saveContact);
  const deleteContact = useStore((s) => s.deleteContact);
  const syncXeroContacts = useStore((s) => s.syncXeroContacts);
  const importContacts = useStore((s) => s.importContacts);

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [xeroSyncing, setXeroSyncing] = useState(false);
  const [phoneImporting, setPhoneImporting] = useState(false);
  const [alert, setAlert] = useState<AlertConfig | null>(null);

  // Form state lives in ContactEditModal now — it seeds itself from `initial`.

  // Filtered and searched contacts
  const filteredContacts = useMemo(() => {
    let list = [...contacts];

    // Apply source filter
    if (filter === 'saved') {
      list = list.filter((c) => c.source === 'manual' || c.source === 'quote');
    } else if (filter === 'xero') {
      list = list.filter((c) => c.source === 'xero');
    }

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.email && c.email.toLowerCase().includes(q)) ||
          (c.phone && c.phone.includes(q))
      );
    }

    // Sort alphabetically
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, filter, searchQuery]);

  const openAddModal = () => {
    setEditingContact(null);
    setEditModalVisible(true);
  };

  const openEditModal = (contact: Contact) => {
    setEditingContact(contact);
    setEditModalVisible(true);
  };

  // The form itself is ContactEditModal, shared with the Customer screen — one
  // form for customer details, so the two can't drift apart.
  const handleSave = async (values: ContactFormValues) => {
    const contact = editingContact
      ? updateContact(editingContact, values)
      : createContact({ ...values, source: 'manual' });
    await saveContact(contact);
    setEditModalVisible(false);
  };

  const handleDelete = (contact: Contact) => {
    Alert.alert(
      'Delete Contact',
      `Delete "${contact.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteContact(contact.id),
        },
      ]
    );
  };

  const openSettings = () => {
    if (Platform.OS === 'ios') Linking.openURL('app-settings:');
    else Linking.openSettings();
  };

  const handlePhoneImport = async () => {
    const permission = await requestPhoneContactsPermission();
    if (!permission.granted) {
      if (!permission.canAskAgain) {
        setAlert({
          type: 'info',
          title: 'Contacts Access',
          message: 'To import your phone contacts, allow access in your device settings.',
          primaryText: 'Open Settings',
          primaryAction: () => {
            setAlert(null);
            openSettings();
          },
          secondaryText: 'Not Now',
          secondaryAction: () => setAlert(null),
        });
      }
      return;
    }

    setPhoneImporting(true);
    try {
      const phoneContacts = await getAllPhoneContacts();
      if (phoneContacts.length === 0) {
        setAlert({
          type: 'info',
          title: 'No Contacts',
          message: 'No contacts found on your device.',
        });
        return;
      }

      const existingPhones = new Set(
        contacts.filter((c) => c.phone).map((c) => normalizePhone(c.phone!))
      );
      const existingEmails = new Set(
        contacts.filter((c) => c.email).map((c) => c.email!.toLowerCase())
      );

      const newOnes = phoneContacts.filter((c) => {
        const phoneMatch = c.phone && existingPhones.has(normalizePhone(c.phone));
        const emailMatch = c.email && existingEmails.has(c.email.toLowerCase());
        return !phoneMatch && !emailMatch;
      });

      if (newOnes.length === 0) {
        setAlert({
          type: 'info',
          title: 'Nothing New',
          message: `All ${phoneContacts.length} phone contacts are already saved.`,
        });
        return;
      }

      setAlert({
        type: 'info',
        title: 'Import Contacts',
        message: `Import ${newOnes.length} new contact${newOnes.length === 1 ? '' : 's'} from your phone?`,
        primaryText: 'Import',
        primaryAction: async () => {
          setAlert(null);
          try {
            await importContacts(newOnes);
            setAlert({
              type: 'success',
              title: 'Imported',
              message: `${newOnes.length} contact${newOnes.length === 1 ? '' : 's'} added.`,
            });
          } catch (e: any) {
            setAlert({
              type: 'error',
              title: 'Import Failed',
              message: e?.message || 'Could not save contacts.',
            });
          }
        },
        secondaryText: 'Cancel',
        secondaryAction: () => setAlert(null),
      });
    } finally {
      setPhoneImporting(false);
    }
  };

  const handleXeroSync = async () => {
    setXeroSyncing(true);
    try {
      await syncXeroContacts();
      Alert.alert('Synced', 'Xero contacts synced successfully.');
    } catch (error: any) {
      Alert.alert('Sync Failed', error.message || 'Failed to sync Xero contacts.');
    } finally {
      setXeroSyncing(false);
    }
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case 'manual': return 'Manual';
      case 'phone': return 'Phone';
      case 'xero': return 'Xero';
      case 'quote': return 'Quote';
      default: return source;
    }
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case 'manual': return SOURCE_COLORS.saved;
      case 'quote': return SOURCE_COLORS.recent;
      case 'phone': return SOURCE_COLORS.phone;
      case 'xero': return SOURCE_COLORS.xero;
      default: return SOURCE_COLORS.phone;
    }
  };

  // Tapping a contact now opens their jobs and what they owe, rather than a
  // form — that's what you want a customer's row for. Editing moved to the
  // pencil below, and long-press still deletes.
  const openCustomer = (contact: Contact) => {
    navigation.navigate('Customer', {
      customerKey: `c:${contact.id.toLowerCase()}`,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
    });
  };

  const renderContact = ({ item }: { item: Contact }) => (
    <TouchableOpacity onPress={() => openCustomer(item)} onLongPress={() => handleDelete(item)}>
      <Surface style={styles.contactCard}>
        <View style={styles.contactRow}>
          <View style={styles.contactAvatar}>
            <MaterialCommunityIcons name="account" size={24} color={themeColors.accentText} />
          </View>
          <View style={styles.contactInfo}>
            <View style={styles.contactNameRow}>
              <Text style={styles.contactName}>{item.name}</Text>
              <Text style={[styles.contactSource, { color: getSourceColor(item.source) }]}>
                {getSourceLabel(item.source)}
              </Text>
            </View>
            {item.businessName && (
              <Text style={styles.contactBusiness}>{item.businessName}</Text>
            )}
            {item.phone && (
              <Text style={styles.contactDetail}>{item.phone}</Text>
            )}
            {item.email && (
              <Text style={styles.contactDetail}>{item.email}</Text>
            )}
          </View>
          <ContactActionsBar
            phone={item.phone}
            email={item.email}
            website={item.website}
            compact
          />
          {/* Edit used to be the row tap; the row now opens the customer, so
              it needs its own affordance. */}
          <TouchableOpacity
            onPress={() => openEditModal(item)}
            style={styles.contactEditButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={`Edit ${item.name}`}
          >
            <MaterialCommunityIcons
              name="pencil-outline"
              size={18}
              color={themeColors.textMuted}
            />
          </TouchableOpacity>
        </View>
      </Surface>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <GridBackground />
      <WebContainer style={styles.flex}>
      <View style={styles.searchSection}>
        <Searchbar
          placeholder="Search contacts..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.searchbar}
          inputStyle={styles.searchInput}
        />
        <View style={styles.filterRow}>
          {(['all', 'saved', 'xero'] as FilterType[]).map((f) => (
            <Chip
              key={f}
              mode={filter === f ? 'flat' : 'outlined'}
              selected={filter === f}
              onPress={() => setFilter(f)}
              style={styles.filterChip}
              compact
            >
              {f === 'all' ? 'All' : f === 'saved' ? 'Saved' : 'Xero'}
            </Chip>
          ))}
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={handlePhoneImport}
          disabled={phoneImporting}
        >
          <MaterialCommunityIcons name="cellphone" size={18} color={themeColors.accentText} />
          <Text style={styles.actionButtonText}>
            {phoneImporting ? 'Importing...' : 'Import from Phone'}
          </Text>
        </TouchableOpacity>
        {xeroConnection && (
          <TouchableOpacity style={styles.actionButton} onPress={handleXeroSync} disabled={xeroSyncing}>
            <MaterialCommunityIcons name="cloud-sync" size={18} color={themeColors.accentText} />
            <Text style={styles.actionButtonText}>{xeroSyncing ? 'Syncing...' : 'Sync Xero'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Xero contacts section (not yet saved locally) */}
      {xeroContacts.length > 0 && filter !== 'saved' && (
        <View style={styles.xeroSection}>
          <Text style={styles.xeroSectionTitle}>Xero Contacts ({xeroContacts.length})</Text>
          <Text style={styles.xeroSectionSubtitle}>Tap to save locally</Text>
          <FlatList
            data={xeroContacts.slice(0, 5)}
            horizontal
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.xeroChip}
                onPress={async () => {
                  await saveContact({ ...item, source: 'xero' });
                }}
              >
                <Text style={styles.xeroChipText}>{item.name}</Text>
                <MaterialCommunityIcons name="plus" size={14} color={themeColors.accentText} />
              </TouchableOpacity>
            )}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.xeroChipsList}
          />
        </View>
      )}

      <FlatList
        data={filteredContacts}
        renderItem={renderContact}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        removeClippedSubviews
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={7}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="account-group-outline" size={48} color={themeColors.textSecondary} />
            <Text style={styles.emptyTitle}>No contacts yet</Text>
            <Text style={styles.emptySubtitle}>
              Start quoting and your customers will pile up here. Or tap + to chuck one in yourself.
            </Text>
          </View>
        }
      />

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={openAddModal}
        color={themeColors.onAccent}
      />
      </WebContainer>

      {/* One shared form for customer details — the Customer screen renders the
          same component, so the two can't drift apart. */}
      <ContactEditModal
        visible={editModalVisible}
        onDismiss={() => setEditModalVisible(false)}
        onSave={handleSave}
        initial={editingContact}
        title={editingContact ? 'Edit Contact' : 'New Contact'}
        onDelete={
          editingContact
            ? () => {
                const target = editingContact;
                setEditModalVisible(false);
                handleDelete(target);
              }
            : undefined
        }
      />

      <AlertModal
        visible={alert !== null}
        onDismiss={() => setAlert(null)}
        type={alert?.type || 'info'}
        title={alert?.title || ''}
        message={alert?.message || ''}
        primaryButtonText={alert?.primaryText || 'OK'}
        primaryButtonAction={alert?.primaryAction || (() => setAlert(null))}
        secondaryButtonText={alert?.secondaryText}
        secondaryButtonAction={alert?.secondaryAction}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  flex: { flex: 1 },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  searchbar: {
    borderRadius: 12,
    backgroundColor: t.colors.surfaceRaised,
    elevation: 1,
  },
  searchInput: {
    fontSize: 14,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    marginBottom: 4,
  },
  filterChip: {
    height: 32,
  },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: t.colors.accentSubtle,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.accentText,
  },
  xeroSection: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  xeroSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.text,
  },
  xeroSectionSubtitle: {
    fontSize: 11,
    color: t.colors.textSecondary,
    marginBottom: 6,
  },
  xeroChipsList: {
    gap: 8,
  },
  xeroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: SOURCE_COLORS.xero + '40',
  },
  xeroChipText: {
    fontSize: 12,
    color: t.colors.text,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
    paddingTop: 4,
  },
  contactCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    backgroundColor: t.colors.surfaceRaised,
    elevation: 1,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contactEditButton: {
    paddingLeft: 8,
    justifyContent: 'center',
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  contactInfo: {
    flex: 1,
  },
  contactNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contactName: {
    fontSize: 15,
    fontWeight: '600',
    color: t.colors.text,
  },
  contactSource: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  contactBusiness: {
    fontSize: 12,
    color: t.colors.accentText,
    fontWeight: '500',
    marginTop: 1,
  },
  contactDetail: {
    fontSize: 12,
    color: t.colors.textSecondary,
    marginTop: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: t.colors.text,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: t.colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    backgroundColor: t.colors.accent,
  },
  // The modal's own styles moved with it into ContactEditModal.
}));
