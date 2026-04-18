/**
 * New Onboarding Screen - 6-Step Flow
 *
 * Steps:
 * 1. Company Name
 * 2. Trade Category (multi-select)
 * 3. Contact Details (skippable)
 * 4. Branding - logo + brand colour (skippable)
 * 5. Rates (skippable)
 * 6. Payments - Square connection (skippable)
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
  Animated,
  Dimensions,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Text,
  TextInput,
  Button,
  Surface,
  Title,
  Paragraph,
  IconButton,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import ColorPicker, { Panel1, HueSlider, type ColorFormatsObject } from 'reanimated-color-picker';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

import { useStore } from '../store/useStore';
import { BusinessSettings } from '../types';
import { colors } from '../theme';
import { OnboardingProgress, OnboardingStep } from '../components/OnboardingProgress';
import { CelebrationAnimation } from '../components/CelebrationAnimation';
import { TRADE_CATEGORIES } from '../constants/tradeCategories';
import { auth, storage } from '../config/firebase';
import * as squareService from '../services/squareService';

const { width } = Dimensions.get('window');

const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: 1, label: 'Company', icon: 'office-building' },
  { id: 2, label: 'Trade', icon: 'hammer-wrench' },
  { id: 3, label: 'Contact', icon: 'card-account-details' },
  { id: 4, label: 'Branding', icon: 'palette' },
  { id: 5, label: 'Rates', icon: 'currency-usd' },
  { id: 6, label: 'Payments', icon: 'credit-card-outline' },
];

const TOTAL_STEPS = ONBOARDING_STEPS.length;

export function NewOnboardingScreen() {
  const { setBusinessSettings, setOnboarded } = useStore();
  const insets = useSafeAreaInsets();

  // Current step
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Step 1: Company Name
  const [businessName, setBusinessName] = useState('');

  // Step 2: Trade Category (multi-select)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Step 3: Contact Details
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(auth.currentUser?.email || '');
  const [abn, setAbn] = useState('');

  // Step 4: Branding
  const [logoUri, setLogoUri] = useState<string | undefined>(undefined);
  const [brandColor, setBrandColor] = useState<string | undefined>(undefined);
  const [hexInput, setHexInput] = useState('');

  // Step 5: Rates
  const [laborRate, setLaborRate] = useState('85');
  const [markup, setMarkup] = useState('20');

  // Step 6: Payments (Square)
  const [squareConnecting, setSquareConnecting] = useState(false);
  const [squareConnected, setSquareConnected] = useState(false);
  const [squareError, setSquareError] = useState<string | null>(null);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  // Animate step transitions
  useEffect(() => {
    fadeAnim.setValue(0);
    slideAnim.setValue(50);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, [currentStep]);

  // Handle next step
  const handleNext = () => {
    if (currentStep === 1) {
      if (!businessName.trim()) {
        Alert.alert('Required', 'Please enter your business name');
        return;
      }
    } else if (currentStep === 2) {
      if (selectedCategories.length === 0) {
        Alert.alert('Required', 'Please select at least one trade category');
        return;
      }
    }

    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  // Handle back
  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Handle skip — allowed on any step >= 3. Moves to the next step,
  // except on the final step which completes onboarding.
  const handleSkip = () => {
    if (currentStep < 3) return;
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  // Handle category toggle (multi-select)
  const handleCategoryToggle = (categoryId: string) => {
    setSelectedCategories(prev => {
      if (prev.includes(categoryId)) {
        return prev.filter(c => c !== categoryId);
      } else {
        return [...prev, categoryId];
      }
    });
  };

  // Logo picker (ported from BusinessProfileScreen)
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

  // Upload logo to Firebase Storage (ported from BusinessProfileScreen)
  const uploadLogoToStorage = async (uri: string): Promise<string> => {
    if (uri.startsWith('https://')) return uri;

    const userId = auth.currentUser?.uid;
    if (!userId) throw new Error('Not signed in');

    const blob: Blob = await new Promise((resolve, reject) => {
      if (Platform.OS === 'web') {
        fetch(uri).then(r => r.blob()).then(resolve).catch(reject);
        return;
      }
      const xhr = new XMLHttpRequest();
      xhr.onload = () => resolve(xhr.response);
      xhr.onerror = () => reject(new Error('Failed to read image file'));
      xhr.responseType = 'blob';
      xhr.open('GET', uri, true);
      xhr.send(null);
    });

    const logoRef = ref(storage, `users/${userId}/logo.jpg`);
    await uploadBytes(logoRef, blob, { contentType: 'image/jpeg' });
    return getDownloadURL(logoRef);
  };

  // Brand colour handler
  const onColorChange = useCallback((result: ColorFormatsObject) => {
    const hex = result.hex.length === 9 ? result.hex.slice(0, 7) : result.hex;
    setBrandColor(hex);
    setHexInput(hex);
  }, []);

  // Square OAuth flow (ported from SquareIntegrationScreen)
  const handleConnectSquare = async () => {
    setSquareError(null);
    setSquareConnecting(true);
    try {
      const { authUrl } = await squareService.getSquareAuthUrl();
      await WebBrowser.openBrowserAsync(authUrl, {
        dismissButtonStyle: 'done',
      });
      // Poll for up to ~10s at 1s intervals while the backend finishes the
      // OAuth code→token exchange.
      const deadline = Date.now() + 10000;
      let connected = false;
      while (Date.now() < deadline) {
        try {
          const status = await squareService.checkSquareConnection();
          if (status.connected) {
            connected = true;
            break;
          }
        } catch {
          // Ignore transient errors and keep polling.
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (connected) {
        setSquareConnected(true);
      } else {
        setSquareError(
          "We couldn't confirm the Square connection. You can try again or skip for now."
        );
      }
    } catch (error: any) {
      setSquareError(
        error?.message || 'Could not start Square connection. Please try again.'
      );
    } finally {
      setSquareConnecting(false);
    }
  };

  // Handle complete — writes only the fields the user filled in.
  const handleComplete = async () => {
    try {
      setIsLoading(true);

      // Upload logo to Firebase Storage if it's a local/blob URI.
      // Fall back to undefined if upload fails — do NOT block onboarding.
      let savedLogoUri: string | undefined = logoUri;
      if (logoUri) {
        try {
          savedLogoUri = await uploadLogoToStorage(logoUri);
        } catch (error: any) {
          console.error('[Onboarding] Logo upload failed:', error);
          savedLogoUri = undefined;
        }
      }

      const settings: BusinessSettings = {
        businessName: businessName.trim(),
        defaultLaborRate: parseFloat(laborRate) || 85,
        defaultMarkup: parseFloat(markup) || 20,
      };

      if (phone.trim()) settings.phone = phone.trim();
      if (email.trim()) settings.email = email.trim();
      if (abn.trim()) settings.abn = abn.trim();
      if (savedLogoUri) settings.logoUri = savedLogoUri;
      if (brandColor) settings.brandColor = brandColor;
      if (selectedCategories.length > 0) settings.tradeCategories = selectedCategories;

      await setBusinessSettings(settings);
      setIsLoading(false);

      // Show success animation
      setShowSuccess(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to save settings. Please try again.');
      setIsLoading(false);
    }
  };

  // Handle success completion
  const handleSuccessComplete = async () => {
    setShowSuccess(false);
    await setOnboarded(true);
  };

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return renderStep1CompanyName();
      case 2:
        return renderStep2TradeCategory();
      case 3:
        return renderStep3Contact();
      case 4:
        return renderStep4Branding();
      case 5:
        return renderStep5Rates();
      case 6:
        return renderStep6Payments();
      default:
        return null;
    }
  };

  // Step 1: Company Name
  const renderStep1CompanyName = () => (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <MaterialCommunityIcons
          name="office-building"
          size={64}
          color={colors.primary}
          style={styles.stepIcon}
        />
        <Title style={styles.stepTitle}>What's your company name?</Title>
        <Paragraph style={styles.stepDescription}>
          This will appear on all your quotes and invoices
        </Paragraph>
      </View>

      <Surface style={styles.card}>
        <TextInput
          label="Business Name"
          value={businessName}
          onChangeText={setBusinessName}
          mode="outlined"
          style={styles.input}
          placeholder="e.g., Smith's Plumbing"
          autoFocus
          onSubmitEditing={handleNext}
          autoComplete="off"
          textContentType="organizationName"
        />
      </Surface>
    </View>
  );

  // Step 2: Trade Category
  const renderStep2TradeCategory = () => (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <MaterialCommunityIcons
          name="hammer-wrench"
          size={64}
          color={colors.primary}
          style={styles.stepIcon}
        />
        <Title style={styles.stepTitle}>What's your trade?</Title>
        <Paragraph style={styles.stepDescription}>
          Select all categories that apply (you can choose multiple)
        </Paragraph>
      </View>

      <ScrollView style={styles.scrollableContent}>
        <View style={styles.gridContainer}>
          {TRADE_CATEGORIES.map((category) => {
            const isSelected = selectedCategories.includes(category.id);
            return (
              <TouchableOpacity
                key={category.id}
                onPress={() => handleCategoryToggle(category.id)}
                style={[
                  styles.categoryCard,
                  isSelected && styles.categoryCardSelected,
                ]}
              >
                <View
                  style={[
                    styles.categoryIconContainer,
                    { backgroundColor: category.color + '20' },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={category.icon as any}
                    size={32}
                    color={category.color}
                  />
                </View>
                <Text style={styles.categoryName}>{category.name}</Text>
                <Text style={styles.categoryDescription}>{category.description}</Text>
                {isSelected && (
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={24}
                    color={colors.success}
                    style={styles.categoryCheck}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );

  // Step 3: Contact Details
  const renderStep3Contact = () => (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <MaterialCommunityIcons
          name="card-account-details"
          size={64}
          color={colors.primary}
          style={styles.stepIcon}
        />
        <Title style={styles.stepTitle}>How can customers reach you?</Title>
        <Paragraph style={styles.stepDescription}>
          This appears on your quotes and invoices
        </Paragraph>
      </View>

      <Surface style={styles.card}>
        <TextInput
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          mode="outlined"
          style={styles.input}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
        />

        <TextInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          mode="outlined"
          style={styles.input}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoCapitalize="none"
          autoComplete="email"
        />

        <TextInput
          label="ABN"
          value={abn}
          onChangeText={setAbn}
          mode="outlined"
          style={styles.input}
          keyboardType="number-pad"
          autoComplete="off"
        />
        <Text style={styles.helperText}>Used on tax invoices</Text>
      </Surface>
    </View>
  );

  // Step 4: Branding
  const renderStep4Branding = () => (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <MaterialCommunityIcons
          name="palette"
          size={64}
          color={colors.primary}
          style={styles.stepIcon}
        />
        <Title style={styles.stepTitle}>Make your quotes yours</Title>
        <Paragraph style={styles.stepDescription}>
          Your logo and brand colour appear on every PDF
        </Paragraph>
      </View>

      <Surface style={styles.card}>
        <Title style={styles.cardTitle}>Company Logo</Title>
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
            <Text style={styles.logoUploadHint}>Recommended: 500x500px (square)</Text>
          </TouchableOpacity>
        )}
      </Surface>

      <Surface style={styles.card}>
        <Title style={styles.cardTitle}>Brand Colour</Title>

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

        <View style={styles.hexRow}>
          <View
            style={[
              styles.hexPreview,
              {
                backgroundColor:
                  hexInput && /^#[0-9A-Fa-f]{6}$/.test(hexInput)
                    ? hexInput
                    : brandColor || colors.outline,
              },
            ]}
          />
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
    </View>
  );

  // Step 5: Your Rates
  const renderStep5Rates = () => (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <MaterialCommunityIcons
          name="currency-usd"
          size={64}
          color={colors.primary}
          style={styles.stepIcon}
        />
        <Title style={styles.stepTitle}>Set your default rates</Title>
        <Paragraph style={styles.stepDescription}>
          These are your default rates for new quotes. You can always change them later in Settings.
        </Paragraph>
      </View>

      <Surface style={styles.card}>
        <TextInput
          label="Hourly Labor Rate"
          value={laborRate}
          onChangeText={setLaborRate}
          mode="outlined"
          style={styles.input}
          keyboardType="decimal-pad"
          left={<TextInput.Affix text="$" />}
          right={<TextInput.Affix text="/hr" />}
          autoComplete="off"
          textContentType="none"
        />

        <TextInput
          label="Markup Percentage"
          value={markup}
          onChangeText={setMarkup}
          mode="outlined"
          style={styles.input}
          keyboardType="decimal-pad"
          right={<TextInput.Affix text="%" />}
          autoComplete="off"
          textContentType="none"
        />
      </Surface>
    </View>
  );

  // Step 6: Payments (Square connection)
  const renderStep6Payments = () => (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <MaterialCommunityIcons
          name="credit-card-outline"
          size={64}
          color={colors.primary}
          style={styles.stepIcon}
        />
        <Title style={styles.stepTitle}>Get paid faster</Title>
        <Paragraph style={styles.stepDescription}>
          Accept card payments directly on your invoices. Funds settle to your Square account in 1-2 days.
        </Paragraph>
      </View>

      <Surface style={styles.card}>
        {squareConnected ? (
          <View style={styles.squareConnectedContainer}>
            <MaterialCommunityIcons
              name="check-circle"
              size={56}
              color={colors.success}
            />
            <Text style={styles.squareConnectedTitle}>Square connected</Text>
            <Text style={styles.squareConnectedSubtitle}>
              You're ready to accept card payments on your invoices. Tap Finish to complete setup.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.squareFeatureRow}>
              <MaterialCommunityIcons name="credit-card-check-outline" size={22} color={colors.primary} />
              <Text style={styles.squareFeatureText}>Customers pay via a secure link on their invoice</Text>
            </View>
            <View style={styles.squareFeatureRow}>
              <MaterialCommunityIcons name="bank-outline" size={22} color={colors.primary} />
              <Text style={styles.squareFeatureText}>Funds settle to your Square account in 1-2 business days</Text>
            </View>
            <View style={styles.squareFeatureRow}>
              <MaterialCommunityIcons name="shield-check-outline" size={22} color={colors.primary} />
              <Text style={styles.squareFeatureText}>Processed by Square — no card details touch your device</Text>
            </View>

            {squareError && (
              <View style={styles.errorBox}>
                <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.error} />
                <Text style={styles.errorText}>{squareError}</Text>
              </View>
            )}

            <Button
              mode="contained"
              onPress={handleConnectSquare}
              style={styles.connectSquareButton}
              loading={squareConnecting}
              disabled={squareConnecting}
              icon="credit-card-outline"
            >
              {squareConnecting ? 'Connecting…' : 'Connect Square'}
            </Button>

            <Text style={styles.squareFinePrint}>
              You'll be redirected to Square to sign in and authorise the connection. You can disconnect any time from Settings.
            </Text>
          </>
        )}
      </Surface>
    </View>
  );

  const skipLabel = 'Skip';
  const isFinalStep = currentStep === TOTAL_STEPS;
  const nextLabel = isFinalStep ? 'Finish' : 'Next';
  const nextIcon = isFinalStep ? 'check' : 'arrow-right';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      {/* Progress Indicator */}
      <OnboardingProgress
        currentStep={currentStep}
        totalSteps={TOTAL_STEPS}
        steps={ONBOARDING_STEPS}
      />

      {/* Step Content - Scrollable */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {renderStepContent()}
      </ScrollView>

      {/* Navigation Buttons - Fixed to Bottom */}
      <View style={[
        styles.navigationContainer,
        { paddingBottom: Math.max(insets.bottom, 12) }
      ]}>
        {currentStep > 1 && (
          <Button
            mode="outlined"
            onPress={handleBack}
            style={styles.backButton}
            icon="arrow-left"
          >
            Back
          </Button>
        )}

        <View style={styles.navigationRight}>
          {currentStep >= 3 && !(isFinalStep && squareConnected) && (
            <Button mode="text" onPress={handleSkip} style={styles.skipButton}>
              {skipLabel}
            </Button>
          )}
          <Button
            mode="contained"
            onPress={handleNext}
            style={styles.nextButton}
            loading={isLoading}
            disabled={isLoading}
            icon={nextIcon}
            contentStyle={styles.nextButtonContent}
          >
            {nextLabel}
          </Button>
        </View>
      </View>

      {/* Success Animation */}
      <CelebrationAnimation
        visible={showSuccess}
        onComplete={handleSuccessComplete}
        message="Welcome to QuoteMate!"
      />
    </KeyboardAvoidingView>
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
    paddingBottom: 140,
    flexGrow: 1,
  },
  stepContainer: {
    padding: 20,
  },
  stepHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  stepIcon: {
    marginBottom: 16,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  scrollableContent: {
    marginBottom: 16,
  },
  card: {
    padding: 16,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  input: {
    marginBottom: 16,
  },
  helperText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: -8,
    marginBottom: 8,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  categoryCard: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    elevation: 2,
  },
  categoryCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  categoryIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  categoryDescription: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
  categoryCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  // Branding — logo
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
  // Branding — colour
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
  // Payments — Square
  squareFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  squareFeatureText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  connectSquareButton: {
    marginTop: 8,
    marginBottom: 12,
  },
  squareFinePrint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  squareConnectedContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  squareConnectedTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginTop: 12,
    marginBottom: 6,
  },
  squareConnectedSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.error + '15',
    borderWidth: 1,
    borderColor: colors.error + '40',
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: colors.error,
    lineHeight: 18,
  },
  // Navigation
  navigationContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.outline,
    backgroundColor: colors.background,
  },
  navigationRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  backButton: {
    marginRight: 12,
  },
  skipButton: {
    marginRight: 8,
  },
  nextButton: {
    minWidth: 120,
  },
  nextButtonContent: {
    flexDirection: 'row-reverse',
  },
});
