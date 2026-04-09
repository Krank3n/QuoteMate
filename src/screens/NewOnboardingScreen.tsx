/**
 * New Onboarding Screen - Streamlined 3-Step Flow
 * Gets tradies quoting in under 60 seconds
 *
 * Steps:
 * 1. Company Name
 * 2. Trade Category
 * 3. Your Rates (skippable)
 * 4. Success Animation
 */

import React, { useState, useRef } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Text,
  TextInput,
  Button,
  Surface,
  Title,
  Paragraph,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useStore } from '../store/useStore';
import { BusinessSettings } from '../types';
import { colors } from '../theme';
import { OnboardingProgress, OnboardingStep } from '../components/OnboardingProgress';
import { CelebrationAnimation } from '../components/CelebrationAnimation';
import {
  TRADE_CATEGORIES,
  getTradeCategoryById,
} from '../constants/tradeCategories';
import {
  getDefaultStoresForTrade,
} from '../constants/tradeStores';

const { width } = Dimensions.get('window');

const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: 1, label: 'Company', icon: 'office-building' },
  { id: 2, label: 'Trade', icon: 'hammer-wrench' },
  { id: 3, label: 'Rates', icon: 'currency-usd' },
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

  // Step 3: Rates
  const [laborRate, setLaborRate] = useState('85');
  const [markup, setMarkup] = useState('20');

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  // Animate step transitions
  React.useEffect(() => {
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

    if (currentStep < 3) {
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

  // Handle skip (only on step 3)
  const handleSkip = () => {
    if (currentStep === 3) {
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

  // Handle complete
  const handleComplete = async () => {
    // Determine primary tradeType from first selected category
    const firstCategory = selectedCategories[0];
    const tradeType = firstCategory === 'plumbing' ? 'plumber' :
                     firstCategory === 'electrical' ? 'electrician' :
                     firstCategory === 'carpentry' ? 'carpenter' :
                     firstCategory === 'cleaning' ? 'cleaner' : 'all';

    // Auto-default store based on trade
    const defaultStores = getDefaultStoresForTrade(tradeType);

    const settings: BusinessSettings = {
      businessName: businessName.trim(),
      defaultLaborRate: parseFloat(laborRate) || 85,
      defaultMarkup: parseFloat(markup) || 20,
      tradeType: tradeType,
      tradeCategories: selectedCategories.length > 0 ? selectedCategories : undefined,
      useReeceApi: false,
      hardwareStores: defaultStores.length > 0 ? defaultStores : ['bunnings.com.au'],
    };

    try {
      setIsLoading(true);
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
        return renderStep3Rates();
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

  // Step 3: Your Rates
  const renderStep3Rates = () => (
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

  return (
    <View style={styles.container}>
      {/* Progress Indicator */}
      <OnboardingProgress
        currentStep={currentStep}
        totalSteps={3}
        steps={ONBOARDING_STEPS}
      />

      {/* Step Content - Scrollable */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {renderStepContent()}
      </ScrollView>

      {/* Navigation Buttons - Fixed to Bottom */}
      <View style={[
        styles.navigationContainer,
        { paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 32 : 16) }
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
          {currentStep === 3 && (
            <Button mode="text" onPress={handleSkip} style={styles.skipButton}>
              Skip
            </Button>
          )}
          <Button
            mode="contained"
            onPress={handleNext}
            style={styles.nextButton}
            loading={isLoading}
            disabled={isLoading}
            icon={currentStep === 3 ? 'check' : 'arrow-right'}
            contentStyle={styles.nextButtonContent}
          >
            {currentStep === 3 ? 'Complete' : 'Next'}
          </Button>
        </View>
      </View>

      {/* Success Animation */}
      <CelebrationAnimation
        visible={showSuccess}
        onComplete={handleSuccessComplete}
        message="Welcome to QuoteMate!"
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
    paddingBottom: 100,
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
  input: {
    marginBottom: 16,
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
