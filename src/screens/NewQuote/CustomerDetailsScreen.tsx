/**
 * Customer Details Screen
 * Second step: Enter customer information with smart auto-complete
 */

import React, { useState, useEffect, useRef } from 'react';
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
import { useNavigation, useRoute } from '@react-navigation/native';

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
import { useUnifiedContactSearch, SOURCE_COLORS } from '../../hooks/useUnifiedContactSearch';
import { SearchableContact } from '../../types';

export function CustomerDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isEditFromPreview = route.params?.editing === true;
  const mode = useDocumentMode();
  const { document: currentDocument, update: updateDocument } = useCurrentDocument();
  const { saveDraft, businessSettings, hasSeenScreenTour, unifiedTourActive, unifiedTourPhase, contacts, xeroContacts } = useStore();
  const documentList = useDocumentList();

  // For compatibility, alias to currentQuote (used throughout this file)
  const currentQuote = currentDocument;
  const updateQuote = updateDocument;
  // Use combined document list for customer auto-complete
  const quotes = documentList;

  // Tour refs
  const { registerRef } = useTourRefs();
  const customerNameRef = useRef<any>(null);
  const jobAddressRef = useRef<any>(null);
  const recentCustomersRef = useRef<View>(null);
  const [tourActive, setTourActive] = useState(false);
  // Only show Davo during the unified tour
  const showDavo = unifiedTourActive && unifiedTourPhase === 'customerDetails';

  useEffect(() => {
    if (customerNameRef.current) registerRef('customerName', customerNameRef.current);
    if (jobAddressRef.current) registerRef('jobAddress', jobAddressRef.current);
    if (recentCustomersRef.current) registerRef('recentCustomers', recentCustomersRef.current);
  });

  // Add contacts icon to header
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('Contacts')}
          style={{ marginRight: 12, padding: 4 }}
        >
          <MaterialCommunityIcons name="account-group" size={22} color={colors.white} />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [jobAddress, setJobAddress] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | undefined>(currentDocument?.contactId);

  // Unified contact search across all sources (auto-requests phone permission when typing)
  const { results: filteredCustomers } = useUnifiedContactSearch({
    query: customerName,
    contacts,
    quotes,
    xeroContacts,
  });

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
          contactId: selectedContactId,
          customerName: customerName.trim(),
          customerEmail: customerEmail.trim(),
          customerPhone: customerPhone.trim(),
          jobAddress: jobAddress.trim(),
        };
        updateQuote(updatedQuote);
      }
    });

    return unsubscribe;
  }, [navigation, currentQuote, customerName, customerEmail, customerPhone, jobAddress, selectedContactId, updateQuote]);

  const handleSelectCustomer = (customer: SearchableContact | { name: string; email?: string; phone?: string; address?: string; searchSource?: string; id?: string }) => {
    setCustomerName(customer.name);
    setCustomerEmail(customer.email || '');
    setCustomerPhone(customer.phone || '');
    setJobAddress(customer.address || '');
    setShowSuggestions(false);
    // Link to saved contact if it's from the saved source
    const source = 'searchSource' in customer ? customer.searchSource : undefined;
    if (source === 'saved' && 'id' in customer && customer.id) {
      setSelectedContactId(customer.id);
    } else {
      setSelectedContactId(undefined);
    }
  };

  const handleCustomerNameChange = (text: string) => {
    setCustomerName(text);
    setShowSuggestions(text.length > 0);
  };

  const handleSaveAndReturn = () => {
    if (!currentQuote || !customerName.trim()) return;
    const updatedQuote = {
      ...currentQuote,
      contactId: selectedContactId,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      customerPhone: customerPhone.trim(),
      jobAddress: jobAddress.trim(),
    };
    updateQuote(updatedQuote);
    saveDraft(updatedQuote);
    navigation.goBack();
  };

  const handleNext = () => {
    if (!currentQuote) return;

    if (!customerName.trim()) {
      return;
    }

    // Update quote with customer details
    const updatedQuote = {
      ...currentQuote,
      contactId: selectedContactId,
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
  const TOUR_CUSTOMER = {
    name: 'Davo Snagsworth',
    email: 'davo@snagsworth.com.au',
    phone: '0412 345 678',
    address: 'Sydney Opera House',
    searchSource: 'recent' as const,
  };

  // Recent contacts for chips (top 3 saved/recent contacts when input is empty)
  const recentForChips = filteredCustomers
    .filter((c) => c.searchSource === 'saved' || c.searchSource === 'recent')
    .slice(0, 3);
  const recentCustomers = showDavo
    ? [TOUR_CUSTOMER, ...recentForChips].slice(0, 3)
    : recentForChips;
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
                    <React.Fragment key={`${customer.searchSource}-${customer.id}-${index}`}>
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
                              {customer.businessName && (
                                <Text style={styles.suggestionBusiness}>{customer.businessName}</Text>
                              )}
                              {customer.phone && (
                                <Text style={styles.suggestionDetail}>{customer.phone}</Text>
                              )}
                              {customer.email && (
                                <Text style={styles.suggestionDetail}>{customer.email}</Text>
                              )}
                            </View>
                          </View>
                          <View style={styles.sourceTagRow}>
                            <Text style={[styles.sourceTag, { color: SOURCE_COLORS[customer.searchSource] }]}>
                              {customer.searchSource === 'saved' ? 'Saved' :
                               customer.searchSource === 'recent' ? 'Recent' :
                               customer.searchSource === 'xero' ? 'Xero' : 'Phone'}
                            </Text>
                            <MaterialCommunityIcons
                              name="chevron-right"
                              size={20}
                              color={colors.onSurface}
                            />
                          </View>
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
        label={isEditFromPreview ? 'Save' : 'Next: Materials'}
        onPress={isEditFromPreview ? handleSaveAndReturn : handleNext}
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
  suggestionBusiness: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
  },
  suggestionDetail: {
    fontSize: 12,
    color: colors.onSurface,
  },
  sourceTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sourceTag: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
