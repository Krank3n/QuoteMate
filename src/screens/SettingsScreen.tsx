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
import { signOut, deleteUser } from 'firebase/auth';
import {
  getStoresForTrade,
  getDefaultStoresForTrade,
  TRADE_TYPE_LABELS
} from '../constants/tradeStores';
import {
  TRADE_CATEGORIES,
  TradeCategory,
  TradeNiche,
  getTradeCategoryById,
  getTradeNicheById,
} from '../constants/tradeCategories';
import { FixedBottomButton } from '../components/FixedBottomButton';
import { AlertModal } from '../components/AlertModal';

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
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedNiches, setSelectedNiches] = useState<string[]>([]);
  const [useBunningsApi, setUseBunningsApi] = useState(false);
  const [useReeceApi, setUseReeceApi] = useState(false);
  const [selectedStore, setSelectedStore] = useState<string>('bunnings'); // Single store selection
  const [isLoading, setIsLoading] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [showDeleteAccountDialog, setShowDeleteAccountDialog] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);

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

      // Load trade categories and niches (prioritize new multi-select fields)
      setSelectedCategories(businessSettings.tradeCategories || (businessSettings.tradeCategory ? [businessSettings.tradeCategory] : []));
      setSelectedNiches(businessSettings.tradeNiches || (businessSettings.tradeNiche ? [businessSettings.tradeNiche] : []));

      setUseBunningsApi(businessSettings.useBunningsApi === true);
      setUseReeceApi(false); // Always false - API coming soon

      // Load selected store (single store only now)
      const store = businessSettings.selectedStore || 'bunnings';
      setSelectedStore(store);
    }
  }, [businessSettings]);

  // Update selected store when trade type changes
  const handleTradeTypeChange = (newTradeType: TradeType) => {
    setTradeType(newTradeType);
    // Reset to Bunnings as default
    setSelectedStore('bunnings');

    // Reece API is disabled by default (no API access currently)
    setUseReeceApi(false);
  };

  // Handle trade category toggle (multi-select)
  const handleCategoryToggle = (categoryId: string) => {
    setSelectedCategories(prev => {
      if (prev.includes(categoryId)) {
        // Remove category and its niches
        const category = getTradeCategoryById(categoryId);
        const nicheIds = category?.niches.map(n => n.id) || [];
        setSelectedNiches(niches => niches.filter(n => !nicheIds.includes(n)));
        return prev.filter(c => c !== categoryId);
      } else {
        // Add category
        return [...prev, categoryId];
      }
    });
  };

  // Handle trade niche toggle (multi-select)
  const handleNicheToggle = (nicheId: string, categoryId: string) => {
    setSelectedNiches(prev => {
      // If clicking on "All [Category] Services" (id === 'all')
      if (nicheId === 'all') {
        const category = getTradeCategoryById(categoryId);
        if (!category) return prev;

        const allNicheIds = category.niches.map(n => n.id);
        const allSelected = allNicheIds.every(id => prev.includes(id));

        if (allSelected) {
          // Deselect all niches from this category
          return prev.filter(n => !allNicheIds.includes(n));
        } else {
          // Select all niches from this category
          const otherNiches = prev.filter(n => !allNicheIds.includes(n));
          return [...otherNiches, ...allNicheIds];
        }
      }

      // Normal toggle for non-"all" niches
      if (prev.includes(nicheId)) {
        return prev.filter(n => n !== nicheId);
      } else {
        return [...prev, nicheId];
      }
    });
  };

  // Get all niches from selected categories
  const availableNiches = selectedCategories.flatMap(catId => {
    const category = getTradeCategoryById(catId);
    return category?.niches.map(niche => ({ ...niche, categoryId: catId })) || [];
  });

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

  // Handle store selection (single store only)
  const handleStoreSelect = (storeId: string) => {
    setSelectedStore(storeId);
  };

  const handleSave = async () => {
    if (!businessName.trim()) {
      alert('Please enter your business name');
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
      tradeCategories: selectedCategories.length > 0 ? selectedCategories : undefined,
      tradeNiches: selectedNiches.length > 0 ? selectedNiches : undefined,
      useBunningsApi: false, // API not available, always use AI estimation
      useReeceApi: false, // API not available, always use AI estimation
      selectedStore: selectedStore, // Single store selection
    };

    try {
      setIsLoading(true);
      await setBusinessSettings(settings);
      setShowSuccessModal(true);
    } catch (error) {
      setShowErrorModal(true);
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

  const handleDeleteAccount = () => {
    console.log('🗑️ handleDeleteAccount called');
    setShowDeleteAccountDialog(true);
  };

  const confirmDeleteAccount = async () => {
    setShowDeleteAccountDialog(false);

    try {
      console.log('🗑️ User confirmed account deletion, starting deletion process...');

      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('No user is currently signed in');
      }

      // Step 1: Clear all local app data first
      console.log('🧹 Step 1: Clearing all local data...');
      await clearAllData();
      console.log('✅ Step 1: Local data cleared');

      // Step 2: Delete user account from Firebase
      console.log('🗑️ Step 2: Deleting Firebase user account...');
      await deleteUser(currentUser);
      console.log('✅ Step 2: Firebase account deleted');

      // Step 3: On web, clear all browser storage and reload
      if (Platform.OS === 'web') {
        console.log('🧹 Step 3: Clearing all browser storage...');

        try {
          localStorage.clear();
          sessionStorage.clear();
          if (window.indexedDB) {
            const dbs = await window.indexedDB.databases();
            for (const db of dbs) {
              if (db.name) {
                window.indexedDB.deleteDatabase(db.name);
              }
            }
          }
        } catch (e) {
          console.warn('Could not clear browser storage:', e);
        }

        console.log('🔄 Step 4: Reloading page...');
        window.location.replace(window.location.origin);
      } else {
        console.log('📱 Mobile platform - navigation should handle redirect');
      }
    } catch (error: any) {
      console.error('❌ Error during account deletion:', error);
      console.error('❌ Error details:', error.message, error.code);

      if (error.code === 'auth/requires-recent-login') {
        Alert.alert(
          'Re-authentication Required',
          'For security, you need to sign in again before deleting your account. Please sign out and sign back in, then try again.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Deletion Failed',
          'Failed to delete account: ' + (error.message || 'Unknown error'),
          [{ text: 'OK' }]
        );
      }
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

        {/* Trade Category Selection */}
        <Surface style={styles.card}>
          <Title style={styles.sectionTitle}>Trade Categories</Title>
          <Text style={styles.helperText}>
            Select all categories that apply to your business (multi-select)
          </Text>

          <View style={styles.categoryGrid}>
            {TRADE_CATEGORIES.map((category) => {
              const isSelected = selectedCategories.includes(category.id);
              return (
                <TouchableOpacity
                  key={category.id}
                  style={[
                    styles.categoryCard,
                    isSelected && styles.categoryCardSelected,
                  ]}
                  onPress={() => handleCategoryToggle(category.id)}
                >
                  {isSelected && (
                    <View style={styles.categoryCheckmark}>
                      <MaterialCommunityIcons name="check-circle" size={20} color={colors.primary} />
                    </View>
                  )}
                  <View style={[styles.categoryIconContainer, { backgroundColor: category.color + '20' }]}>
                    <MaterialCommunityIcons
                      name={category.icon as any}
                      size={28}
                      color={isSelected ? colors.primary : category.color}
                    />
                  </View>
                  <View style={styles.categoryNameContainer}>
                    <Text
                      style={[
                        styles.categoryName,
                        isSelected && styles.categoryNameSelected
                      ]}
                      numberOfLines={3}
                      ellipsizeMode="tail"
                    >
                      {category.name}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </Surface>

        {/* Trade Niche Selection (shown when categories are selected) */}
        {selectedCategories.length > 0 && availableNiches.length > 0 && (
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Specialties / Niches</Title>
            <Text style={styles.helperText}>
              Select all specific areas of expertise within your selected categories (multi-select)
            </Text>

            <View style={styles.pillContainer}>
              {availableNiches.map((niche) => {
                const isSelected = selectedNiches.includes(niche.id);
                return (
                  <Chip
                    key={`${niche.categoryId}-${niche.id}`}
                    selected={isSelected}
                    onPress={() => handleNicheToggle(niche.id, niche.categoryId)}
                    style={[
                      styles.nichePill,
                      isSelected && styles.nichePillSelected
                    ]}
                    textStyle={[
                      isSelected && styles.nichePillTextSelected,
                      isSelected && { color: colors.surface }
                    ]}
                    mode={isSelected ? 'flat' : 'outlined'}
                    icon={({ size }) => (
                      <MaterialCommunityIcons
                        name={niche.icon as any}
                        size={size}
                        color={isSelected ? colors.surface : colors.primary}
                      />
                    )}
                  >
                    {niche.name}
                  </Chip>
                );
              })}
            </View>
          </Surface>
        )}

        {/* Hardware Store Selection */}
        <Surface style={styles.card}>
          <Title style={styles.sectionTitle}>Hardware Store</Title>
          <Text style={styles.helperText}>
            Select your preferred hardware store for pricing
          </Text>

          {/* Accurate Pricing Section */}
          <View style={styles.storeCategory}>
            <View style={styles.storeCategoryHeader}>
              <MaterialCommunityIcons name="check-circle" size={20} color="#4CAF50" />
              <Text style={styles.storeCategoryTitle}>More Accurate Pricing</Text>
            </View>
            <Text style={styles.storeCategoryDescription}>
              Stores with more reliable web search pricing or API access.
            </Text>

            {/* Bunnings - Available */}
            <TouchableOpacity
              style={[
                styles.storeRadioOption,
                selectedStore === 'bunnings' && styles.storeRadioOptionSelected
              ]}
              onPress={() => handleStoreSelect('bunnings')}
            >
              <View style={styles.storeRadioLeft}>
                <View style={[
                  styles.radioButton,
                  selectedStore === 'bunnings' && styles.radioButtonSelected
                ]}>
                  {selectedStore === 'bunnings' && (
                    <View style={styles.radioButtonInner} />
                  )}
                </View>
                <View style={styles.storeInfo}>
                  <Text style={styles.storeName}>Bunnings</Text>
                  <Text style={styles.storeMethod}>Web Search</Text>
                </View>
              </View>
              <MaterialCommunityIcons
                name="check-circle"
                size={20}
                color="#4CAF50"
              />
            </TouchableOpacity>

            {/* Reece - Coming Soon */}
            <TouchableOpacity
              style={[styles.storeRadioOption, styles.storeRadioOptionDisabled]}
              disabled={true}
            >
              <View style={styles.storeRadioLeft}>
                <View style={styles.radioButton}>
                  <View style={styles.radioButtonDisabled} />
                </View>
                <View style={styles.storeInfo}>
                  <Text style={[styles.storeName, styles.storeNameDisabled]}>Reece</Text>
                  <Text style={styles.storeMethod}>API Integration</Text>
                </View>
              </View>
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonText}>Coming Soon</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Guestimates Section */}
          <View style={styles.storeCategory}>
            <View style={styles.storeCategoryHeader}>
              <MaterialCommunityIcons name="approximately-equal" size={20} color="#FF9800" />
              <Text style={styles.storeCategoryTitle}>Guestimates</Text>
            </View>
            <Text style={styles.storeCategoryDescription}>
              AI-estimated pricing based on typical product costs
            </Text>

            {/* Mitre 10 */}
            <TouchableOpacity
              style={[
                styles.storeRadioOption,
                selectedStore === 'mitre10' && styles.storeRadioOptionSelected
              ]}
              onPress={() => handleStoreSelect('mitre10')}
            >
              <View style={styles.storeRadioLeft}>
                <View style={[
                  styles.radioButton,
                  selectedStore === 'mitre10' && styles.radioButtonSelected
                ]}>
                  {selectedStore === 'mitre10' && (
                    <View style={styles.radioButtonInner} />
                  )}
                </View>
                <View style={styles.storeInfo}>
                  <Text style={styles.storeName}>Mitre 10</Text>
                  <Text style={styles.storeMethod}>AI Estimation</Text>
                </View>
              </View>
              <MaterialCommunityIcons
                name="approximately-equal"
                size={20}
                color="#FF9800"
              />
            </TouchableOpacity>

            {/* Home Timber & Hardware */}
            <TouchableOpacity
              style={[
                styles.storeRadioOption,
                selectedStore === 'hth' && styles.storeRadioOptionSelected
              ]}
              onPress={() => handleStoreSelect('hth')}
            >
              <View style={styles.storeRadioLeft}>
                <View style={[
                  styles.radioButton,
                  selectedStore === 'hth' && styles.radioButtonSelected
                ]}>
                  {selectedStore === 'hth' && (
                    <View style={styles.radioButtonInner} />
                  )}
                </View>
                <View style={styles.storeInfo}>
                  <Text style={styles.storeName}>Home Timber & Hardware</Text>
                  <Text style={styles.storeMethod}>AI Estimation</Text>
                </View>
              </View>
              <MaterialCommunityIcons
                name="approximately-equal"
                size={20}
                color="#FF9800"
              />
            </TouchableOpacity>

            {/* Total Tools */}
            <TouchableOpacity
              style={[
                styles.storeRadioOption,
                selectedStore === 'totaltools' && styles.storeRadioOptionSelected
              ]}
              onPress={() => handleStoreSelect('totaltools')}
            >
              <View style={styles.storeRadioLeft}>
                <View style={[
                  styles.radioButton,
                  selectedStore === 'totaltools' && styles.radioButtonSelected
                ]}>
                  {selectedStore === 'totaltools' && (
                    <View style={styles.radioButtonInner} />
                  )}
                </View>
                <View style={styles.storeInfo}>
                  <Text style={styles.storeName}>Total Tools</Text>
                  <Text style={styles.storeMethod}>AI Estimation</Text>
                </View>
              </View>
              <MaterialCommunityIcons
                name="approximately-equal"
                size={20}
                color="#FF9800"
              />
            </TouchableOpacity>

            {/* Flexihire */}
            <TouchableOpacity
              style={[
                styles.storeRadioOption,
                selectedStore === 'flexihire' && styles.storeRadioOptionSelected
              ]}
              onPress={() => handleStoreSelect('flexihire')}
            >
              <View style={styles.storeRadioLeft}>
                <View style={[
                  styles.radioButton,
                  selectedStore === 'flexihire' && styles.radioButtonSelected
                ]}>
                  {selectedStore === 'flexihire' && (
                    <View style={styles.radioButtonInner} />
                  )}
                </View>
                <View style={styles.storeInfo}>
                  <Text style={styles.storeName}>Flexihire</Text>
                  <Text style={styles.storeMethod}>AI Estimation</Text>
                </View>
              </View>
              <MaterialCommunityIcons
                name="approximately-equal"
                size={20}
                color="#FF9800"
              />
            </TouchableOpacity>

            {/* Sydney Solvents */}
            <TouchableOpacity
              style={[
                styles.storeRadioOption,
                selectedStore === 'sydneysolvents' && styles.storeRadioOptionSelected
              ]}
              onPress={() => handleStoreSelect('sydneysolvents')}
            >
              <View style={styles.storeRadioLeft}>
                <View style={[
                  styles.radioButton,
                  selectedStore === 'sydneysolvents' && styles.radioButtonSelected
                ]}>
                  {selectedStore === 'sydneysolvents' && (
                    <View style={styles.radioButtonInner} />
                  )}
                </View>
                <View style={styles.storeInfo}>
                  <Text style={styles.storeName}>Sydney Solvents</Text>
                  <Text style={styles.storeMethod}>AI Estimation</Text>
                </View>
              </View>
              <MaterialCommunityIcons
                name="approximately-equal"
                size={20}
                color="#FF9800"
              />
            </TouchableOpacity>
          </View>

          <View style={styles.infoBox}>
            <MaterialCommunityIcons name="information" size={20} color={colors.primary} />
            <Text style={styles.infoBoxText}>
              {selectedStore === 'bunnings'
                ? "Bunnings is selected. Real prices will be fetched using the Bunnings web search when available."
                : "Using AI estimation for typical product pricing."
              }
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
                <Button
                  mode="text"
                  onPress={handleDeleteAccount}
                  style={styles.deleteAccountButton}
                  icon="delete-forever"
                  textColor={colors.error}
                >
                  Delete Account
                </Button>
              </View>
            </Surface>
          </>
        )}
        </WebContainer>
      </ScrollView>

      {/* Fixed Save Button */}
      <FixedBottomButton
        mode={'contained'}
        label="Save Settings"
        onPress={handleSave}
        disabled={isLoading}
        loading={isLoading}
        disableSolidBackground={false}
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

        {/* Delete Account Confirmation Dialog */}
        <Dialog
          visible={showDeleteAccountDialog}
          onDismiss={() => setShowDeleteAccountDialog(false)}
          style={styles.logoutDialog}
        >
          <Dialog.Icon icon="delete-forever" />
          <Dialog.Title style={styles.dialogTitle}>Delete Account</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogText}>
              Are you sure you want to permanently delete your account? This action cannot be undone.
            </Text>
            <Text style={[styles.dialogText, { marginTop: 12, fontWeight: '600' }]}>
              All your data will be permanently deleted:
            </Text>
            <Text style={styles.dialogText}>
              • Business settings{'\n'}
              • All quotes and projects{'\n'}
              • Subscription information{'\n'}
              • Account credentials
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setShowDeleteAccountDialog(false)}>Cancel</Button>
            <Button onPress={confirmDeleteAccount} textColor={colors.error}>
              Delete Permanently
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Success Modal */}
      <AlertModal
        visible={showSuccessModal}
        onDismiss={() => setShowSuccessModal(false)}
        type="success"
        title="Settings Saved!"
        message="Your business settings have been saved successfully."
      />

      {/* Error Modal */}
      <AlertModal
        visible={showErrorModal}
        onDismiss={() => setShowErrorModal(false)}
        type="error"
        title="Save Failed"
        message="Failed to save settings. Please try again."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Platform.OS === 'android' ? -48 : 0,
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
    padding: 16,
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
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  switchTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  switchDescription: {
    fontSize: 13,
    color: colors.onSurface,
    lineHeight: 18,
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
    marginBottom: 8,
  },
  deleteAccountButton: {
    alignSelf: 'stretch',
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
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  categoryCard: {
    width: Platform.OS === 'web' ? 'calc(25% - 9px)' as any : '30.5%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 8,
    paddingTop: 12,
    paddingBottom: 12,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.outline + '30',
    height: 120,
    flexDirection: 'column',
  },
  categoryCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primary + '10',
  },
  categoryCheckmark: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 1,
  },
  categoryIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    flexShrink: 0,
  },
  categoryNameContainer: {
    width: '100%',
    paddingHorizontal: 4,
    flexShrink: 1,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  categoryName: {
    fontSize: 10,
    textAlign: 'center',
    color: colors.text,
    lineHeight: 13,
    flexShrink: 1,
  },
  categoryNameSelected: {
    fontWeight: '600',
    color: colors.primary,
  },
  nichePill: {
    marginRight: 0,
    marginBottom: 0,
  },
  nichePillSelected: {
    backgroundColor: colors.primary,
  },
  nichePillTextSelected: {
    color: colors.surface,
    fontWeight: '600',
  },
  storeCategory: {
    marginTop: 16,
    marginBottom: 16,
  },
  storeCategoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  storeCategoryTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
    color: colors.text,
  },
  storeCategoryDescription: {
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 12,
    marginLeft: 28,
  },
  storeRadioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.outline + '30',
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  storeRadioOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  storeRadioOptionDisabled: {
    opacity: 0.5,
    backgroundColor: colors.surface,
  },
  storeRadioLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  radioButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.outline,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioButtonSelected: {
    borderColor: colors.primary,
  },
  radioButtonInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  radioButtonDisabled: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.outline,
  },
  storeInfo: {
    flex: 1,
  },
  storeName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  storeNameDisabled: {
    color: colors.onSurface,
  },
  storeMethod: {
    fontSize: 12,
    color: colors.onSurface,
  },
  comingSoonBadge: {
    backgroundColor: colors.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  comingSoonText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
});
