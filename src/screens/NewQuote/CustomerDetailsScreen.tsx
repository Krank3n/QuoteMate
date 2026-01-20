/**
 * Customer Details Screen
 * Second step: Enter customer information with smart auto-complete
 */

import React, { useState, useEffect, useMemo } from 'react';
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
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';

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
  const documentList = useDocumentList();

  // For compatibility, alias to currentQuote (used throughout this file)
  const currentQuote = currentDocument;
  const updateQuote = updateDocument;
  // Use combined document list for customer auto-complete
  const quotes = documentList;

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

  // Load existing customer data if editing
  useEffect(() => {
    if (currentQuote) {
      setCustomerName(currentQuote.customerName || '');
      setCustomerEmail(currentQuote.customerEmail || '');
      setCustomerPhone(currentQuote.customerPhone || '');
      setJobAddress(currentQuote.jobAddress || '');
    }
  }, [currentQuote]);

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
    };

    updateQuote(updatedQuote);
    navigation.navigate('MaterialsList');
  };

  if (!currentQuote) {
    return null;
  }

  const recentCustomers = pastCustomers.slice(0, 3);
  const showRecentCustomers = !showSuggestions && customerName.length === 0 && recentCustomers.length > 0;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <WebContainer>
          <Surface style={styles.section}>
            <View style={styles.sectionTitleContainer}>
              <MaterialCommunityIcons
                name="account"
                size={24}
                color={colors.primary}
                style={styles.sectionIcon}
              />
              <Title style={styles.sectionTitle}>Customer Details</Title>
            </View>

            <Text style={styles.helperText}>
              Enter customer information or select from recent customers below.
            </Text>

            {/* Recent Customers - Show when input is empty */}
            {showRecentCustomers && (
              <View style={styles.recentCustomersContainer}>
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
      maxWidth: 800,
      margin: 'auto' as any,
      width: '100%',
      height: '0px' as any,
    }),
  },
  section: {
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 20,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionIcon: {
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
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
