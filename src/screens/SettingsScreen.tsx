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
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import { BusinessSettings } from '../types';
import { colors } from '../theme';
import { WebContainer } from '../components/WebContainer';

export function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { businessSettings, setBusinessSettings, subscriptionStatus } = useStore();

  const [businessName, setBusinessName] = useState('');
  const [abn, setAbn] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoUri, setLogoUri] = useState<string | undefined>(undefined);
  const [laborRate, setLaborRate] = useState('85');
  const [markup, setMarkup] = useState('20');
  const [useBunningsApi, setUseBunningsApi] = useState(false);
  const [store1, setStore1] = useState('https://www.bunnings.com.au/');
  const [store2, setStore2] = useState('');
  const [store3, setStore3] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
      setUseBunningsApi(businessSettings.useBunningsApi === true); // Default to false
      const stores = businessSettings.hardwareStores || ['https://www.bunnings.com.au/'];
      setStore1(stores[0] || 'https://www.bunnings.com.au/');
      setStore2(stores[1] || '');
      setStore3(stores[2] || '');
    }
  }, [businessSettings]);

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

  const handleSave = async () => {
    if (!businessName.trim()) {
      alert('Please enter your business name');
      return;
    }

    // Collect hardware stores (only non-empty URLs)
    const hardwareStores = [store1, store2, store3]
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (!useBunningsApi && hardwareStores.length === 0) {
      alert('Please add at least one hardware store URL when using AI price estimation');
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
      useBunningsApi: useBunningsApi,
      hardwareStores: hardwareStores.length > 0 ? hardwareStores : undefined,
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
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

        <Surface style={styles.card}>
          <Title style={styles.sectionTitle}>Price Fetching Method</Title>
          <Text style={styles.helperText}>
            Choose how to fetch material prices
          </Text>

          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <Text style={styles.switchTitle}>Use Bunnings API</Text>
              <Text style={styles.switchSubtitle}>
                {useBunningsApi ? 'Live prices from Bunnings' : 'AI price estimates'}
              </Text>
            </View>
            <Switch
              value={useBunningsApi}
              onValueChange={setUseBunningsApi}
              color={colors.primary}
            />
          </View>

          {!useBunningsApi && (
            <>
              <Divider style={styles.smallDivider} />
              <Text style={styles.helperText}>
                When AI estimation is enabled, Claude will estimate typical hardware store prices based on training data. For accurate real-time prices, use the Bunnings API.
              </Text>

              <TextInput
                label="Hardware Store 1 *"
                value={store1}
                onChangeText={setStore1}
                mode="outlined"
                style={styles.input}
                keyboardType="url"
                autoCapitalize="none"
                placeholder="https://www.bunnings.com.au/"
              />

              <TextInput
                label="Hardware Store 2 (Optional)"
                value={store2}
                onChangeText={setStore2}
                mode="outlined"
                style={styles.input}
                keyboardType="url"
                autoCapitalize="none"
                placeholder="https://www.mitre10.com.au/"
              />

              <TextInput
                label="Hardware Store 3 (Optional)"
                value={store3}
                onChangeText={setStore3}
                mode="outlined"
                style={styles.input}
                keyboardType="url"
                autoCapitalize="none"
                placeholder="https://www.totaltools.com.au/"
              />

              <View style={styles.infoBox}>
                <MaterialCommunityIcons name="information" size={20} color={colors.primary} />
                <Text style={styles.infoBoxText}>
                  AI estimation uses Claude's knowledge to provide price estimates based on typical Australian hardware store pricing. Store URLs are used for context only. For exact current prices, enable the Bunnings API option.
                </Text>
              </View>
            </>
          )}
        </Surface>

        <Divider style={styles.divider} />

        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>About QuoteMate</Text>
          <Text style={styles.infoText}>Version 1.0.0</Text>
          <Text style={styles.infoText}>
            Quoting tool for Australian tradies with AI and Bunnings integration
          </Text>
        </View>

        <Button
          mode="contained"
          onPress={handleSave}
          style={styles.button}
          loading={isLoading}
          disabled={isLoading}
        >
          Save Settings
        </Button>
        </WebContainer>
      </ScrollView>
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
    paddingBottom: 220,
    flexGrow: 1,
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
    marginBottom: 80,
    paddingVertical: 8,
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
});
