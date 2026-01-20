/**
 * Quote Preview Screen
 * Final review and export/share quote
 */

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform, TouchableOpacity, Share, Linking } from 'react-native';
import {
  Text,
  Button,
  Surface,
  Title,
  Divider,
  TextInput,
  SegmentedButtons,
  Dialog,
  Portal,
  IconButton,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { formatCurrency } from '../../utils/quoteCalculator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuccessModal } from '../../components/SuccessModal';
import { FixedBottomButton } from '../../components/FixedBottomButton';

export function QuotePreviewScreen() {
  const navigation = useNavigation<any>();
  const { currentQuote, saveQuote, businessSettings } = useStore();
  const insets = useSafeAreaInsets();

  const [notes, setNotes] = useState(currentQuote?.notes || '');
  const [status, setStatus] = useState(currentQuote?.status || 'draft');
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  if (!currentQuote) {
    return null;
  }

  const handleSave = async () => {
    try {
      setIsSaving(true);

      const updatedQuote = {
        ...currentQuote,
        notes,
        status,
        updatedAt: new Date(),
      };

      await saveQuote(updatedQuote);

      // Show success modal
      setShowSuccessModal(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to save quote. Please try again.');
      setIsSaving(false);
    }
  };

  const handleSuccessModalDismiss = () => {
    setShowSuccessModal(false);
    setIsSaving(false);

    // Clear currentQuote from store
    useStore.setState({ currentQuote: null });

    // Navigate back to Dashboard by closing the modal
    // Get the root navigator (RootStack) and go back to Main
    navigation.getParent()?.goBack();
  };

  const handleSendQuote = () => {
    setSendDialogVisible(true);
  };

  const handleSendEmail = async () => {
    setSendDialogVisible(false);

    const subject = `Quote from ${businessSettings?.businessName || 'Your Business'}`;
    const body = `Hi ${currentQuote.customerName},\n\nPlease find attached your quote for ${currentQuote.job.name}.\n\nTotal: ${formatCurrency(currentQuote.total)}\n\nThank you!`;
    const email = currentQuote.customerEmail || '';

    const url = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('Error', 'Could not open email client');
    }
  };

  const handleSendSMS = async () => {
    setSendDialogVisible(false);

    const message = `Hi ${currentQuote.customerName}, your quote for ${currentQuote.job.name} is ready. Total: ${formatCurrency(currentQuote.total)}`;
    const phone = currentQuote.customerPhone || '';

    const url = Platform.OS === 'ios'
      ? `sms:${phone}&body=${encodeURIComponent(message)}`
      : `sms:${phone}?body=${encodeURIComponent(message)}`;

    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('Error', 'Could not open SMS');
    }
  };

  const handleShare = async () => {
    setSendDialogVisible(false);

    try {
      const message = `Quote for ${currentQuote.customerName}\n${currentQuote.job.name}\nTotal: ${formatCurrency(currentQuote.total)}`;

      await Share.share({
        message,
        title: 'Share Quote',
      });
    } catch (error) {
      Alert.alert('Error', 'Could not share quote');
    }
  };

  const handleExport = async () => {
    setSendDialogVisible(false);
    await handleExportPDF();
  };

  const handleEditCustomer = () => {
    navigation.navigate('CustomerDetails');
  };

  const handleEditJob = () => {
    navigation.navigate('JobDetails');
  };

  const handleEditMaterials = () => {
    navigation.navigate('MaterialsList');
  };

  const handleEditLabor = () => {
    navigation.navigate('LaborMarkup');
  };

  return (
    <View style={styles.outerContainer}>
      <SuccessModal
        visible={showSuccessModal}
        onDismiss={handleSuccessModalDismiss}
        title="Quote Saved!"
        message="Your quote has been saved successfully and is ready to share with your customer."
        buttonText="Back to Dashboard"
        icon="check-circle"
        quote={currentQuote}
        businessSettings={businessSettings}
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
      {/* Quote Details Preview */}
      <TouchableOpacity onPress={handleEditCustomer} activeOpacity={0.7}>
        <Surface style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title style={styles.sectionTitle}>Customer</Title>
            <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
          </View>
          <Text style={styles.text}>{currentQuote.customerName}</Text>
          {currentQuote.customerEmail && <Text style={styles.subtext}>{currentQuote.customerEmail}</Text>}
          {currentQuote.customerPhone && <Text style={styles.subtext}>{currentQuote.customerPhone}</Text>}
          {currentQuote.jobAddress && <Text style={styles.subtext}>{currentQuote.jobAddress}</Text>}
        </Surface>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleEditJob} activeOpacity={0.7}>
        <Surface style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title style={styles.sectionTitle}>Job</Title>
            <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
          </View>
          <Text style={styles.text}>{currentQuote.job.name}</Text>
          <Text style={styles.subtext}>{currentQuote.job.description}</Text>
        </Surface>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleEditMaterials} activeOpacity={0.7}>
        <Surface style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title style={styles.sectionTitle}>Materials ({currentQuote.materials.length})</Title>
            <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
          </View>
        {currentQuote.materials.length === 0 ? (
          <Text style={styles.subtext}>No materials required - Labor only</Text>
        ) : (
          currentQuote.materials.map((material) => (
            <View key={material.id} style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>{material.name}</Text>
                <Text style={styles.itemDetails}>
                  {material.quantity} {material.unit} × {formatCurrency(material.price)}
                </Text>
              </View>
              <Text style={styles.itemTotal}>{formatCurrency(material.totalPrice)}</Text>
            </View>
          ))
        )}
        <Divider style={styles.divider} />
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Materials Subtotal</Text>
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.materialsSubtotal)}</Text>
        </View>
        </Surface>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleEditLabor} activeOpacity={0.7}>
        <Surface style={styles.section}>
          <View style={styles.sectionHeader}>
            <Title style={styles.sectionTitle}>Labor</Title>
            <MaterialCommunityIcons name="pencil" size={20} color={colors.primary} />
          </View>
        <View style={styles.summaryRow}>
          <Text style={styles.text}>
            {businessSettings?.showLaborHours
              ? `${currentQuote.laborHours} hours @ ${formatCurrency(currentQuote.laborRate)}/hr`
              : 'Labor'}
          </Text>
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.laborTotal)}</Text>
        </View>
        </Surface>
      </TouchableOpacity>

      <Surface style={styles.totalSection}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.subtotal)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Markup ({currentQuote.markup}%)</Text>
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.markupAmount)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>GST (10%)</Text>
          <Text style={styles.summaryValue}>{formatCurrency(currentQuote.gst)}</Text>
        </View>
        <Divider style={styles.divider} />
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalValue}>{formatCurrency(currentQuote.total)}</Text>
        </View>
      </Surface>

      <Surface style={styles.section}>
        <Title style={styles.sectionTitle}>Status</Title>
        <SegmentedButtons
          value={status}
          onValueChange={setStatus}
          buttons={[
            { value: 'draft', label: 'Draft' },
            { value: 'sent', label: 'Sent' },
            { value: 'accepted', label: 'Accepted' },
            { value: 'rejected', label: 'Rejected' },
          ]}
        />
      </Surface>

      <Surface style={styles.section}>
        <Title style={styles.sectionTitle}>Notes (Optional)</Title>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          mode="outlined"
          multiline
          numberOfLines={4}
          placeholder="Add any additional notes for this quote..."
          style={styles.notesInput}
        />
      </Surface>
      </ScrollView>

      <FixedBottomButton
        label="Save Quote"
        onPress={handleSave}
        loading={isSaving}
        disabled={isSaving}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' && {
      maxHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
    }),
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 140,
    ...(Platform.OS === 'web' && {
      maxWidth: 800,
      marginHorizontal: 'auto' as any,
      width: '100%',
      paddingBottom: 16,
    }),
  },
  section: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    margin: 0,
    marginBottom: 12,
  },
  text: {
    fontSize: 14,
    marginBottom: 4,
  },
  subtext: {
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 2,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  itemDetails: {
    fontSize: 12,
    color: colors.onSurface,
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    marginVertical: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalSection: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 3,
    backgroundColor: colors.surfaceGray,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
  },
  notesInput: {
    textAlignVertical: 'top',
    paddingTop: 8,
  },
  dialogText: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 16,
  },
  sendOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: colors.surfaceLight,
  },
  sendOptionText: {
    flex: 1,
    marginLeft: 16,
  },
  sendOptionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 2,
  },
  sendOptionSubtitle: {
    fontSize: 13,
    color: colors.onSurface,
  },
});
