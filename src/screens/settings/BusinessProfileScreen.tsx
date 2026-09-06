/**
 * Business Profile Settings Screen
 * Business name, logo, ABN, contact details
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  TouchableOpacity,
} from 'react-native';
// Not react-native's: under edge-to-edge Android no longer resizes the window
// for the keyboard, so RN's KeyboardAvoidingView does nothing there — and a
// screen with no wrapper at all is the same bug without the tell-tale. See
// components/keyboardAvoidance.guard.test.ts.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
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

import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useStore } from '../../store/useStore';
import { auth, db } from '../../config/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { geocodeAddress } from '../../utils/travelCalculator';
import { checkSquareConnection } from '../../services/squareService';
import {
  uploadBusinessCredentialLogo,
  uploadBusinessLogo,
  uploadAndProcessBusinessLogo,
  type ProcessedLogoVariants,
} from '../../services/photoService';
import { BrandImageEditor, type BrandImageValue } from '../../components/BrandImageEditor';
import { makeStyles, useThemeColors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { AlertModal } from '../../components/AlertModal';
import { AddressSearchInput } from '../../components/AddressSearchInput';
import { ProBadge } from '../../components/ProBadge';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { generateId } from '../../utils/generateId';
import type { BusinessCredential } from '../../types';
import { GridBackground } from '../../components/GridBackground';

export function BusinessProfileScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const { businessSettings, setBusinessSettings, subscriptionStatus } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [businessName, setBusinessName] = useState('');
  const [abn, setAbn] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [address, setAddress] = useState('');
  const [logoUri, setLogoUri] = useState<string | undefined>(undefined);
  const [logoMimeType, setLogoMimeType] = useState<string | undefined>(undefined);
  // Both processed variants, so the Keep/Remove choice can be flipped later
  // without re-uploading. Populated on upload and from saved settings.
  const [logoVariants, setLogoVariants] = useState<ProcessedLogoVariants | null>(null);
  const [useNoBackground, setUseNoBackground] = useState(false);
  const [credentials, setCredentials] = useState<BusinessCredential[]>([]);
  const [credentialLogoMimeTypes, setCredentialLogoMimeTypes] = useState<Record<string, string | undefined>>({});
  const [brandColor, setBrandColor] = useState<string | undefined>(undefined);
  const [hexInput, setHexInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);

  useEffect(() => {
    if (businessSettings) {
      const name = businessSettings.businessName;
      const a = businessSettings.abn || '';
      const e = businessSettings.email || '';
      const p = businessSettings.phone || '';
      const w = businessSettings.website || '';
      const addr = businessSettings.address || '';
      const logo = businessSettings.logoUri;
      const savedCredentials = (businessSettings.credentials || []).map((credential) => ({
        id: credential.id || generateId(),
        label: String(credential.label || ''),
        number: credential.number ? String(credential.number) : undefined,
        logoUri: credential.logoUri,
        logoOriginalUri: credential.logoOriginalUri,
        logoNoBackgroundUri: credential.logoNoBackgroundUri,
        logoBackground: credential.logoBackground,
        logoUseNoBackground: credential.logoUseNoBackground,
      }));
      const brand = businessSettings.brandColor;

      setBusinessName(name);
      setAbn(a);
      setEmail(e);
      setPhone(p);
      setWebsite(w);
      setAddress(addr);
      setLogoUri(logo);
      setCredentials(savedCredentials);
      setCredentialLogoMimeTypes({});
      setBrandColor(brand);

      const noBg = !!businessSettings.logoUseNoBackground;
      setUseNoBackground(noBg);
      setLogoVariants(
        businessSettings.logoOriginalUri
          ? {
              originalUrl: businessSettings.logoOriginalUri,
              noBackgroundUrl: businessSettings.logoNoBackgroundUri,
              background: businessSettings.logoBackground || 'transparent',
              recommendNoBackground: noBg,
            }
          : null,
      );

      setInitialSnapshot(
        JSON.stringify({ name, a, e, p, w, addr, logo, credentials: savedCredentials, brand, noBg }),
      );
    }
  }, [businessSettings]);

  const isDirty = React.useMemo(() => {
    if (!initialSnapshot) return false;
    const current = JSON.stringify({
      name: businessName,
      a: abn,
      e: email,
      p: phone,
      w: website,
      addr: address,
      logo: logoUri,
      credentials,
      brand: brandColor,
      noBg: useNoBackground,
    });
    return current !== initialSnapshot;
  }, [businessName, abn, email, phone, website, address, logoUri, credentials, brandColor, useNoBackground, initialSnapshot]);

  const { unsavedModalProps } = useUnsavedChangesGuard({
    isDirty,
    onSave: async () => {
      const ok = await handleSave({ silent: true });
      return ok;
    },
  });

  const onColorChange = useCallback((result: ColorFormatsObject) => {
    // Extract the 6-digit hex (strip alpha if present)
    const hex = result.hex.length === 9 ? result.hex.slice(0, 7) : result.hex;
    setBrandColor(hex);
    setHexInput(hex);
  }, []);





  /** Single entry point for everything the logo editor reports back. */
  const handleLogoChange = (next: BrandImageValue) => {
    setLogoUri(next.uri);
    setUseNoBackground(!!next.useNoBackground);
    setLogoVariants(
      next.originalUri
        ? {
            originalUrl: next.originalUri,
            noBackgroundUrl: next.noBackgroundUri,
            background: next.background || 'transparent',
            recommendNoBackground: !!next.useNoBackground,
          }
        : null,
    );
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
          onPress: () => {
            setLogoUri(undefined);
            setLogoMimeType(undefined);
            setLogoVariants(null);
            setUseNoBackground(false);
          },
        },
      ]
    );
  };

  const updateCredential = (id: string, patch: Partial<BusinessCredential>) => {
    setCredentials((current) =>
      current.map((credential) => credential.id === id ? { ...credential, ...patch } : credential),
    );
  };

  const handleAddCredential = () => {
    if (!isPro) {
      navigation.navigate('Paywall' as never, { source: 'business_profile' } as never);
      return;
    }
    if (credentials.length >= 6) {
      Alert.alert('Maximum reached', 'You can show up to six licences or accreditations.');
      return;
    }
    setCredentials((current) => [
      ...current,
      { id: generateId(), label: '', number: '' },
    ]);
  };


  const uploadLogoToStorage = async (uri: string, mimeType?: string): Promise<string> => {
    const userId = auth.currentUser?.uid;
    if (!userId) throw new Error('Not signed in');
    return uploadBusinessLogo(userId, uri, mimeType);
  };

  const handleSave = async (opts?: { silent?: boolean }): Promise<boolean> => {
    if (!businessName.trim()) {
      Alert.alert('Required', 'Please enter your business name');
      return false;
    }

    try {
      setIsLoading(true);

      // Upload logo to Firebase Storage if it's a local/blob URI
      let savedLogoUri = logoUri;
      if (logoUri) {
        try {
          savedLogoUri = await uploadLogoToStorage(logoUri, logoMimeType);
          setLogoUri(savedLogoUri);
        } catch (error: any) {
          console.error('[BusinessProfile] Logo upload failed:', error);
          const reason = error?.code || error?.message || 'Unknown error';
          Alert.alert('Logo Upload Failed', `Could not upload logo (${reason}). Other settings will still be saved.`);
          savedLogoUri = undefined;
        }
      }

      const userId = auth.currentUser?.uid;
      const credentialsToSave = credentials.filter(
        (credential) => credential.label.trim() || credential.number?.trim() || credential.logoUri,
      );
      const savedCredentials: BusinessCredential[] = [];
      for (const credential of credentialsToSave) {
        let savedCredentialLogoUri = credential.logoUri;
        if (savedCredentialLogoUri && !savedCredentialLogoUri.startsWith('https://')) {
          if (!userId) throw new Error('Not signed in');
          try {
            savedCredentialLogoUri = await uploadBusinessCredentialLogo(
              userId,
              credential.id,
              savedCredentialLogoUri,
              credentialLogoMimeTypes[credential.id],
            );
          } catch (error: any) {
            console.error('[BusinessProfile] Credential logo upload failed:', error);
            const reason = error?.code || error?.message || 'Unknown error';
            Alert.alert(
              'Accreditation Logo Upload Failed',
              `Could not upload the badge (${reason}). Please try again.`,
            );
            return false;
          }
        }
        savedCredentials.push({
          id: credential.id,
          label: credential.label.trim(),
          number: credential.number?.trim() || undefined,
          logoUri: savedCredentialLogoUri,
          logoOriginalUri: credential.logoOriginalUri,
          logoNoBackgroundUri: credential.logoNoBackgroundUri,
          logoBackground: credential.logoBackground,
          logoUseNoBackground: credential.logoUseNoBackground,
        });
      }

      await setBusinessSettings({
        ...businessSettings!,
        businessName: businessName.trim(),
        abn: abn.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        website: website.trim() || undefined,
        address: address.trim() || undefined,
        logoUri: savedLogoUri,
        // Keep both variants so the Keep/Remove choice stays reversible without
        // making the tradie upload the file again.
        logoOriginalUri: logoVariants?.originalUrl,
        logoNoBackgroundUri: logoVariants?.noBackgroundUrl,
        logoBackground: logoVariants?.background,
        logoUseNoBackground: useNoBackground,
        credentials: savedCredentials,
        brandColor: brandColor,
      });

      // Geocode address and store location for distance sorting in supplier discovery
      if (address.trim() && auth.currentUser) {
        geocodeAddress(address.trim()).then((loc) => {
          if (loc) {
            updateDoc(doc(db, `users/${auth.currentUser!.uid}`), {
              location: { lat: loc.lat, lng: loc.lng },
            }).catch((err) => {
              console.warn('Failed to store geocoded location:', err.message);
            });
          }
        });
      }

      // The store update triggers the hydration useEffect to re-derive form
      // state from the new businessSettings and refresh initialSnapshot.
      // Refreshing the snapshot here with closure values would race with the
      // useEffect's normalized re-derive and leave isDirty stuck true.

      if (!opts?.silent) {
        setShowSuccessModal(true);
      }
      return true;
    } catch (error) {
      setShowErrorModal(true);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <GridBackground />
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
              label="Website"
              value={website}
              onChangeText={setWebsite}
              mode="outlined"
              style={styles.input}
              keyboardType="url"
              autoCapitalize="none"
              placeholder="https://"
            />

            <AddressSearchInput
              label="Business Address"
              placeholder="Start typing your business address"
              value={address}
              onChangeText={setAddress}
              style={styles.input}
            />
          </Surface>

          <Surface style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Title style={styles.sectionTitle}>Company Logo</Title>
              {!isPro && <ProBadge size="small" />}
            </View>
            <Text style={styles.helperText}>
              {isPro ? 'This appears on quote, invoice and service report PDFs' : 'Upgrade to Pro to add your logo to PDFs'}
            </Text>

            <BrandImageEditor
              value={{
                uri: logoUri,
                originalUri: logoVariants?.originalUrl,
                noBackgroundUri: logoVariants?.noBackgroundUrl,
                background: logoVariants?.background,
                useNoBackground,
              }}
              onChange={handleLogoChange}
              userId={auth.currentUser?.uid}
              folder="logo-uploads"
              emptyTitle={isPro ? 'Tap to upload your logo' : 'Pro Feature'}
              // Not "500x500 square": a square canvas is what makes a wide
              // wordmark print tiny, because the empty margins scale with the
              // artwork. Crop tight and any shape works.
              emptyHint="PNG or JPG, cropped close to the artwork"
              locked={!isPro}
              onLockedPress={() => navigation.navigate('Paywall' as never, { source: 'business_profile' } as never)}
            />
          </Surface>

          <Surface style={styles.card}>
            <View style={styles.sectionHeadingRow}>
              <Title style={[styles.sectionTitle, styles.sectionHeadingTitle]}>Licences &amp; accreditations</Title>
              {!isPro && <ProBadge size="small" />}
            </View>
            <Text style={styles.helperText}>
              Add licence numbers and optional badges once. They appear as a compact banner on quotes, invoices and service reports.
            </Text>

            {credentials.map((credential, index) => (
              <View key={credential.id} style={styles.credentialCard}>
                <View style={styles.credentialHeader}>
                  <Text style={styles.credentialHeading}>
                    {credential.label.trim() || `Credential ${index + 1}`}
                  </Text>
                  <IconButton
                    icon="delete-outline"
                    iconColor={themeColors.error}
                    size={21}
                    onPress={() => {
                      setCredentials((current) => current.filter((item) => item.id !== credential.id));
                      setCredentialLogoMimeTypes((current) => {
                        const next = { ...current };
                        delete next[credential.id];
                        return next;
                      });
                    }}
                  />
                </View>

                {/* Same editor as the company logo: an ARC badge is a brand
                    image on the same documents and deserves the same crop,
                    background handling and on-paper preview. */}
                <BrandImageEditor
                  value={{
                    uri: credential.logoUri,
                    originalUri: credential.logoOriginalUri,
                    noBackgroundUri: credential.logoNoBackgroundUri,
                    background: credential.logoBackground,
                    useNoBackground: credential.logoUseNoBackground,
                  }}
                  onChange={(next) =>
                    updateCredential(credential.id, {
                      logoUri: next.uri,
                      logoOriginalUri: next.originalUri,
                      logoNoBackgroundUri: next.noBackgroundUri,
                      logoBackground: next.background,
                      logoUseNoBackground: next.useNoBackground,
                    })
                  }
                  userId={auth.currentUser?.uid}
                  folder="credential-uploads"
                  emptyTitle="Add badge or logo"
                  emptyHint="Optional — e.g. your ARC or licence badge"
                />

                <TextInput
                  label="Name"
                  placeholder="e.g. ARC Authorisation"
                  value={credential.label}
                  onChangeText={(label) => updateCredential(credential.id, { label })}
                  mode="outlined"
                  style={styles.credentialInput}
                />
                <TextInput
                  label="Licence or authorisation number"
                  placeholder="e.g. AU12345"
                  value={credential.number || ''}
                  onChangeText={(number) => updateCredential(credential.id, { number })}
                  mode="outlined"
                  style={styles.credentialInput}
                />
              </View>
            ))}

            <Button
              mode="outlined"
              icon={isPro ? 'plus' : 'lock-outline'}
              onPress={handleAddCredential}
              disabled={isPro && credentials.length >= 6}
            >
              Add licence or accreditation
            </Button>
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
                  <MaterialCommunityIcons name="palette" size={20} color={themeColors.alwaysLight} />
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
                  <MaterialCommunityIcons name="close-circle" size={22} color={themeColors.alwaysLight} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.colorBannerEmpty}>
                <MaterialCommunityIcons name="palette-outline" size={20} color={themeColors.textSecondary} />
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
                { backgroundColor: hexInput && /^#[0-9A-Fa-f]{6}$/.test(hexInput) ? hexInput : (brandColor || themeColors.borderStrong) },
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
                mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent}
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
        onPress={() => handleSave()}
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

      <AlertModal {...unsavedModalProps} />
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
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
    backgroundColor: t.colors.surfaceRaised,
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
    color: t.colors.textSecondary,
    marginBottom: 16,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionHeadingTitle: {
    marginBottom: 0,
  },
  credentialCard: {
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    backgroundColor: t.colors.surfaceOverlay,
  },
  credentialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 36,
  },
  credentialHeading: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.textSecondary,
  },
  credentialInput: {
    marginBottom: 10,
    backgroundColor: t.colors.surfaceRaised,
  },
  credentialLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  credentialLogo: {
    width: 72,
    height: 44,
    borderRadius: 6,
    backgroundColor: t.colors.surfaceRaised,
  },
  logoUploadBox: {
    borderWidth: 2,
    borderColor: t.colors.accent,
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.surfaceRaised,
  },
  logoUploadText: {
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.accentText,
    marginTop: 12,
  },
  logoUploadHint: {
    fontSize: 12,
    color: t.colors.textSecondary,
    marginTop: 4,
  },
  logoPreview: {
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    borderRadius: 8,
    padding: 16,
    backgroundColor: t.colors.surfaceOverlay,
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
    color: t.colors.alwaysLight,
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
    borderColor: t.colors.borderStrong,
    borderStyle: 'dashed',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  colorBannerEmptyText: {
    fontSize: 13,
    color: t.colors.textSecondary,
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
    borderColor: t.colors.borderStrong,
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
    color: t.colors.textSecondary,
  },
  toggleDescription: {
    fontSize: 13,
    color: t.colors.textMuted,
    marginTop: 2,
  },
}));
