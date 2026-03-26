/**
 * Contacts Screen
 * Manage customer contacts — view, add, edit, delete
 * Phone contacts are a live search source (not imported here).
 * Contacts are built organically from quoting history.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {
  Text,
  Surface,
  Searchbar,
  Chip,
  FAB,
  Portal,
  Modal,
  TextInput,
  Button,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useStore } from '../store/useStore';
import { colors } from '../theme';
import { Contact } from '../types';
import {
  createContact,
  updateContact,
} from '../services/contactService';
import { SOURCE_COLORS } from '../hooks/useUnifiedContactSearch';
import { ContactActionsBar } from '../components/document/ContactActionsBar';

type FilterType = 'all' | 'saved' | 'xero';

export function ContactsScreen() {
  const { contacts, xeroContacts, xeroConnection, saveContact, deleteContact, syncXeroContacts } = useStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [xeroSyncing, setXeroSyncing] = useState(false);

  // Form state for add/edit
  const [formName, setFormName] = useState('');
  const [formBusinessName, setFormBusinessName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formWebsite, setFormWebsite] = useState('');
  const [formNotes, setFormNotes] = useState('');

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
    setFormName('');
    setFormBusinessName('');
    setFormEmail('');
    setFormPhone('');
    setFormAddress('');
    setFormWebsite('');
    setFormNotes('');
    setEditModalVisible(true);
  };

  const openEditModal = (contact: Contact) => {
    setEditingContact(contact);
    setFormName(contact.name);
    setFormBusinessName(contact.businessName || '');
    setFormEmail(contact.email || '');
    setFormPhone(contact.phone || '');
    setFormAddress(contact.address || '');
    setFormWebsite(contact.website || '');
    setFormNotes(contact.notes || '');
    setEditModalVisible(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) return;

    if (editingContact) {
      const updated = updateContact(editingContact, {
        name: formName.trim(),
        businessName: formBusinessName.trim() || undefined,
        email: formEmail.trim() || undefined,
        phone: formPhone.trim() || undefined,
        address: formAddress.trim() || undefined,
        website: formWebsite.trim() || undefined,
        notes: formNotes.trim() || undefined,
      });
      await saveContact(updated);
    } else {
      const contact = createContact({
        name: formName.trim(),
        businessName: formBusinessName.trim() || undefined,
        email: formEmail.trim() || undefined,
        phone: formPhone.trim() || undefined,
        address: formAddress.trim() || undefined,
        website: formWebsite.trim() || undefined,
        notes: formNotes.trim() || undefined,
        source: 'manual',
      });
      await saveContact(contact);
    }

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

  const renderContact = ({ item }: { item: Contact }) => (
    <TouchableOpacity onPress={() => openEditModal(item)} onLongPress={() => handleDelete(item)}>
      <Surface style={styles.contactCard}>
        <View style={styles.contactRow}>
          <View style={styles.contactAvatar}>
            <MaterialCommunityIcons name="account" size={24} color={colors.primary} />
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
        </View>
      </Surface>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
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
      {xeroConnection && (
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionButton} onPress={handleXeroSync} disabled={xeroSyncing}>
            <MaterialCommunityIcons name="cloud-sync" size={18} color={colors.primary} />
            <Text style={styles.actionButtonText}>{xeroSyncing ? 'Syncing...' : 'Sync Xero'}</Text>
          </TouchableOpacity>
        </View>
      )}

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
                <MaterialCommunityIcons name="plus" size={14} color={colors.primary} />
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
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="account-group-outline" size={48} color={colors.onSurface} />
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
        color={colors.white}
      />

      {/* Add/Edit Contact Modal */}
      <Portal>
        <Modal
          visible={editModalVisible}
          onDismiss={() => setEditModalVisible(false)}
          contentContainerStyle={styles.modalContainer}
        >
          <Text style={styles.modalTitle}>
            {editingContact ? 'Edit Contact' : 'New Contact'}
          </Text>
          <TextInput
            label="Name *"
            value={formName}
            onChangeText={setFormName}
            mode="outlined"
            style={styles.modalInput}
            autoCapitalize="words"
          />
          <TextInput
            label="Business Name"
            value={formBusinessName}
            onChangeText={setFormBusinessName}
            mode="outlined"
            style={styles.modalInput}
            autoCapitalize="words"
          />
          <TextInput
            label="Email"
            value={formEmail}
            onChangeText={setFormEmail}
            mode="outlined"
            style={styles.modalInput}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            label="Phone"
            value={formPhone}
            onChangeText={setFormPhone}
            mode="outlined"
            style={styles.modalInput}
            keyboardType="phone-pad"
          />
          <TextInput
            label="Address"
            value={formAddress}
            onChangeText={setFormAddress}
            mode="outlined"
            style={styles.modalInput}
            multiline
          />
          <TextInput
            label="Website"
            value={formWebsite}
            onChangeText={setFormWebsite}
            mode="outlined"
            style={styles.modalInput}
            keyboardType="url"
            autoCapitalize="none"
          />
          <TextInput
            label="Notes"
            value={formNotes}
            onChangeText={setFormNotes}
            mode="outlined"
            style={styles.modalInput}
            multiline
          />
          <View style={styles.modalButtons}>
            <Button mode="text" onPress={() => setEditModalVisible(false)}>
              Cancel
            </Button>
            {editingContact && (
              <Button
                mode="text"
                textColor={colors.error}
                onPress={() => {
                  setEditModalVisible(false);
                  handleDelete(editingContact);
                }}
              >
                Delete
              </Button>
            )}
            <Button mode="contained" onPress={handleSave} disabled={!formName.trim()}>
              Save
            </Button>
          </View>
        </Modal>
      </Portal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  searchbar: {
    borderRadius: 12,
    backgroundColor: colors.surface,
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
    backgroundColor: colors.primary + '15',
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  xeroSection: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  xeroSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  xeroSectionSubtitle: {
    fontSize: 11,
    color: colors.onSurface,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: SOURCE_COLORS.xero + '40',
  },
  xeroChipText: {
    fontSize: 12,
    color: colors.text,
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
    backgroundColor: colors.surface,
    elevation: 1,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary + '20',
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
    color: colors.text,
  },
  contactSource: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  contactBusiness: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
    marginTop: 1,
  },
  contactDetail: {
    fontSize: 12,
    color: colors.onSurface,
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
    color: colors.text,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.onSurface,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    backgroundColor: colors.primary,
  },
  modalContainer: {
    backgroundColor: colors.surface,
    margin: 20,
    padding: 20,
    borderRadius: 16,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
  },
  modalInput: {
    marginBottom: 12,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
});
