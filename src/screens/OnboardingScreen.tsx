/**
 * Onboarding Screen
 * First-time setup for business details and default rates
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
  TouchableOpacity,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Surface,
  Title,
  Paragraph,
  IconButton,
  Chip,
  Dialog,
  Portal,
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useStore } from '../store/useStore';
import { BusinessSettings, TradeType } from '../types';
import { colors } from '../theme';
import {
  getStoresForTrade,
  getDefaultStoresForTrade,
  TRADE_TYPE_LABELS
} from '../constants/tradeStores';

export function OnboardingScreen() {
  const { setBusinessSettings, setOnboarded } = useStore();

  const [businessName, setBusinessName] = useState('');
  const [abn, setAbn] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoUri, setLogoUri] = useState<string | undefined>(undefined);
  const [laborRate, setLaborRate] = useState('85');
  const [markup, setMarkup] = useState('20');
  const [tradeType, setTradeType] = useState<TradeType>('all');
  const [selectedStores, setSelectedStores] = useState<string[]>(getDefaultStoresForTrade('all'));
  const [customStores, setCustomStores] = useState<string[]>([]);
  const [newCustomStore, setNewCustomStore] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showAddStoreDialog, setShowAddStoreDialog] = useState(false);

  // Update selected stores when trade type changes
  const handleTradeTypeChange = (newTradeType: TradeType) => {
    setTradeType(newTradeType);
    // Reset to default stores for the new trade type
    const defaultStores = getDefaultStoresForTrade(newTradeType);
    setSelectedStores(defaultStores);
  };

  const handlePickLogo = async () => {
    try {
      // Request permission
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (permissionResult.granted === false) {
        Alert.alert('Permission Required', 'Permission to access camera roll is required!');
        return;
      }

      // Pick image
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1], // Square logo format
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setLogoUri(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image. Please try again.');
      console.error('Image picker error:', error);
    }
  };

  const handleRemoveLogo = () => {
    Alert.alert(
      'Remove Logo',
      'Are you sure you want to remove your company logo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => setLogoUri(undefined),
        },
      ]
    );
  };

  const handleToggleStore = (storeUrl: string) => {
    if (selectedStores.includes(storeUrl)) {
      setSelectedStores(selectedStores.filter(s => s !== storeUrl));
    } else {
      setSelectedStores([...selectedStores, storeUrl]);
    }
  };

  const handleAddCustomStore = () => {
    if (!newCustomStore.trim()) {
      return;
    }

    // Normalize the URL (remove http/https/www)
    let normalizedUrl = newCustomStore.trim().toLowerCase();
    normalizedUrl = normalizedUrl.replace(/^https?:\/\//, '');
    normalizedUrl = normalizedUrl.replace(/^www\./, '');
    normalizedUrl = normalizedUrl.replace(/\/$/, '');

    if (customStores.includes(normalizedUrl) || selectedStores.includes(normalizedUrl)) {
      Alert.alert('Store Already Added', 'This store is already in your list.');
      return;
    }

    setCustomStores([...customStores, normalizedUrl]);
    setSelectedStores([...selectedStores, normalizedUrl]);
    setNewCustomStore('');
    setShowAddStoreDialog(false);
  };

  const handleRemoveCustomStore = (storeUrl: string) => {
    setCustomStores(customStores.filter(s => s !== storeUrl));
    setSelectedStores(selectedStores.filter(s => s !== storeUrl));
  };

  const handleComplete = async () => {
    if (!businessName.trim()) {
      alert('Please enter your business name');
      return;
    }

    // Validate that at least one store is selected
    if (selectedStores.length === 0) {
      alert('Please select at least one hardware store');
      return;
    }

    const settings: BusinessSettings = {
      businessName: businessName.trim(),
      abn: abn.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      address: address.trim() || undefined,
      logoUri: logoUri,
      defaultLaborRate: parseFloat(laborRate) || 85,
      defaultMarkup: parseFloat(markup) || 20,
      tradeType: tradeType,
      useBunningsApi: false, // API not available, always use AI estimation
      useReeceApi: false, // API not available, always use AI estimation
      hardwareStores: selectedStores.length > 0 ? selectedStores : undefined,
      customStores: customStores.length > 0 ? customStores : undefined,
    };

    try {
      setIsLoading(true);
      await setBusinessSettings(settings);
      await setOnboarded(true);
    } catch (error) {
      alert('Failed to save settings. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.contentWrapper}>
          <View style={styles.header}>
            <Title style={styles.title}>Welcome to QuoteMate</Title>
            <Paragraph style={styles.subtitle}>
              Let's set up your business details
            </Paragraph>
          </View>

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Business Information</Title>

            <TextInput
              label="Business Name *"
              value={businessName}
              onChangeText={setBusinessName}
              mode="outlined"
              style={styles.input}
              placeholder="e.g., Smith's Carpentry"
            />

            {/* Logo Upload Section */}
            <View style={styles.logoSection}>
              <Text style={styles.logoLabel}>Company Logo (Optional)</Text>
              <Text style={styles.logoHelper}>
                This will appear on your PDF quotes and invoices
              </Text>

              {logoUri ? (
                <View style={styles.logoPreview}>
                  <Image source={{ uri: logoUri }} style={styles.logoImage} resizeMode="contain" />
                  <View style={styles.logoButtons}>
                    <Button mode="outlined" onPress={handlePickLogo} style={styles.logoButton}>
                      Change Logo
                    </Button>
                    <IconButton
                      icon="delete"
                      iconColor={colors.error}
                      size={24}
                      onPress={handleRemoveLogo}
                    />
                  </View>
                </View>
              ) : (
                <TouchableOpacity style={styles.logoUploadBox} onPress={handlePickLogo}>
                  <MaterialCommunityIcons
                    name="image-plus"
                    size={48}
                    color={colors.primary}
                  />
                  <Text style={styles.logoUploadText}>Tap to Upload Logo</Text>
                  <Text style={styles.logoUploadHint}>Recommended: 500x500px (Square)</Text>
                </TouchableOpacity>
              )}
            </View>

            <TextInput
              label="ABN (Optional)"
              value={abn}
              onChangeText={setAbn}
              mode="outlined"
              style={styles.input}
              placeholder="12 345 678 910"
              keyboardType="numeric"
            />

            <TextInput
              label="Email (Optional)"
              value={email}
              onChangeText={setEmail}
              mode="outlined"
              style={styles.input}
              placeholder="your.email@domain.com.au"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <TextInput
              label="Phone (Optional)"
              value={phone}
              onChangeText={setPhone}
              mode="outlined"
              style={styles.input}
              placeholder="0412 345 678"
              keyboardType="phone-pad"
            />

            <TextInput
              label="Business Address (Optional)"
              value={address}
              onChangeText={setAddress}
              mode="outlined"
              style={styles.input}
              multiline
              numberOfLines={3}
              placeholder="e.g., 123 Main St, Sydney NSW 2000"
            />
          </Surface>

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Default Rates</Title>
            <Text style={styles.helperText}>
              These will be used as defaults for new quotes
            </Text>

            <TextInput
              label="Hourly Labor Rate"
              value={laborRate}
              onChangeText={setLaborRate}
              mode="outlined"
              style={styles.input}
              keyboardType="decimal-pad"
              left={<TextInput.Affix text="$" />}
              right={<TextInput.Affix text="/hr" />}
            />

            <TextInput
              label="Markup Percentage"
              value={markup}
              onChangeText={setMarkup}
              mode="outlined"
              style={styles.input}
              keyboardType="decimal-pad"
              right={<TextInput.Affix text="%" />}
            />
          </Surface>

          {/* Trade Type Selection */}
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Trade Type</Title>
            <Text style={styles.helperText}>
              Select your trade to get relevant store recommendations
            </Text>

            <View style={styles.pillContainer}>
              {(Object.keys(TRADE_TYPE_LABELS) as TradeType[]).map((trade) => (
                <Chip
                  key={trade}
                  selected={tradeType === trade}
                  onPress={() => handleTradeTypeChange(trade)}
                  style={[
                    styles.tradePill,
                    tradeType === trade && styles.tradePillSelected
                  ]}
                  textStyle={tradeType === trade && styles.tradePillTextSelected}
                  mode={tradeType === trade ? 'flat' : 'outlined'}
                >
                  {TRADE_TYPE_LABELS[trade]}
                </Chip>
              ))}
            </View>
          </Surface>

          {/* Hardware Store Selection */}
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Hardware Stores *</Title>
            <Text style={styles.helperText}>
              Select stores for price estimation context. AI will estimate prices based on typical pricing from these stores.
            </Text>

            <View style={styles.pillContainer}>
              {getStoresForTrade(tradeType).map((store) => (
                <Chip
                  key={store.url}
                  selected={selectedStores.includes(store.url)}
                  onPress={() => handleToggleStore(store.url)}
                  style={[
                    styles.storePill,
                    selectedStores.includes(store.url) && styles.storePillSelected
                  ]}
                  textStyle={selectedStores.includes(store.url) && styles.storePillTextSelected}
                  mode={selectedStores.includes(store.url) ? 'flat' : 'outlined'}
                >
                  {store.name}
                </Chip>
              ))}

              {/* Custom stores */}
              {customStores.map((storeUrl) => (
                <Chip
                  key={storeUrl}
                  selected={selectedStores.includes(storeUrl)}
                  onPress={() => handleToggleStore(storeUrl)}
                  onClose={() => handleRemoveCustomStore(storeUrl)}
                  style={[
                    styles.storePill,
                    selectedStores.includes(storeUrl) && styles.storePillSelected
                  ]}
                  textStyle={selectedStores.includes(storeUrl) && styles.storePillTextSelected}
                  mode={selectedStores.includes(storeUrl) ? 'flat' : 'outlined'}
                >
                  {storeUrl}
                </Chip>
              ))}

              {/* Add Custom Store Button */}
              <Chip
                icon="plus"
                onPress={() => setShowAddStoreDialog(true)}
                style={styles.addStorePill}
                mode="outlined"
              >
                Add Custom Store
              </Chip>
            </View>

            <View style={styles.infoBox}>
              <MaterialCommunityIcons name="information" size={20} color={colors.primary} />
              <Text style={styles.infoBoxText}>
                Select the stores where you typically purchase materials. AI will use this context for price estimates.
              </Text>
            </View>
          </Surface>

          <Button
            mode="contained"
            onPress={handleComplete}
            style={styles.button}
            loading={isLoading}
            disabled={isLoading}
          >
            Get Started
          </Button>
        </View>
      </ScrollView>

      {/* Add Custom Store Dialog */}
      <Portal>
        <Dialog
          visible={showAddStoreDialog}
          onDismiss={() => {
            setShowAddStoreDialog(false);
            setNewCustomStore('');
          }}
          style={styles.dialog}
        >
          <Dialog.Icon icon="store-plus" />
          <Dialog.Title style={styles.dialogTitle}>Add Custom Store</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogHelperText}>
              Enter the store website URL (no need for http:// or www.)
            </Text>
            <TextInput
              label="Store URL"
              value={newCustomStore}
              onChangeText={setNewCustomStore}
              mode="outlined"
              placeholder="storename.com.au"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.dialogInput}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => {
              setShowAddStoreDialog(false);
              setNewCustomStore('');
            }}>
              Cancel
            </Button>
            <Button onPress={handleAddCustomStore} mode="contained">
              Add Store
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 20,
    alignItems: 'center',
  },
  contentWrapper: {
    width: '100%',
    maxWidth: 800,
  },
  header: {
    marginBottom: 24,
    marginTop: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.onSurface,
  },
  card: {
    padding: 16,
    marginBottom: 20,
    borderRadius: 8,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  input: {
    marginBottom: 20,
  },
  button: {
    marginTop: 12,
    marginBottom: 40,
    paddingVertical: 8,
  },
  helperText: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 12,
  },
  logoSection: {
    marginBottom: 16,
    marginTop: 8,
  },
  logoLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
    color: colors.text,
  },
  logoHelper: {
    fontSize: 12,
    color: colors.onSurface,
    marginBottom: 12,
  },
  logoUploadBox: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  logoUploadText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 12,
  },
  logoUploadHint: {
    fontSize: 12,
    color: colors.onSurface,
    marginTop: 4,
  },
  logoPreview: {
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: 8,
    padding: 16,
    backgroundColor: colors.surfaceLight,
  },
  logoImage: {
    width: '100%',
    height: 120,
    marginBottom: 12,
  },
  logoButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoButton: {
    flex: 1,
    marginRight: 8,
  },
  pillContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  tradePill: {
    marginRight: 0,
    marginBottom: 0,
  },
  tradePillSelected: {
    backgroundColor: colors.primary,
  },
  tradePillTextSelected: {
    color: colors.surface,
    fontWeight: '600',
  },
  storePill: {
    marginRight: 0,
    marginBottom: 0,
  },
  storePillSelected: {
    backgroundColor: colors.primary,
  },
  storePillTextSelected: {
    color: colors.surface,
    fontWeight: '600',
  },
  addStorePill: {
    marginRight: 0,
    marginBottom: 0,
    borderStyle: 'dashed',
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  infoBoxText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  dialog: {
    maxWidth: 800,
    width: '90%',
    alignSelf: 'center',
  },
  dialogTitle: {
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '600',
  },
  dialogHelperText: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 16,
    textAlign: 'center',
  },
  dialogInput: {
    marginTop: 8,
  },
});
