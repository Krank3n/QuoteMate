/**
 * Settings Screen
 * Business configuration and default rates
 */

import React, { useState, useEffect } from 'react';
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
  Divider,
  IconButton,
  Chip,
  Switch,
  Dialog,
  Portal,
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import { BusinessSettings, TradeType, HardwareStore } from '../types';
import { colors } from '../theme';
import { WebContainer } from '../components/WebContainer';
import { auth } from '../config/firebase';
import { signOut } from 'firebase/auth';
import {
  getStoresForTrade,
  getDefaultStoresForTrade,
  TRADE_TYPE_LABELS
} from '../constants/tradeStores';
import { FixedBottomButton } from '../components/FixedBottomButton';

export function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { businessSettings, setBusinessSettings, subscriptionStatus, clearAllData } = useStore();

  const [businessName, setBusinessName] = useState('');
  const [abn, setAbn] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoUri, setLogoUri] = useState<string | undefined>(undefined);
  const [laborRate, setLaborRate] = useState('85');
  const [markup, setMarkup] = useState('20');
  const [tradeType, setTradeType] = useState<TradeType>('all');
  const [useBunningsApi, setUseBunningsApi] = useState(false);
  const [useReeceApi, setUseReeceApi] = useState(false);
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [customStores, setCustomStores] = useState<string[]>([]);
  const [newCustomStore, setNewCustomStore] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [showAddStoreDialog, setShowAddStoreDialog] = useState(false);

  // Load current settings
  useEffect(() => {
    if (businessSettings) {
      setBusinessName(businessSettings.businessName);
      setAbn(businessSettings.abn || '');
      setEmail(businessSettings.email || '');
      setPhone(businessSettings.phone || '');
      setAddress(businessSettings.address || '');
      setLogoUri(businessSettings.logoUri);
      setLaborRate(businessSettings.defaultLaborRate.toString());
      setMarkup(businessSettings.defaultMarkup.toString());

      // Load trade type
      const loadedTradeType = businessSettings.tradeType || 'all';
      setTradeType(loadedTradeType);

      setUseBunningsApi(businessSettings.useBunningsApi === true);
      setUseReeceApi(businessSettings.useReeceApi === true);

      // Load selected stores or use defaults for trade type
      const stores = businessSettings.hardwareStores || getDefaultStoresForTrade(loadedTradeType);
      setSelectedStores(stores);

      // Load custom stores
      setCustomStores(businessSettings.customStores || []);
    }
  }, [businessSettings]);

  // Update selected stores when trade type changes
  const handleTradeTypeChange = (newTradeType: TradeType) => {
    setTradeType(newTradeType);
    // Reset to default stores for the new trade type
    const defaultStores = getDefaultStoresForTrade(newTradeType);
    setSelectedStores(defaultStores);

    // Reece API is disabled by default (no API access currently)
    setUseReeceApi(false);
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

  const handleSave = async () => {
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
      alert('Settings saved successfully!');
    } catch (error) {
      alert('Failed to save settings. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    console.log('🚪 handleLogout called');
    setShowLogoutDialog(true);
  };

  const confirmLogout = async () => {
    setShowLogoutDialog(false);

    try {
      console.log('🔓 User confirmed logout, starting sign out process...');

      // Step 1: Sign out from Firebase first to trigger auth state change
      console.log('🔐 Step 1: Signing out from Firebase...');
      await signOut(auth);
      console.log('✅ Step 1: Signed out from Firebase');

      // Step 2: Clear all app data
      console.log('🧹 Step 2: Clearing all local data...');
      await clearAllData();
      console.log('✅ Step 2: Local data cleared');

      // Step 3: On web, clear all browser storage and reload
      if (Platform.OS === 'web') {
        console.log('🧹 Step 3: Clearing all browser storage...');

        // Clear ALL localStorage including Firebase auth to ensure complete logout
        try {
          console.log('🧹 Step 3a: Clearing localStorage...');
          localStorage.clear();
          console.log('✅ Step 3a: localStorage cleared');
        } catch (e) {
          console.warn('Could not clear localStorage:', e);
        }

        // Clear sessionStorage
        try {
          console.log('🧹 Step 3b: Clearing sessionStorage...');
          sessionStorage.clear();
          console.log('✅ Step 3b: sessionStorage cleared');
        } catch (e) {
          console.warn('Could not clear sessionStorage:', e);
        }

        // Clear IndexedDB (where Firebase stores auth)
        try {
          console.log('🧹 Step 3c: Clearing IndexedDB...');
          if (window.indexedDB) {
            const dbs = await window.indexedDB.databases();
            console.log('🧹 Found IndexedDB databases:', dbs.map(db => db.name));
            for (const db of dbs) {
              if (db.name) {
                console.log(`🧹 Deleting IndexedDB: ${db.name}`);
                window.indexedDB.deleteDatabase(db.name);
              }
            }
            console.log('✅ Step 3c: IndexedDB cleared');
          }
        } catch (e) {
          console.warn('Could not clear IndexedDB:', e);
        }

        console.log('🔄 Step 4: Reloading page...');
        // Use replace to ensure we don't go back to the authenticated state
        window.location.replace(window.location.origin);
      } else {
        console.log('📱 Mobile platform - navigation should handle redirect');
      }
    } catch (error: any) {
      console.error('❌ Error during sign out:', error);
      console.error('❌ Error details:', error.message, error.code);
      alert('Failed to sign out. Please try again.');
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <WebContainer>
          {/* Subscription Section - Moved to Top */}
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Subscription</Title>

            <View style={styles.subscriptionInfo}>
              {subscriptionStatus?.isPro ? (
                <>
                  <View style={styles.proBadge}>
                    <MaterialCommunityIcons name="crown" size={24} color={colors.secondary} />
                    <Text style={styles.proText}>Pro Member</Text>
                  </View>
                  <Text style={styles.proStatusText}>
                    You have unlimited quote analyses. Thank you for your support!
                  </Text>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('Paywall' as never)}
                    style={styles.manageSubscriptionLink}
                  >
                    <Text style={styles.manageSubscriptionText}>Manage Subscription</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.quotaInfo}>
                    <Text style={styles.quotaText}>
                      Free Plan: {subscriptionStatus?.quotesThisMonth || 0} of {subscriptionStatus?.freeQuotesLimit || 5} quote analyses used this month
                    </Text>
                  </View>
                  <Text style={styles.upgradeDescription}>
                    Get unlimited quote analyses, priority support, and more.
                  </Text>
                  <Button
                    mode="contained"
                    onPress={() => navigation.navigate('Paywall' as never)}
                    style={styles.upgradeButton}
                    contentStyle={styles.upgradeButtonContent}
                    icon="crown"
                  >
                    Upgrade to Pro
                  </Button>
                </>
              )}
            </View>
          </Surface>

          <Surface style={styles.card}>
          <Title style={styles.sectionTitle}>Business Information</Title>

          <TextInput
            label="Business Name *"
            value={businessName}
            onChangeText={setBusinessName}
            mode="outlined"
            style={styles.input}
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
            label="ABN"
            value={abn}
            onChangeText={setAbn}
            mode="outlined"
            style={styles.input}
            keyboardType="numeric"
          />

          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            mode="outlined"
            style={styles.input}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <TextInput
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            mode="outlined"
            style={styles.input}
            keyboardType="phone-pad"
          />

          <TextInput
            label="Business Address"
            value={address}
            onChangeText={setAddress}
            mode="outlined"
            style={styles.input}
            multiline
            numberOfLines={3}
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
          <Title style={styles.sectionTitle}>Hardware Stores</Title>
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

        <Divider style={styles.divider} />

        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>About QuoteMate</Text>
          <Text style={styles.infoText}>Version 1.0.0</Text>
          <Text style={styles.infoText}>
            Quoting tool for Australian tradies with AI and Bunnings integration
          </Text>
        </View>

        {/* Sign Out Section */}
        {auth.currentUser && (
          <>
            <Divider style={styles.divider} />
            <Surface style={styles.logoutCard}>
              <View style={styles.logoutSection}>
                <View style={styles.userInfo}>
                  <MaterialCommunityIcons name="account-circle" size={40} color={colors.primary} />
                  <View style={styles.userDetails}>
                    <Text style={styles.userEmail}>{auth.currentUser.email}</Text>
                    <Text style={styles.userIdText}>User ID: {auth.currentUser.uid.slice(0, 8)}...</Text>
                  </View>
                </View>
                <Button
                  mode="outlined"
                  onPress={handleLogout}
                  style={styles.logoutButton}
                  icon="logout"
                  textColor={colors.error}
                  buttonColor={colors.surface}
                >
                  Sign Out
                </Button>
              </View>
            </Surface>
          </>
        )}
        </WebContainer>
      </ScrollView>

      {/* Fixed Save Button */}
      <FixedBottomButton
        label="Save Settings"
        onPress={handleSave}
        disabled={isLoading}
        loading={isLoading}
      />

      {/* Logout Confirmation Dialog */}
      <Portal>
        <Dialog
          visible={showLogoutDialog}
          onDismiss={() => setShowLogoutDialog(false)}
          style={styles.logoutDialog}
        >
          <Dialog.Icon icon="logout" />
          <Dialog.Title style={styles.dialogTitle}>Sign Out</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogText}>
              Are you sure you want to sign out? All local data will be cleared.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setShowLogoutDialog(false)}>Cancel</Button>
            <Button onPress={confirmLogout} textColor={colors.error}>
              Sign Out
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Add Custom Store Dialog */}
        <Dialog
          visible={showAddStoreDialog}
          onDismiss={() => {
            setShowAddStoreDialog(false);
            setNewCustomStore('');
          }}
          style={styles.logoutDialog}
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
              placeholder="example.com.au"
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' && {
      display: 'flex' as any,
      flexDirection: 'column' as any,
      height: '100vh' as any,
      overflow: 'hidden' as any,
    }),
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 120,
    flexGrow: 1,
    ...(Platform.OS === 'web' && {
      maxWidth: 800,
      margin: 'auto' as any,
      width: '100%',
    }),
  },
  card: {
    padding: 20,
    marginBottom: 20,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
    ...Platform.select({
      web: {
        maxWidth: 600,
        alignSelf: 'center',
        width: '100%',
      },
    }),
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  input: {
    marginBottom: 20,
  },
  helperText: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 12,
  },
  divider: {
    marginVertical: 20,
  },
  infoSection: {
    paddingVertical: 12,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 4,
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
  subscriptionInfo: {
    marginTop: 8,
  },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningBg,
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  proText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.secondary,
    marginLeft: 8,
  },
  quotaInfo: {
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  quotaText: {
    fontSize: 14,
    fontWeight: '500',
  },
  upgradeButton: {
    marginTop: 16,
  },
  upgradeButtonContent: {
    paddingVertical: 8,
  },
  upgradeDescription: {
    fontSize: 14,
    color: colors.onSurface,
    marginTop: 12,
    marginBottom: 4,
  },
  proStatusText: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 16,
  },
  manageSubscriptionLink: {
    alignSelf: 'flex-start',
  },
  manageSubscriptionText: {
    fontSize: 12,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  switchLabel: {
    flex: 1,
    marginRight: 16,
  },
  switchTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  switchSubtitle: {
    fontSize: 13,
    color: colors.onSurface,
  },
  smallDivider: {
    marginVertical: 16,
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
  logoutCard: {
    padding: 20,
    marginBottom: 80,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
    ...Platform.select({
      web: {
        maxWidth: 600,
        alignSelf: 'center',
        width: '100%',
      },
    }),
  },
  logoutSection: {
    alignItems: 'center',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    alignSelf: 'stretch',
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.outline + '30',
  },
  userDetails: {
    marginLeft: 16,
    flex: 1,
  },
  userEmail: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
    color: colors.text,
  },
  userIdText: {
    fontSize: 13,
    color: colors.onSurface,
  },
  logoutButton: {
    borderColor: colors.error,
    borderWidth: 1.5,
    alignSelf: 'stretch',
    paddingVertical: 4,
  },
  logoutDialog: {
    maxWidth: 800,
    width: '90%',
    alignSelf: 'center',
  },
  dialogTitle: {
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '600',
  },
  dialogText: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
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
});
