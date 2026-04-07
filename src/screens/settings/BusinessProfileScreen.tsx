/**
 * Business Profile Settings Screen
 * Business name, logo, ABN, contact details
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  Image,
  Alert,
  TouchableOpacity,
} from 'react-native';
import {
  Text,
  TextInput,
  Surface,
  Title,
  IconButton,
  Button,
  Switch,
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import ColorPicker, { Panel1, HueSlider, type ColorFormatsObject } from 'reanimated-color-picker';

import { useNavigation } from '@react-navigation/native';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useStore } from '../../store/useStore';
import { auth, storage } from '../../config/firebase';
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { AlertModal } from '../../components/AlertModal';
import { ProBadge } from '../../components/ProBadge';

export function BusinessProfileScreen() {
  const navigation = useNavigation<any>();
  const { businessSettings, setBusinessSettings, subscriptionStatus } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [businessName, setBusinessName] = useState('');
  const [abn, setAbn] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoUri, setLogoUri] = useState<string | undefined>(undefined);
  const [brandColor, setBrandColor] = useState<string | undefined>(undefined);
  const [hexInput, setHexInput] = useState('');
  const [laborRate, setLaborRate] = useState('85');
  const [markup, setMarkup] = useState('20');
  const [laborMarkup, setLaborMarkup] = useState('20');
  const [transportMarkupEnabled, setTransportMarkupEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);

  useEffect(() => {
    if (businessSettings) {
      setBusinessName(businessSettings.businessName);
      setAbn(businessSettings.abn || '');
      setEmail(businessSettings.email || '');
      setPhone(businessSettings.phone || '');
      setAddress(businessSettings.address || '');
      setLogoUri(businessSettings.logoUri);
      setBrandColor(businessSettings.brandColor);
      setLaborRate(businessSettings.defaultLaborRate?.toString() || '85');
      setMarkup(businessSettings.defaultMarkup?.toString() || '20');
      setLaborMarkup(
        (businessSettings.defaultLaborMarkup ?? businessSettings.defaultMarkup ?? 20).toString()
      );
      setTransportMarkupEnabled(businessSettings.transportMarkupEnabled !== false);
    }
  }, [businessSettings]);

  const onColorChange = useCallback((result: ColorFormatsObject) => {
    // Extract the 6-digit hex (strip alpha if present)
    const hex = result.hex.length === 9 ? result.hex.slice(0, 7) : result.hex;
    setBrandColor(hex);
    setHexInput(hex);
  }, []);

  const handlePickLogo = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (permissionResult.granted === false) {
        Alert.alert('Permission Required', 'Permission to access camera roll is required!');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setLogoUri(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image. Please try again.');
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

  const uploadLogoToStorage = async (uri: string): Promise<string> => {
    // Already a remote URL (previously uploaded), no need to re-upload
    if (uri.startsWith('https://')) return uri;

    const userId = auth.currentUser?.uid;
    if (!userId) throw new Error('Not signed in');

    const response = await fetch(uri);
    const blob = await response.blob();
    const logoRef = ref(storage, `users/${userId}/logo.jpg`);
    await uploadBytes(logoRef, blob);
    return getDownloadURL(logoRef);
  };

  const handleSave = async () => {
    if (!businessName.trim()) {
      Alert.alert('Required', 'Please enter your business name');
      return;
    }

    try {
      setIsLoading(true);

      // Upload logo to Firebase Storage if it's a local/blob URI
      let savedLogoUri = logoUri;
      if (logoUri) {
        try {
          savedLogoUri = await uploadLogoToStorage(logoUri);
          setLogoUri(savedLogoUri);
        } catch (error) {
          Alert.alert('Logo Upload Failed', 'Could not upload logo. Other settings will still be saved.');
          savedLogoUri = undefined;
        }
      }

      await setBusinessSettings({
        ...businessSettings!,
        businessName: businessName.trim(),
        abn: abn.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        logoUri: savedLogoUri,
        brandColor: brandColor,
        defaultLaborRate: parseFloat(laborRate) || 85,
        defaultMarkup: parseFloat(markup) || 20,
        defaultLaborMarkup: parseFloat(laborMarkup) || 0,
        transportMarkupEnabled,
      });
      setShowSuccessModal(true);
    } catch (error) {
      setShowErrorModal(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <WebContainer>
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Business Details</Title>

            <TextInput
              label="Business Name *"
              value={businessName}
              onChangeText={setBusinessName}
              mode="outlined"
              style={styles.input}
            />

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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Title style={styles.sectionTitle}>Company Logo</Title>
              {!isPro && <ProBadge size="small" />}
            </View>
            <Text style={styles.helperText}>
              {isPro ? 'This will appear on your PDF quotes and invoices' : 'Upgrade to Pro to add your logo to PDFs'}
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
              <TouchableOpacity style={styles.logoUploadBox} onPress={() => {
                if (!isPro) {
                  navigation.navigate('Paywall' as never);
                  return;
                }
                handlePickLogo();
              }}>
                <MaterialCommunityIcons
                  name={isPro ? 'image-plus' : 'lock-outline'}
                  size={48}
                  color={isPro ? colors.primary : colors.textMuted}
                />
                <Text style={styles.logoUploadText}>{isPro ? 'Tap to Upload Logo' : 'Pro Feature'}</Text>
                <Text style={styles.logoUploadHint}>Recommended: 500x500px (Square)</Text>
              </TouchableOpacity>
            )}
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
              label="Material Markup"
              value={markup}
              onChangeText={setMarkup}
              mode="outlined"
              style={styles.input}
              keyboardType="decimal-pad"
              right={<TextInput.Affix text="%" />}
            />

            <TextInput
              label="Labour Markup"
              value={laborMarkup}
              onChangeText={setLaborMarkup}
              mode="outlined"
              style={styles.input}
              keyboardType="decimal-pad"
              right={<TextInput.Affix text="%" />}
            />

            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <Text style={styles.toggleTitle}>Transport / Logistics Markup</Text>
                <Text style={styles.toggleDescription}>
                  Auto-calculate travel markup based on job distance
                </Text>
              </View>
              <Switch
                value={transportMarkupEnabled}
                onValueChange={setTransportMarkupEnabled}
                color={colors.primary}
              />
            </View>
          </Surface>

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Brand Colour</Title>
            <Text style={styles.helperText}>
              Override the default accent colour on your PDF templates
            </Text>

            {/* Active colour preview banner */}
            {brandColor ? (
              <View style={[styles.colorBanner, { backgroundColor: brandColor }]}>
                <View style={styles.colorBannerInner}>
                  <MaterialCommunityIcons name="palette" size={20} color="#FFFFFF" />
                  <Text style={styles.colorBannerText}>{brandColor.toUpperCase()}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setBrandColor(undefined);
                    setHexInput('');
                  }}
                  style={styles.colorBannerClear}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <MaterialCommunityIcons name="close-circle" size={22} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.colorBannerEmpty}>
                <MaterialCommunityIcons name="palette-outline" size={20} color={colors.onSurface} />
                <Text style={styles.colorBannerEmptyText}>No custom colour — using template default</Text>
              </View>
            )}

            {/* Colour picker */}
            <View style={styles.pickerContainer}>
              <ColorPicker
                value={brandColor || '#059669'}
                onCompleteJS={onColorChange}
                style={styles.picker}
              >
                <Panel1 style={styles.pickerPanel} />
                <HueSlider style={styles.pickerHueSlider} />
              </ColorPicker>
            </View>

            {/* Hex input for exact values */}
            <View style={styles.hexRow}>
              <View style={[
                styles.hexPreview,
                { backgroundColor: hexInput && /^#[0-9A-Fa-f]{6}$/.test(hexInput) ? hexInput : (brandColor || colors.outline) },
              ]} />
              <TextInput
                mode="outlined"
                label="Hex"
                value={hexInput}
                onChangeText={(text) => {
                  const cleaned = text.startsWith('#') ? text : `#${text}`;
                  setHexInput(cleaned.slice(0, 7));
                }}
                placeholder="#059669"
                style={styles.hexInput}
                autoCapitalize="characters"
                maxLength={7}
                dense
              />
              <Button
                mode="contained"
                onPress={() => {
                  if (/^#[0-9A-Fa-f]{6}$/.test(hexInput)) {
                    setBrandColor(hexInput);
                  } else {
                    Alert.alert('Invalid Colour', 'Enter a valid hex colour (e.g. #3B82F6)');
                  }
                }}
                disabled={!/^#[0-9A-Fa-f]{6}$/.test(hexInput)}
                compact
                style={styles.hexApply}
              >
                Apply
              </Button>
            </View>
          </Surface>
        </WebContainer>
      </ScrollView>

      <FixedBottomButton
        mode="contained"
        label="Save"
        onPress={handleSave}
        disabled={isLoading}
        loading={isLoading}
      />

      <AlertModal
        visible={showSuccessModal}
        onDismiss={() => setShowSuccessModal(false)}
        type="success"
        title="Saved!"
        message="Your business details have been updated."
      />

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
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  input: {
    marginBottom: 16,
  },
  helperText: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 16,
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
  colorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  colorBannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  colorBannerText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  colorBannerClear: {
    padding: 2,
  },
  colorBannerEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.outline,
    borderStyle: 'dashed',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  colorBannerEmptyText: {
    fontSize: 13,
    color: colors.onSurface,
    fontStyle: 'italic',
  },
  pickerContainer: {
    marginBottom: 16,
  },
  picker: {
    gap: 12,
  },
  pickerPanel: {
    height: 180,
    borderRadius: 10,
  },
  pickerHueSlider: {
    height: 36,
    borderRadius: 18,
  },
  hexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hexPreview: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  hexInput: {
    flex: 1,
    fontSize: 14,
  },
  hexApply: {
    alignSelf: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  toggleLabel: {
    flex: 1,
    marginRight: 12,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSurface,
  },
  toggleDescription: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
});
