/**
 * Customer Details Screen
 * Second step: Enter customer information with smart auto-complete
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Surface,
  Title,
  Chip,
  Card,
  Divider,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';

import { useStore } from '../../store/useStore';
import { useCurrentDocument, useDocumentMode, useDocumentList } from '../../utils/documentMode';
import { calculateTravelAdjustment } from '../../utils/travelCalculator';
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { useTourRefs } from '../../components/tour/useTourRefs';
import { ScreenTour } from '../../components/tour/ScreenTour';
import { notifyScreenComplete, notifySkipRequest } from '../../components/tour/UnifiedTourController';
import { PHASE_STEP_OFFSETS, UNIFIED_TOUR_TOTAL_STEPS } from '../../components/tour/tourFlow';

interface CustomerInfo {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  lastUsed: Date;
}

export function CustomerDetailsScreen() {
  const navigation = useNavigation<any>();
  const mode = useDocumentMode();
  const { document: currentDocument, update: updateDocument } = useCurrentDocument();
  const { saveDraft, businessSettings, hasSeenScreenTour, unifiedTourActive, unifiedTourPhase } = useStore();
  const documentList = useDocumentList();

  // For compatibility, alias to currentQuote (used throughout this file)
  const currentQuote = currentDocument;
  const updateQuote = updateDocument;
  // Use combined document list for customer auto-complete
  const quotes = documentList;

  // Tour refs
  const { registerRef } = useTourRefs();
  const customerNameRef = useRef<View>(null);
  const jobAddressRef = useRef<View>(null);
  const recentCustomersRef = useRef<View>(null);
  const [tourActive, setTourActive] = useState(false);
  // Only show Davo during the unified tour
  const showDavo = unifiedTourActive && unifiedTourPhase === 'customerDetails';

  useEffect(() => {
    if (customerNameRef.current) registerRef('customerName', customerNameRef.current);
    if (jobAddressRef.current) registerRef('jobAddress', jobAddressRef.current);
    if (recentCustomersRef.current) registerRef('recentCustomers', recentCustomersRef.current);
  });

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [jobAddress, setJobAddress] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Extract unique customers from past quotes
  const pastCustomers = useMemo(() => {
    const customerMap = new Map<string, CustomerInfo>();

    quotes.forEach((quote) => {
      const key = quote.customerName.toLowerCase().trim();
      if (key && !customerMap.has(key)) {
        customerMap.set(key, {
          name: quote.customerName,
          email: quote.customerEmail,
          phone: quote.customerPhone,
          address: quote.jobAddress,
          lastUsed: quote.updatedAt,
        });
      }
    });

    // Sort by most recently used
    return Array.from(customerMap.values()).sort(
      (a, b) => b.lastUsed.getTime() - a.lastUsed.getTime()
    );
  }, [quotes]);

  // Filter customers based on search input
  const filteredCustomers = useMemo(() => {
    if (!customerName.trim()) return pastCustomers.slice(0, 5);

    const search = customerName.toLowerCase();
    return pastCustomers
      .filter((c) => c.name.toLowerCase().includes(search))
      .slice(0, 5);
  }, [customerName, pastCustomers]);

  // Load existing customer data on mount (for editing existing quotes).
  // Runs once only — the quote is always set in the store before navigating here,
  // so mount-time is sufficient. Subsequent currentQuote reference changes (e.g.
  // from a deferred saveDraft on the previous screen) carry the same field values
  // and must NOT re-run, as they would wipe tour demo data (Davo).
  useEffect(() => {
    if (currentQuote) {
      setCustomerName(currentQuote.customerName || '');
      setCustomerEmail(currentQuote.customerEmail || '');
      setCustomerPhone(currentQuote.customerPhone || '');
      setJobAddress(currentQuote.jobAddress || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save changes when navigating back
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      if (!currentQuote) return;

      // Save any changes before leaving
      if (customerName.trim()) {
        const updatedQuote = {
          ...currentQuote,
          customerName: customerName.trim(),
          customerEmail: customerEmail.trim(),
          customerPhone: customerPhone.trim(),
          jobAddress: jobAddress.trim(),
        };
        updateQuote(updatedQuote);
      }
    });

    return unsubscribe;
  }, [navigation, currentQuote, customerName, customerEmail, customerPhone, jobAddress, updateQuote]);

  const handleSelectCustomer = (customer: CustomerInfo) => {
    setCustomerName(customer.name);
    setCustomerEmail(customer.email || '');
    setCustomerPhone(customer.phone || '');
    setJobAddress(customer.address || '');
    setShowSuggestions(false);
  };

  const handleCustomerNameChange = (text: string) => {
    setCustomerName(text);
    setShowSuggestions(text.length > 0);
  };

  const handleNext = () => {
    if (!currentQuote) return;

    if (!customerName.trim()) {
      // Don't use Alert, just show a visual indicator or message
      return;
    }

    // Update quote with customer details
    const updatedQuote = {
      ...currentQuote,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      customerPhone: customerPhone.trim(),
      jobAddress: jobAddress.trim(),
      draftStep: 'MaterialsList',
    };

    updateQuote(updatedQuote);
    saveDraft(updatedQuote);
    navigation.navigate('MaterialsList');

    // Fire-and-forget: calculate travel distance in background
    const trimmedJobAddress = jobAddress.trim();
    if (businessSettings?.address && trimmedJobAddress) {
      calculateTravelAdjustment(businessSettings.address, trimmedJobAddress)
        .then((result) => {
          if (result) {
            // Only set travel adjustment if user hasn't already manually adjusted it
            const hasExistingAdjustment = updatedQuote.travelAdjustment !== undefined && updatedQuote.travelAdjustment > 0;
            updateDocument({
              ...updatedQuote,
              estimatedDistance: result.distance,
              estimatedFuelCost: result.estimatedFuelCost,
              travelGeocodeFailed: false,
              ...(hasExistingAdjustment ? {} : { travelAdjustment: result.suggestedMarkup }),
            });
          } else {
            // Geocoding returned null — one or both addresses couldn't be resolved
            updateDocument({
              ...updatedQuote,
              travelGeocodeFailed: true,
            });
          }
        })
        .catch(() => {
          updateDocument({
            ...updatedQuote,
            travelGeocodeFailed: true,
          });
        });
    }
  };

  if (!currentQuote) {
    return null;
  }

  // Fake customer shown during the tour so there's always a recent customer to demo
  const TOUR_CUSTOMER: CustomerInfo = {
    name: 'Davo Snagsworth',
    email: 'davo@snagsworth.com.au',
    phone: '0412 345 678',
    address: 'Sydney Opera House',
    lastUsed: new Date(),
  };

  const realRecents = pastCustomers.slice(0, 3);
  const recentCustomers = showDavo
    ? [TOUR_CUSTOMER, ...realRecents].slice(0, 3)
    : realRecents;
  // During the tour, always show recent customers so the section doesn't disappear
  // when Davo is auto-selected (which would cause layout shifts and unmount the ref)
  const showRecentCustomers = tourActive
    ? recentCustomers.length > 0
    : (!showSuggestions && customerName.length === 0 && recentCustomers.length > 0);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!tourActive}
      >
        <WebContainer>
          <Surface style={styles.section}>
            <View style={styles.sectionTitleContainer}>
              <View style={styles.sectionIconCircle}>
                <MaterialCommunityIcons
                  name="account"
                  size={20}
                  color={colors.info}
                />
              </View>
              <Title style={styles.sectionTitle}>Customer Details</Title>
            </View>

            <Text style={styles.helperText}>
              Enter customer information or select from recent customers below.
            </Text>

            {/* Recent Customers - Show when input is empty */}
            {showRecentCustomers && (
              <View ref={recentCustomersRef} style={styles.recentCustomersContainer}>
                <Text style={styles.recentLabel}>Recent Customers:</Text>
                <View style={styles.chipsContainer}>
                  {recentCustomers.map((customer, index) => (
                    <Chip
                      key={index}
                      mode="outlined"
                      onPress={() => handleSelectCustomer(customer)}
                      style={styles.customerChip}
                      icon="account-clock"
                    >
                      {customer.name}
                    </Chip>
                  ))}
                </View>
              </View>
            )}

            {/* Customer Name Input */}
            <TextInput
              ref={customerNameRef}
              label="Customer Name *"
              value={customerName}
              onChangeText={handleCustomerNameChange}
              onFocus={() => setShowSuggestions(customerName.length > 0)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              mode="outlined"
              style={styles.input}
              autoCapitalize="words"
              error={!customerName.trim()}
            />

            {/* Auto-complete Suggestions */}
            {showSuggestions && filteredCustomers.length > 0 && (
              <Card style={styles.suggestionsCard}>
                <Card.Content style={styles.suggestionsContent}>
                  <Text style={styles.suggestionsHeader}>Suggestions:</Text>
                  {filteredCustomers.map((customer, index) => (
                    <React.Fragment key={index}>
                      {index > 0 && <Divider style={styles.suggestionDivider} />}
                      <TouchableOpacity
                        style={styles.suggestionItem}
                        onPress={() => handleSelectCustomer(customer)}
                      >
                        <View style={styles.suggestionContent}>
                          <View style={styles.suggestionMain}>
                            <MaterialCommunityIcons
                              name="account"
                              size={20}
                              color={colors.primary}
                              style={styles.suggestionIcon}
                            />
                            <View style={styles.suggestionText}>
                              <Text style={styles.suggestionName}>{customer.name}</Text>
                              {customer.phone && (
                                <Text style={styles.suggestionDetail}>{customer.phone}</Text>
                              )}
                              {customer.email && (
                                <Text style={styles.suggestionDetail}>{customer.email}</Text>
                              )}
                            </View>
                          </View>
                          <MaterialCommunityIcons
                            name="chevron-right"
                            size={20}
                            color={colors.onSurface}
                          />
                        </View>
                      </TouchableOpacity>
                    </React.Fragment>
                  ))}
                </Card.Content>
              </Card>
            )}

            {/* Other Customer Fields */}
            <TextInput
              label="Email"
              value={customerEmail}
              onChangeText={setCustomerEmail}
              mode="outlined"
              style={styles.input}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <TextInput
              label="Phone"
              value={customerPhone}
              onChangeText={setCustomerPhone}
              mode="outlined"
              style={styles.input}
              keyboardType="phone-pad"
            />

            <TextInput
              ref={jobAddressRef}
              label="Job Address"
              value={jobAddress}
              onChangeText={setJobAddress}
              mode="outlined"
              style={styles.input}
              multiline
              numberOfLines={2}
            />
          </Surface>
        </WebContainer>
      </ScrollView>

      <FixedBottomButton
        label="Next: Materials"
        onPress={handleNext}
        disabled={!customerName.trim()}
      />

      {unifiedTourActive && unifiedTourPhase === 'customerDetails' && (
        <ScreenTour
          tourId="customerDetails"
          onActiveChange={setTourActive}
          unifiedMode={true}
          onScreenComplete={() => notifyScreenComplete('customerDetails')}
          onSkipRequest={notifySkipRequest}
          stepOffset={PHASE_STEP_OFFSETS.customerDetails}
          globalTotalSteps={UNIFIED_TOUR_TOTAL_STEPS}
          onStepChange={(stepId) => {
            if (stepId === 'customerName' && showDavo) {
              handleSelectCustomer(TOUR_CUSTOMER);
            }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // height: "100%",
    // height: '100vh' as any,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' && {
      display: 'flex' as any,
      flexDirection: 'column' as any,
      height: '100vh' as any,
      overflow: 'hidden' as any,
    }),
  },
  scrollView: {
    flex: 1,
    ...(Platform.OS === 'web' && {
      overflow: 'auto' as any,
      flexShrink: 1,
    }),
  },
  scrollContent: {
    paddingBottom: 100,
    flexGrow: 1,
    ...(Platform.OS === 'web' && {
      height: '0px' as any,
    }),
  },
  section: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 20,
    padding: 16,
    borderRadius: 14,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  sectionIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.infoBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 0,
  },
  helperText: {
    fontSize: 13,
    color: colors.onSurface,
    marginBottom: 16,
  },
  input: {
    marginBottom: 16,
  },
  recentCustomersContainer: {
    marginBottom: 16,
    paddingVertical: 8,
  },
  recentLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
    marginBottom: 8,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  customerChip: {
    marginRight: 8,
    marginBottom: 8,
  },
  suggestionsCard: {
    marginBottom: 16,
    marginTop: -8,
    elevation: 4,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  suggestionsContent: {
    padding: 0,
  },
  suggestionsHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.onSurface,
    marginBottom: 8,
    marginTop: 8,
    marginLeft: 8,
  },
  suggestionDivider: {
    marginVertical: 4,
  },
  suggestionItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  suggestionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  suggestionMain: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  suggestionIcon: {
    marginRight: 12,
  },
  suggestionText: {
    flex: 1,
  },
  suggestionName: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 2,
  },
  suggestionDetail: {
    fontSize: 12,
    color: colors.onSurface,
  },
});
