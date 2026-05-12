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

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
    View,
    StyleSheet,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    BackHandler,
    TouchableOpacity,
    Animated,
    Image,
    TextInput as RNTextInput,
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
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useStore } from '../store/useStore';
import { BusinessSettings } from '../types';
import { colors } from '../theme';
import { OnboardingProgress, OnboardingStep } from '../components/OnboardingProgress';
import { CelebrationAnimation } from '../components/CelebrationAnimation';
import { AlertModal } from '../components/AlertModal';
import { TRADE_CATEGORIES } from '../constants/tradeCategories';
import { auth } from '../config/firebase';
import * as squareService from '../services/squareService';
import { runReeceConnectFlow } from '../services/reeceConnect';
import { getReeceConnectionStatus } from '../services/reeceApi';
import { uploadBusinessLogo } from '../services/photoService';
import { lightTap, successTap, errorTap, selectionTap } from '../utils/haptics';
import { SuppliersStep, type AddedSupplier } from './onboarding/SuppliersStep';

const STORAGE_KEY = 'onboarding:draft';

// The static base of the onboarding flow. The Reece step is inserted
// dynamically inside the component when the user picks plumbing, so it isn't
// shown to other trades.
const BASE_STEPS: Array<Omit<OnboardingStep, 'id'> & { key: string }> = [
    { key: 'company', label: 'Company', icon: 'office-building' },
    { key: 'trade', label: 'Trade', icon: 'hammer-wrench' },
    { key: 'contact', label: 'Contact', icon: 'card-account-details' },
    { key: 'branding', label: 'Branding', icon: 'palette' },
    { key: 'rates', label: 'Rates', icon: 'currency-usd' },
];

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
    const [logoMimeType, setLogoMimeType] = useState<string | undefined>(undefined);
    const [brandColor, setBrandColor] = useState<string | undefined>(undefined);
    const [hexInput, setHexInput] = useState('');

    // Step 5: Rates
    const [laborRate, setLaborRate] = useState('85');
    const [markup, setMarkup] = useState('20');

    // Step 6: Payments (Square)
    const [squareConnecting, setSquareConnecting] = useState(false);
    const [squareConnected, setSquareConnected] = useState(false);
    const [squareError, setSquareError] = useState<string | null>(null);

    // Optional Reece step — only included in the flow when the user picks
    // plumbing, since maX integration is plumber-specific.
    const [reeceConnecting, setReeceConnecting] = useState(false);
    const [reeceConnected, setReeceConnected] = useState(false);
    const [reeceError, setReeceError] = useState<string | null>(null);

    // Suppliers step — list of suppliers added during this onboarding session.
    // Stored purely for the visual confirmation card; the underlying
    // materialFavorites + supplierGroups writes already happened, so this
    // array is just UI state that we persist in the draft for back/forward
    // navigation and force-quit recovery.
    const [addedSuppliers, setAddedSuppliers] = useState<AddedSupplier[]>([]);
    const appendAddedSupplier = useCallback((s: AddedSupplier) => {
        setAddedSuppliers(prev => [...prev, s]);
    }, []);

    const ONBOARDING_STEPS: OnboardingStep[] = useMemo(() => {
        const items = [...BASE_STEPS];
        if (selectedCategories.includes('plumbing')) {
            items.push({ key: 'reece', label: 'Reece', icon: 'pipe' });
        }
        // Always offer the supplier price-book step. Sits after Reece (when
        // shown) so plumbers can layer their local hardware store on top of
        // their maX trade prices, and before Payments so the wow moment
        // happens before the monetisation ask.
        items.push({ key: 'suppliers', label: 'Suppliers', icon: 'truck-delivery' });
        items.push({ key: 'payments', label: 'Payments', icon: 'credit-card-outline' });
        return items.map((s, i) => ({ id: i + 1, key: s.key, label: s.label, icon: s.icon }));
    }, [selectedCategories]);

    const TOTAL_STEPS = ONBOARDING_STEPS.length;
    const currentStepKey = ONBOARDING_STEPS[currentStep - 1]?.key;

    // Inline validation (replaces Alert popups)
    const [showBusinessNameError, setShowBusinessNameError] = useState(false);
    const [showCategoryError, setShowCategoryError] = useState(false);

    // Modal state (replaces remaining Alert popups)
    const [removeLogoModalVisible, setRemoveLogoModalVisible] = useState(false);
    const [squareSkipModalVisible, setSquareSkipModalVisible] = useState(false);
    const [completeErrorVisible, setCompleteErrorVisible] = useState(false);

    // "Why we ask" tooltips
    const [activeTooltip, setActiveTooltip] = useState<'abn' | 'brand' | null>(null);

    // Animations
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(50)).current;
    const scrollRef = useRef<ScrollView>(null);
    const hydratedRef = useRef(false);

    // Input refs — for focusing next input on keyboard Return and auto-focus on step entry
    const phoneRef = useRef<RNTextInput>(null);
    const emailRef = useRef<RNTextInput>(null);
    const abnRef = useRef<RNTextInput>(null);
    const laborRateRef = useRef<RNTextInput>(null);
    const markupRef = useRef<RNTextInput>(null);

    // Hydrate draft from AsyncStorage on mount (resume where user left off)
    useEffect(() => {
        (async () => {
            try {
                const raw = await AsyncStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const d = JSON.parse(raw);
                    if (typeof d.currentStep === 'number') setCurrentStep(d.currentStep);
                    if (typeof d.businessName === 'string') setBusinessName(d.businessName);
                    if (Array.isArray(d.selectedCategories)) setSelectedCategories(d.selectedCategories);
                    if (typeof d.phone === 'string') setPhone(d.phone);
                    if (typeof d.email === 'string') setEmail(d.email);
                    if (typeof d.abn === 'string') setAbn(d.abn);
                    if (typeof d.brandColor === 'string') setBrandColor(d.brandColor);
                    if (typeof d.laborRate === 'string') setLaborRate(d.laborRate);
                    if (typeof d.markup === 'string') setMarkup(d.markup);
                    if (Array.isArray(d.addedSuppliers)) setAddedSuppliers(d.addedSuppliers);
                    // logoUri is intentionally not persisted — local file:// URIs don't survive app restarts.
                }
            } catch {
                // Ignore; start fresh.
            } finally {
                hydratedRef.current = true;
            }
        })();
    }, []);

    // Persist draft whenever key fields change (debounced by React's batching)
    useEffect(() => {
        if (!hydratedRef.current) return;
        AsyncStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                currentStep,
                businessName,
                selectedCategories,
                phone,
                email,
                abn,
                brandColor,
                laborRate,
                markup,
                addedSuppliers,
            }),
        ).catch(() => { /* ignore storage errors */ });
    }, [currentStep, businessName, selectedCategories, phone, email, abn, brandColor, laborRate, markup, addedSuppliers]);

    // Animate step transitions, reset scroll, haptic tick, auto-focus first input
    useEffect(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });

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

        // Auto-focus first input on text-entry steps (after the slide-in finishes)
        const focusTimer = setTimeout(() => {
            if (currentStep === 3) phoneRef.current?.focus();
            else if (currentStep === 5) laborRateRef.current?.focus();
        }, 450);

        return () => clearTimeout(focusTimer);
    }, [currentStep]);

    // Android hardware back — go to previous step instead of exiting
    useEffect(() => {
        if (Platform.OS !== 'android') return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            if (currentStep > 1) {
                handleBack();
                return true; // consume the event
            }
            return false; // let OS handle (exits app)
        });
        return () => sub.remove();
    }, [currentStep]);

    // Validation — whether the current step is allowed to advance.
    const isCurrentStepValid = (): boolean => {
        if (currentStep === 1) return businessName.trim().length > 0;
        if (currentStep === 2) return selectedCategories.length > 0;
        return true;
    };

    // Advance to the next step (or complete)
    const advance = () => {
        if (currentStep < TOTAL_STEPS) {
            setCurrentStep(currentStep + 1);
        } else {
            handleComplete();
        }
    };

    // Handle next step
    const handleNext = () => {
        if (currentStep === 1 && !businessName.trim()) {
            setShowBusinessNameError(true);
            errorTap();
            return;
        }
        if (currentStep === 2 && selectedCategories.length === 0) {
            setShowCategoryError(true);
            errorTap();
            return;
        }
        lightTap();
        advance();
    };

    // Handle back
    const handleBack = () => {
        if (currentStep > 1) {
            lightTap();
            setCurrentStep(currentStep - 1);
        }
    };

    // Handle skip — allowed on any step >= 3. Moves to the next step,
    // except on the final step which completes onboarding.
    const handleSkip = () => {
        if (currentStep < 3) return;
        // Skipping Square is costly (revenue), so nudge the user once before letting them through.
        if (currentStepKey === 'payments' && !squareConnected) {
            setSquareSkipModalVisible(true);
            return;
        }
        lightTap();
        advance();
    };

    // User confirmed skipping the Square step from the modal.
    const confirmSquareSkip = () => {
        setSquareSkipModalVisible(false);
        lightTap();
        advance();
    };

    // Handle category toggle (multi-select)
    const handleCategoryToggle = (categoryId: string) => {
        selectionTap();
        setShowCategoryError(false);
        setSelectedCategories(prev => {
            if (prev.includes(categoryId)) {
                return prev.filter(c => c !== categoryId);
            } else {
                return [...prev, categoryId];
            }
        });
    };

    // Logo picker (ported from BusinessProfileScreen)
    const [logoPickError, setLogoPickError] = useState<string | null>(null);
    const handlePickLogo = async () => {
        setLogoPickError(null);
        try {
            const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

            if (permissionResult.granted === false) {
                setLogoPickError('Permission to access your photo library is required to pick a logo.');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                quality: 0.8,
            });

            if (!result.canceled && result.assets[0]) {
                selectionTap();
                setLogoUri(result.assets[0].uri);
                setLogoMimeType(result.assets[0].mimeType);
            }
        } catch (error) {
            setLogoPickError("We couldn't open the image picker. Please try again.");
        }
    };

    const handleRemoveLogo = () => {
        setRemoveLogoModalVisible(true);
    };

    const confirmRemoveLogo = () => {
        setRemoveLogoModalVisible(false);
        setLogoUri(undefined);
        setLogoMimeType(undefined);
    };

    const uploadLogoToStorage = async (uri: string, mimeType?: string): Promise<string> => {
        const userId = auth.currentUser?.uid;
        if (!userId) throw new Error('Not signed in');
        return uploadBusinessLogo(userId, uri, mimeType);
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
                    savedLogoUri = await uploadLogoToStorage(logoUri, logoMimeType);
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

            // Clear the draft now that the user is fully onboarded.
            AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});

            successTap();
            setShowSuccess(true);
        } catch (error) {
            setCompleteErrorVisible(true);
            errorTap();
            setIsLoading(false);
        }
    };

    // Handle success completion
    const handleSuccessComplete = async () => {
        setShowSuccess(false);
        await setOnboarded(true);
    };

    // Render step content. Keyed on the dynamic step list's `key` field, not
    // the numeric position, since plumbers and other trades have different
    // step counts.
    const renderStepContent = () => {
        switch (currentStepKey) {
            case 'company':
                return renderStep1CompanyName();
            case 'trade':
                return renderStep2TradeCategory();
            case 'contact':
                return renderStep3Contact();
            case 'branding':
                return renderStep4Branding();
            case 'rates':
                return renderStep5Rates();
            case 'reece':
                return renderStepReece();
            case 'suppliers':
                return (
                    <SuppliersStep
                        addedSuppliers={addedSuppliers}
                        onSupplierAdded={appendAddedSupplier}
                    />
                );
            case 'payments':
                return renderStep6Payments();
            default:
                return null;
        }
    };

    const handleConnectReece = async () => {
        setReeceError(null);
        setReeceConnecting(true);
        try {
            const outcome = await runReeceConnectFlow();
            if (outcome.kind === 'connected') {
                setReeceConnected(true);
            } else if (outcome.kind === 'failed') {
                // Race: backend can write to Firestore while the client loses the
                // response (see ReeceIntegrationScreen.handleConnect for context).
                // Confirm via a fresh status check before surfacing a failure.
                const status = await getReeceConnectionStatus();
                if (status.connected) {
                    setReeceConnected(true);
                } else {
                    setReeceError(outcome.message);
                }
            }
        } finally {
            setReeceConnecting(false);
        }
    };

    // Plumber-only step: connect a Reece maX account so QuoteMate can fetch
    // real trade prices. Always skippable — connecting can be done later from
    // Settings.
    const renderStepReece = () => (
        <View style={styles.stepContainer}>
            <View style={styles.stepHeader}>
                <MaterialCommunityIcons
                    name="pipe"
                    size={64}
                    color={colors.primary}
                    style={styles.stepIcon}
                />
                <Title style={styles.stepTitle}>Real Reece trade prices</Title>
                <Paragraph style={styles.stepDescription}>
                    Connect your Reece maX account so every quote uses your real trade-discounted pricing — not a guess.
                </Paragraph>
            </View>

            <Surface style={styles.card}>
                {reeceConnected ? (
                    <View style={styles.squareConnectedContainer}>
                        <MaterialCommunityIcons
                            name="check-circle"
                            size={56}
                            color={colors.success}
                        />
                        <Text style={styles.squareConnectedTitle}>Reece connected</Text>
                        <Text style={styles.squareConnectedSubtitle}>
                            Your trade prices will flow into every quote. Tap Next to continue.
                        </Text>
                    </View>
                ) : (
                    <>
                        <View style={styles.squareFeatureRow}>
                            <MaterialCommunityIcons name="cash-multiple" size={22} color={colors.primary} />
                            <Text style={styles.squareFeatureText}>Quotes pull your real maX trade-discounted price for each item</Text>
                        </View>
                        <View style={styles.squareFeatureRow}>
                            <MaterialCommunityIcons name="lock-outline" size={22} color={colors.primary} />
                            <Text style={styles.squareFeatureText}>Sign in directly with Reece — we never see your maX password</Text>
                        </View>
                        <View style={styles.squareFeatureRow}>
                            <MaterialCommunityIcons name="clock-fast" size={22} color={colors.primary} />
                            <Text style={styles.squareFeatureText}>Takes about a minute. You can also skip and connect later from Settings</Text>
                        </View>

                        {reeceError ? (
                            <View style={styles.errorBox}>
                                <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.error} />
                                <Text style={styles.errorText}>{reeceError}</Text>
                            </View>
                        ) : null}

                        <Button
                            mode="contained"
                            onPress={handleConnectReece}
                            style={styles.connectSquareButton}
                            loading={reeceConnecting}
                            disabled={reeceConnecting}
                            icon="pipe"
                        >
                            {reeceConnecting ? 'Connecting…' : 'Connect Reece'}
                        </Button>

                        <Text style={styles.squareFinePrint}>
                            You'll be redirected to reece.com.au to sign in to maX and approve QuoteMate.
                        </Text>
                    </>
                )}
            </Surface>
        </View>
    );

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
                    onChangeText={(t) => {
                        setBusinessName(t);
                        if (showBusinessNameError && t.trim().length > 0) setShowBusinessNameError(false);
                    }}
                    mode="outlined"
                    style={styles.input}
                    placeholder="e.g., Smith's Plumbing"
                    autoFocus
                    returnKeyType="next"
                    onSubmitEditing={handleNext}
                    autoComplete="off"
                    textContentType="organizationName"
                    error={showBusinessNameError}
                />
                {showBusinessNameError && (
                    <Text style={styles.fieldError}>Please enter your business name</Text>
                )}
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
                {showCategoryError && (
                    <Text style={styles.fieldError}>Please select at least one category</Text>
                )}
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
                    ref={phoneRef}
                    label="Phone"
                    value={phone}
                    onChangeText={setPhone}
                    mode="outlined"
                    style={styles.input}
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    autoComplete="tel"
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                />

                <TextInput
                    ref={emailRef}
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    mode="outlined"
                    style={styles.input}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    autoCapitalize="none"
                    autoComplete="email"
                    returnKeyType="next"
                    onSubmitEditing={() => abnRef.current?.focus()}
                />

                <TextInput
                    ref={abnRef}
                    label="ABN"
                    value={abn}
                    onChangeText={setAbn}
                    mode="outlined"
                    style={styles.input}
                    keyboardType="number-pad"
                    autoComplete="off"
                    returnKeyType="done"
                    onSubmitEditing={handleNext}
                />
                <View style={styles.helperRow}>
                    <Text style={styles.helperText}>Used on tax invoices</Text>
                    <TouchableOpacity
                        onPress={() => setActiveTooltip(activeTooltip === 'abn' ? null : 'abn')}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <MaterialCommunityIcons
                            name="information-outline"
                            size={16}
                            color={colors.textMuted}
                        />
                    </TouchableOpacity>
                </View>
                {activeTooltip === 'abn' && (
                    <Text style={styles.tooltipText}>
                        Adding your ABN lets customers claim GST credits and makes your invoices tax-compliant. You can add it later in Settings.
                    </Text>
                )}
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
                        <Text style={styles.logoUploadHint}>Any shape — crop and zoom on the next screen</Text>
                    </TouchableOpacity>
                )}
                {logoPickError && (
                    <View style={styles.errorBox}>
                        <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.error} />
                        <Text style={styles.errorText}>{logoPickError}</Text>
                    </View>
                )}
            </Surface>

            <Surface style={styles.card}>
                <View style={styles.cardTitleRow}>
                    <Title style={styles.cardTitle}>Brand Colour</Title>
                    <TouchableOpacity
                        onPress={() => setActiveTooltip(activeTooltip === 'brand' ? null : 'brand')}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <MaterialCommunityIcons
                            name="information-outline"
                            size={18}
                            color={colors.textMuted}
                        />
                    </TouchableOpacity>
                </View>
                {activeTooltip === 'brand' && (
                    <Text style={styles.tooltipText}>
                        Your brand colour accents headings and totals on every PDF. Customers are more likely to remember and trust a consistent look.
                    </Text>
                )}

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
                                selectionTap();
                                setBrandColor(hexInput);
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
                    ref={laborRateRef}
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
                    returnKeyType="next"
                    onSubmitEditing={() => markupRef.current?.focus()}
                />

                <TextInput
                    ref={markupRef}
                    label="Markup Percentage"
                    value={markup}
                    onChangeText={setMarkup}
                    mode="outlined"
                    style={styles.input}
                    keyboardType="decimal-pad"
                    right={<TextInput.Affix text="%" />}
                    autoComplete="off"
                    textContentType="none"
                    returnKeyType="done"
                    onSubmitEditing={handleNext}
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
                    Customers tap to pay or scan a QR code right on your quote. Funds settle to your Square account in 1-2 days.
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
                            <Text style={styles.squareFeatureText}>Customers tap-to-pay or scan a QR on your quote</Text>
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
                ref={scrollRef}
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

            {/* Confirm removing the company logo */}
            <AlertModal
                visible={removeLogoModalVisible}
                onDismiss={() => setRemoveLogoModalVisible(false)}
                type="warning"
                title="Remove logo?"
                message="This will remove your company logo. You can add it again any time."
                primaryButtonText="Remove"
                primaryButtonAction={confirmRemoveLogo}
                secondaryButtonText="Cancel"
                secondaryButtonAction={() => setRemoveLogoModalVisible(false)}
            />

            {/* Nudge before skipping Square (revenue-impacting step) */}
            <AlertModal
                visible={squareSkipModalVisible}
                onDismiss={() => setSquareSkipModalVisible(false)}
                type="info"
                title="Skip card payments?"
                message="Without Square, customers won't be able to pay invoices by card. You can always connect it later in Settings."
                primaryButtonText="Connect Square"
                primaryButtonAction={() => {
                    setSquareSkipModalVisible(false);
                    handleConnectSquare();
                }}
                secondaryButtonText="Skip anyway"
                secondaryButtonAction={confirmSquareSkip}
            />

            {/* Completion error */}
            <AlertModal
                visible={completeErrorVisible}
                onDismiss={() => setCompleteErrorVisible(false)}
                type="error"
                title="Something went wrong"
                message="We couldn't save your settings. Please check your connection and try again."
                primaryButtonText="OK"
                primaryButtonAction={() => setCompleteErrorVisible(false)}
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
    cardTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    input: {
        marginBottom: 16,
    },
    helperText: {
        fontSize: 13,
        color: colors.textMuted,
    },
    helperRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: -8,
        marginBottom: 8,
    },
    tooltipText: {
        fontSize: 13,
        color: colors.textMuted,
        lineHeight: 18,
        marginTop: 4,
        marginBottom: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: colors.surfaceLight,
        borderRadius: 8,
        borderLeftWidth: 3,
        borderLeftColor: colors.primary,
    },
    fieldError: {
        fontSize: 13,
        color: colors.error,
        marginTop: 4,
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
