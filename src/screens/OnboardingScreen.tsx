/**
 * Onboarding Screen
 * First-time setup for business details and default rates
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Text,
  TextInput,
  Button,
  Surface,
  Title,
  Paragraph,
} from 'react-native-paper';
import { useStore } from '../store/useStore';
import { BusinessSettings } from '../types';
import { colors } from '../theme';

export function OnboardingScreen() {
  const { setBusinessSettings, setOnboarded } = useStore();

  const [businessName, setBusinessName] = useState('');
  const [abn, setAbn] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [laborRate, setLaborRate] = useState('85');
  const [markup, setMarkup] = useState('20');
  const [isLoading, setIsLoading] = useState(false);

  const handleComplete = async () => {
    if (!businessName.trim()) {
      alert('Please enter your business name');
      return;
    }

    const settings: BusinessSettings = {
      businessName: businessName.trim(),
      abn: abn.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      defaultLaborRate: parseFloat(laborRate) || 85,
      defaultMarkup: parseFloat(markup) || 20,
    };

    try {
      setIsLoading(true);
      await setBusinessSettings(settings);
      await setOnboarded(true);
    } catch (error) {
      alert('Failed to save settings. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.contentWrapper}>
          <View style={styles.header}>
            <Title style={styles.title}>Welcome to QuoteMate</Title>
            <Paragraph style={styles.subtitle}>
              Let's set up your business details
            </Paragraph>
          </View>

          <Surface style={styles.card}>
          <Text style={styles.sectionTitle}>Business Information</Text>

          <TextInput
            label="Business Name *"
            value={businessName}
            onChangeText={setBusinessName}
            mode="outlined"
            style={styles.input}
            placeholder="e.g., Smith's Carpentry"
          />

          <TextInput
            label="ABN (Optional)"
            value={abn}
            onChangeText={setAbn}
            mode="outlined"
            style={styles.input}
            placeholder="12 345 678 910"
            keyboardType="numeric"
          />

          <TextInput
            label="Email (Optional)"
            value={email}
            onChangeText={setEmail}
            mode="outlined"
            style={styles.input}
            placeholder="your.email@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <TextInput
            label="Phone (Optional)"
            value={phone}
            onChangeText={setPhone}
            mode="outlined"
            style={styles.input}
            placeholder="0412 345 678"
            keyboardType="phone-pad"
          />
        </Surface>

        <Surface style={styles.card}>
          <Text style={styles.sectionTitle}>Default Rates</Text>
          <Paragraph style={styles.helperText}>
            You can change these for each quote
          </Paragraph>

          <TextInput
            label="Hourly Labor Rate ($)"
            value={laborRate}
            onChangeText={setLaborRate}
            mode="outlined"
            style={styles.input}
            keyboardType="decimal-pad"
            left={<TextInput.Affix text="$" />}
            right={<TextInput.Affix text="/hr" />}
          />

          <TextInput
            label="Markup Percentage (%)"
            value={markup}
            onChangeText={setMarkup}
            mode="outlined"
            style={styles.input}
            keyboardType="decimal-pad"
            right={<TextInput.Affix text="%" />}
          />
        </Surface>

          <Button
            mode="contained"
            onPress={handleComplete}
            style={styles.button}
            loading={isLoading}
            disabled={isLoading}
          >
            Get Started
          </Button>
        </View>
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
    alignItems: 'center',
  },
  contentWrapper: {
    width: '100%',
    maxWidth: 800,
  },
  header: {
    marginBottom: 24,
    marginTop: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.onSurface,
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
    color: colors.text,
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
});
