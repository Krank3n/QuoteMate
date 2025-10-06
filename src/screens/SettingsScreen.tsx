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
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { useStore } from '../store/useStore';
import { BusinessSettings } from '../types';
import { colors } from '../theme';

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
        aspect: [16, 9], // Wide logo format
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

    const settings: BusinessSettings = {
      businessName: businessName.trim(),
      abn: abn.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      address: address.trim() || undefined,
      logoUri: logoUri,
      defaultLaborRate: parseFloat(laborRate) || 85,
      defaultMarkup: parseFloat(markup) || 20,
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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
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
                <Text style={styles.logoUploadHint}>Recommended: 800x200px</Text>
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
          <Title style={styles.sectionTitle}>Subscription</Title>

          <View style={styles.subscriptionInfo}>
            {subscriptionStatus?.isPro ? (
              <>
                <View style={styles.proBadge}>
                  <MaterialCommunityIcons name="crown" size={24} color={colors.secondary} />
                  <Text style={styles.proText}>Pro Member</Text>
                </View>
                <Text style={styles.helperText}>
                  You have unlimited quote analyses. Thank you for your support!
                </Text>
              </>
            ) : (
              <>
                <View style={styles.quotaInfo}>
                  <Text style={styles.quotaText}>
                    Free Plan: {subscriptionStatus?.quotesThisMonth || 0} of {subscriptionStatus?.freeQuotesLimit || 5} quote analyses used this month
                  </Text>
                </View>
                <Button
                  mode="contained"
                  onPress={() => navigation.navigate('Paywall' as never)}
                  style={styles.upgradeButtonSmall}
                  icon="crown"
                >
                  Upgrade to Pro - $19/month
                </Button>
                <Text style={styles.upgradeHint}>
                  Get unlimited quote analyses, priority support, and more
                </Text>
              </>
            )}
          </View>
        </Surface>

        <Divider style={styles.divider} />

        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>About QuoteMate</Text>
          <Text style={styles.infoText}>Version 1.0.0</Text>
          <Text style={styles.infoText}>
            Quoting tool for Australian tradies with Bunnings Sandbox API integration
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
  },
  card: {
    padding: 16,
    marginBottom: 20,
    borderRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  input: {
    marginBottom: 12,
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
    backgroundColor: '#fff',
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
    backgroundColor: '#FFF3E0',
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
  upgradeButtonSmall: {
    marginBottom: 8,
  },
  upgradeHint: {
    fontSize: 12,
    color: colors.onSurface,
    textAlign: 'center',
  },
});
