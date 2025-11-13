/**
 * New Onboarding Screen - Multi-Step Flow
 * Beautiful, seamless UX for setting up business profile
 *
 * Steps:
 * 1. Company Name
 * 2. Trade Category
 * 3. Trade Niche/Service
 * 4. Preferred Stores
 * 5. Other Details (skippable)
 * 6. Success Animation
 */

import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
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
  IconButton,
  Chip,
  Dialog,
  Portal,
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useStore } from '../store/useStore';
import { BusinessSettings } from '../types';
import { colors } from '../theme';
import { OnboardingProgress, OnboardingStep } from '../components/OnboardingProgress';
import { CelebrationAnimation } from '../components/CelebrationAnimation';
import {
  TRADE_CATEGORIES,
  TradeCategory,
  TradeNiche,
  getTradeCategoryById,
  getTradeNicheById,
} from '../constants/tradeCategories';
import {
  getStoresForTrade,
  getDefaultStoresForTrade,
} from '../constants/tradeStores';

const { width } = Dimensions.get('window');

const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: 1, label: 'Company', icon: 'office-building' },
  { id: 2, label: 'Trade', icon: 'hammer-wrench' },
  { id: 3, label: 'Service', icon: 'tools' },
  { id: 4, label: 'Stores', icon: 'store' },
  { id: 5, label: 'Details', icon: 'information' },
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

  // Step 2 & 3: Trade Category and Niche (multi-select)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedNiches, setSelectedNiches] = useState<string[]>([]);

  // Step 4: Stores
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [customStores, setCustomStores] = useState<string[]>([]);
  const [newCustomStore, setNewCustomStore] = useState('');
  const [showAddStoreDialog, setShowAddStoreDialog] = useState(false);

  // Step 5: Other Details
  const [abn, setAbn] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoUri, setLogoUri] = useState<string | undefined>(undefined);
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
    // Validation for each step
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
    } else if (currentStep === 3) {
      // Niche selection is optional now since we have multi-select
      // Users can skip if they selected "All" in categories
    } else if (currentStep === 4) {
      if (selectedStores.length === 0) {
        Alert.alert('Required', 'Please select at least one store');
        return;
      }
    }

    if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
    } else {
      // Complete onboarding
      handleComplete();
    }
  };

  // Handle back
  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Handle skip (only on step 5)
  const handleSkip = () => {
    if (currentStep === 5) {
      handleComplete();
    }
  };

  // Handle category toggle (multi-select)
  const handleCategoryToggle = (categoryId: string) => {
    setSelectedCategories(prev => {
      if (prev.includes(categoryId)) {
        // Remove category and its niches
        const category = getTradeCategoryById(categoryId);
        const nicheIds = category?.niches.map(n => n.id) || [];
        setSelectedNiches(niches => niches.filter(n => !nicheIds.includes(n)));
        return prev.filter(c => c !== categoryId);
      } else {
        // Add category and update stores if it's the first category
        if (prev.length === 0) {
          const defaultStores = getDefaultStoresForTrade(
            categoryId === 'general' ? 'all' :
            categoryId === 'plumbing' ? 'plumber' :
            categoryId === 'electrical' ? 'electrician' :
            categoryId === 'carpentry' ? 'carpenter' :
            categoryId === 'cleaning' ? 'cleaner' : 'all'
          );
          setSelectedStores(defaultStores);
        }
        return [...prev, categoryId];
      }
    });
  };

  // Handle niche toggle (multi-select with parent/child logic)
  const handleNicheToggle = (nicheId: string, categoryId: string) => {
    const category = getTradeCategoryById(categoryId);
    if (!category) return;

    const isAllOption = nicheId === 'all';
    // Create composite keys for this category's niches
    const categoryNicheKeys = category.niches.map(n => `${categoryId}_${n.id}`);
    const childNicheKeys = categoryNicheKeys.filter(key => !key.endsWith('_all'));
    const allKey = `${categoryId}_all`;
    const currentKey = `${categoryId}_${nicheId}`;

    setSelectedNiches(prev => {
      if (isAllOption) {
        // Toggling "All Services" option for this category
        if (prev.includes(allKey)) {
          // Deselect "all" and all children of this category
          return prev.filter(n => !categoryNicheKeys.includes(n));
        } else {
          // Select "all" and all children of this category
          const otherNiches = prev.filter(n => !categoryNicheKeys.includes(n));
          return [...otherNiches, ...categoryNicheKeys];
        }
      } else {
        // Toggling a specific child service
        if (prev.includes(currentKey)) {
          // Deselecting a child - also deselect "all" for this category if it's selected
          return prev.filter(n => n !== currentKey && n !== allKey);
        } else {
          // Selecting a child
          const newNiches = [...prev, currentKey];

          // Check if all children of this category are now selected
          const allChildrenSelected = childNicheKeys.every(key =>
            newNiches.includes(key)
          );

          // If all children are selected, also select "all" for this category
          if (allChildrenSelected && !newNiches.includes(allKey)) {
            newNiches.push(allKey);
          }

          return newNiches;
        }
      }
    });
  };

  // Get all niches from selected categories
  const availableNiches = selectedCategories.flatMap(catId => {
    const category = getTradeCategoryById(catId);
    return category?.niches.map(niche => ({ ...niche, categoryId: catId })) || [];
  });

  // Handle store toggle
  const handleToggleStore = (storeUrl: string) => {
    if (selectedStores.includes(storeUrl)) {
      setSelectedStores(selectedStores.filter(s => s !== storeUrl));
    } else {
      setSelectedStores([...selectedStores, storeUrl]);
    }
  };

  // Handle add custom store
  const handleAddCustomStore = () => {
    if (!newCustomStore.trim()) {
      return;
    }

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

  // Handle remove custom store
  const handleRemoveCustomStore = (storeUrl: string) => {
    setCustomStores(customStores.filter(s => s !== storeUrl));
    setSelectedStores(selectedStores.filter(s => s !== storeUrl));
  };

  // Handle logo picker
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
      console.error('Image picker error:', error);
    }
  };

  // Handle remove logo
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

  // Handle complete
  const handleComplete = async () => {
    // Determine primary tradeType from first selected category
    const firstCategory = selectedCategories[0];
    const tradeType = firstCategory === 'plumbing' ? 'plumber' :
                     firstCategory === 'electrical' ? 'electrician' :
                     firstCategory === 'carpentry' ? 'carpenter' :
                     firstCategory === 'cleaning' ? 'cleaner' : 'all';

    // Extract just the niche IDs without category prefix (remove the categoryId_ prefix)
    const nicheIds = selectedNiches.map(key => {
      const parts = key.split('_');
      return parts.slice(1).join('_'); // Handle IDs that might have underscores
    });

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
      tradeNiches: nicheIds.length > 0 ? nicheIds : undefined,
      useBunningsApi: false,
      useReeceApi: false,
      hardwareStores: selectedStores.length > 0 ? selectedStores : undefined,
      customStores: customStores.length > 0 ? customStores : undefined,
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
        return renderStep3TradeNiche();
      case 4:
        return renderStep4Stores();
      case 5:
        return renderStep5Details();
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

  // Step 3: Trade Niche
  const renderStep3TradeNiche = () => {
    if (selectedCategories.length === 0) return null;

    return (
      <View style={styles.stepContainer}>
        <View style={styles.stepHeader}>
          <MaterialCommunityIcons
            name="tools"
            size={64}
            color={colors.primary}
            style={styles.stepIcon}
          />
          <Title style={styles.stepTitle}>What services do you offer?</Title>
          <Paragraph style={styles.stepDescription}>
            Select all specific areas of expertise within your selected categories (multi-select)
          </Paragraph>
          <View style={styles.infoBox}>
            <MaterialCommunityIcons name="information" size={20} color={colors.primary} />
            <Text style={styles.infoBoxText}>
              These templates will appear on the New Quote screen to help you quickly create quotes. Select 'none' to use custom AI quotes only.
            </Text>
          </View>
        </View>

        <ScrollView style={styles.scrollableContent}>
          <View style={styles.nicheContainer}>
            {selectedCategories.map(categoryId => {
              const category = getTradeCategoryById(categoryId);
              if (!category) return null;

              const categoryNiches = availableNiches.filter(n => n.categoryId === categoryId);

              return (
                <View key={categoryId}>
                  {/* Category Header */}
                  <View style={styles.nicheCategoryHeader}>
                    <MaterialCommunityIcons
                      name={category.icon as any}
                      size={24}
                      color={category.color}
                    />
                    <Text style={[styles.nicheCategoryTitle, { color: category.color }]}>
                      {category.name}
                    </Text>
                  </View>

                  {/* Niches for this category */}
                  {categoryNiches.map((niche) => {
                    const nicheKey = `${categoryId}_${niche.id}`;
                    const isSelected = selectedNiches.includes(nicheKey);
                    const isAllOption = niche.id === 'all';

                    return (
                      <TouchableOpacity
                        key={`${niche.categoryId}-${niche.id}`}
                        onPress={() => handleNicheToggle(niche.id, categoryId)}
                        style={[
                          styles.nicheCard,
                          isAllOption && styles.nicheCardAll,
                          isSelected && (isAllOption ? styles.nicheCardAllSelected : styles.nicheCardSelected),
                        ]}
                      >
                        <View style={styles.nicheHeader}>
                          <MaterialCommunityIcons
                            name={niche.icon as any}
                            size={28}
                            color={isSelected ? (isAllOption ? category.color : colors.primary) : colors.text}
                          />
                          <Text
                            style={[
                              styles.nicheName,
                              isAllOption && styles.nicheNameAll,
                              isSelected && (isAllOption ? styles.nicheNameAllSelected : styles.nicheNameSelected),
                            ]}
                          >
                            {niche.name}
                          </Text>
                          {isSelected && (
                            <MaterialCommunityIcons
                              name="check-circle"
                              size={24}
                              color={colors.success}
                            />
                          )}
                        </View>
                        <Text style={styles.nicheDescription}>{niche.description}</Text>
                        <View style={styles.nicheServices}>
                          {niche.commonServices.slice(0, 3).map((service, idx) => (
                            <Chip key={idx} style={styles.serviceChip} textStyle={styles.serviceChipText}>
                              {service}
                            </Chip>
                          ))}
                          {niche.commonServices.length > 3 && (
                            <Chip style={styles.serviceChip} textStyle={styles.serviceChipText}>
                              +{niche.commonServices.length - 3} more
                            </Chip>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    );
  };

  // Step 4: Stores
  const renderStep4Stores = () => {
    if (selectedCategories.length === 0) return null;

    // Use first selected category to determine stores
    const firstCategory = selectedCategories[0];
    const tradeType = firstCategory === 'plumbing' ? 'plumber' :
                      firstCategory === 'electrical' ? 'electrician' :
                      firstCategory === 'carpentry' ? 'carpenter' :
                      firstCategory === 'cleaning' ? 'cleaner' : 'all';

    // Get single selected store (first one if multiple, for backward compatibility)
    const selectedStore = selectedStores[0] || '';

    return (
      <View style={styles.stepContainer}>
        <View style={styles.stepHeader}>
          <MaterialCommunityIcons
            name="store"
            size={64}
            color={colors.primary}
            style={styles.stepIcon}
          />
          <Title style={styles.stepTitle}>Where do you shop?</Title>
          <Paragraph style={styles.stepDescription}>
            Select your preferred hardware store for pricing
          </Paragraph>
        </View>

        <ScrollView style={styles.scrollableContent}>
          {/* More Accurate Pricing Section */}
          <View style={styles.storeCategory}>
            <View style={styles.storeCategoryHeader}>
              <MaterialCommunityIcons name="check-circle" size={20} color="#4CAF50" />
              <Text style={styles.storeCategoryTitle}>More Accurate Pricing</Text>
            </View>
            <Text style={styles.storeCategoryDescription}>
              Stores with more reliable web search pricing or API access.
            </Text>

            {/* Bunnings */}
            <TouchableOpacity
              style={[
                styles.storeRadioOption,
                selectedStore === 'bunnings.com.au' && styles.storeRadioOptionSelected
              ]}
              onPress={() => setSelectedStores(['bunnings.com.au'])}
            >
              <View style={styles.storeRadioLeft}>
                <View style={[
                  styles.radioButton,
                  selectedStore === 'bunnings.com.au' && styles.radioButtonSelected
                ]}>
                  {selectedStore === 'bunnings.com.au' && (
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
                selectedStore === 'mitre10.com.au' && styles.storeRadioOptionSelected
              ]}
              onPress={() => setSelectedStores(['mitre10.com.au'])}
            >
              <View style={styles.storeRadioLeft}>
                <View style={[
                  styles.radioButton,
                  selectedStore === 'mitre10.com.au' && styles.radioButtonSelected
                ]}>
                  {selectedStore === 'mitre10.com.au' && (
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
                selectedStore === 'hth.com.au' && styles.storeRadioOptionSelected
              ]}
              onPress={() => setSelectedStores(['hth.com.au'])}
            >
              <View style={styles.storeRadioLeft}>
                <View style={[
                  styles.radioButton,
                  selectedStore === 'hth.com.au' && styles.radioButtonSelected
                ]}>
                  {selectedStore === 'hth.com.au' && (
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
                selectedStore === 'totaltools.com.au' && styles.storeRadioOptionSelected
              ]}
              onPress={() => setSelectedStores(['totaltools.com.au'])}
            >
              <View style={styles.storeRadioLeft}>
                <View style={[
                  styles.radioButton,
                  selectedStore === 'totaltools.com.au' && styles.radioButtonSelected
                ]}>
                  {selectedStore === 'totaltools.com.au' && (
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
          </View>
        </ScrollView>
      </View>
    );
  };

  // Step 5: Other Details
  const renderStep5Details = () => (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <MaterialCommunityIcons
          name="information"
          size={64}
          color={colors.primary}
          style={styles.stepIcon}
        />
        <Title style={styles.stepTitle}>Additional details</Title>
        <Paragraph style={styles.stepDescription}>
          Optional information for your quotes
        </Paragraph>
      </View>

      <ScrollView style={styles.scrollableContent}>
        <Surface style={styles.card}>
          <Title style={styles.sectionTitle}>Default Rates</Title>

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

        <Surface style={styles.card}>
          <Title style={styles.sectionTitle}>Company Logo (Optional)</Title>

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
              <MaterialCommunityIcons name="image-plus" size={48} color={colors.primary} />
              <Text style={styles.logoUploadText}>Tap to Upload Logo</Text>
            </TouchableOpacity>
          )}
        </Surface>

        <Surface style={styles.card}>
          <Title style={styles.sectionTitle}>Business Details (Optional)</Title>

          <TextInput
            label="ABN"
            value={abn}
            onChangeText={setAbn}
            mode="outlined"
            style={styles.input}
            placeholder="12 345 678 910"
            keyboardType="numeric"
            autoComplete="off"
            textContentType="none"
          />

          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            mode="outlined"
            style={styles.input}
            placeholder="your.email@domain.com.au"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
          />

          <TextInput
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            mode="outlined"
            style={styles.input}
            placeholder="0412 345 678"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
          />

          <TextInput
            label="Business Address"
            value={address}
            onChangeText={setAddress}
            mode="outlined"
            style={styles.input}
            multiline
            numberOfLines={3}
            placeholder="123 Main St, Sydney NSW 2000"
            autoComplete="street-address"
            textContentType="fullStreetAddress"
          />
        </Surface>
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Progress Indicator */}
      <OnboardingProgress
        currentStep={currentStep}
        totalSteps={5}
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
          {currentStep === 5 && (
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
            icon={currentStep === 5 ? 'check' : 'arrow-right'}
            contentStyle={styles.nextButtonContent}
          >
            {currentStep === 5 ? 'Complete' : 'Next'}
          </Button>
        </View>
      </View>

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
              autoComplete="off"
              textContentType="URL"
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setShowAddStoreDialog(false);
                setNewCustomStore('');
              }}
            >
              Cancel
            </Button>
            <Button onPress={handleAddCustomStore} mode="contained">
              Add Store
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
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
  nicheContainer: {
    paddingBottom: 20,
  },
  nicheCategoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginTop: 16,
    marginBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: colors.outline,
  },
  nicheCategoryTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 12,
  },
  nicheCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    marginLeft: 16,
    borderWidth: 2,
    borderColor: colors.outline,
    elevation: 1,
  },
  nicheCardAll: {
    marginLeft: 0,
    borderWidth: 3,
    borderStyle: 'dashed',
  },
  nicheCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
    elevation: 3,
  },
  nicheCardAllSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '15',
    borderStyle: 'solid',
    elevation: 4,
  },
  nicheHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  nicheName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    marginLeft: 12,
  },
  nicheNameAll: {
    fontSize: 19,
    fontWeight: '800',
  },
  nicheNameSelected: {
    color: colors.primary,
  },
  nicheNameAllSelected: {
    color: colors.primary,
    fontWeight: '800',
  },
  nicheDescription: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 12,
  },
  nicheServices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  serviceChip: {
    height: 28,
    marginRight: 0,
    justifyContent: 'center',
  },
  serviceChipText: {
    fontSize: 11,
    lineHeight: 14,
    paddingVertical: 0,
    marginVertical: 0,
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
  infoBox: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 8,
    marginTop: 0,
    marginBottom: 0,
    alignSelf: 'stretch',
    marginHorizontal: 20,
  },
  infoBoxText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
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
  dialog: {
    maxWidth: 500,
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
