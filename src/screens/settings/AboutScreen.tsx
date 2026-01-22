/**
 * About Screen
 * App version and information
 */

import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Linking,
  TouchableOpacity,
} from 'react-native';
import {
  Text,
  Surface,
  Title,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Constants from 'expo-constants';

import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';

export function AboutScreen() {
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const buildNumber = Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || '1';

  const handleLinkPress = (url: string) => {
    Linking.openURL(url);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          <Surface style={styles.card}>
            <View style={styles.logoContainer}>
              <MaterialCommunityIcons name="file-document-edit" size={64} color={colors.primary} />
              <Text style={styles.appName}>QuoteMate</Text>
              <Text style={styles.tagline}>Professional Quoting Made Easy</Text>
            </View>

            <View style={styles.versionInfo}>
              <View style={styles.versionRow}>
                <Text style={styles.versionLabel}>Version</Text>
                <Text style={styles.versionValue}>{appVersion}</Text>
              </View>
              <View style={styles.versionRow}>
                <Text style={styles.versionLabel}>Build</Text>
                <Text style={styles.versionValue}>{buildNumber}</Text>
              </View>
            </View>
          </Surface>

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>About</Title>
            <Text style={styles.description}>
              QuoteMate is a quoting tool designed specifically for Australian tradies.
              With AI-powered job analysis and Bunnings integration, creating professional
              quotes has never been easier.
            </Text>

            <View style={styles.featureList}>
              <View style={styles.featureItem}>
                <MaterialCommunityIcons name="robot" size={20} color={colors.primary} />
                <Text style={styles.featureText}>AI-powered job analysis</Text>
              </View>
              <View style={styles.featureItem}>
                <MaterialCommunityIcons name="store" size={20} color={colors.primary} />
                <Text style={styles.featureText}>Bunnings price integration</Text>
              </View>
              <View style={styles.featureItem}>
                <MaterialCommunityIcons name="file-pdf-box" size={20} color={colors.primary} />
                <Text style={styles.featureText}>Professional PDF quotes</Text>
              </View>
              <View style={styles.featureItem}>
                <MaterialCommunityIcons name="cloud-sync" size={20} color={colors.primary} />
                <Text style={styles.featureText}>Cloud sync across devices</Text>
              </View>
            </View>
          </Surface>

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Support</Title>

            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => handleLinkPress('mailto:support@quotemate.app')}
            >
              <MaterialCommunityIcons name="email-outline" size={20} color={colors.primary} />
              <Text style={styles.linkText}>Contact Support</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurface} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => handleLinkPress('https://quotemate.app/privacy')}
            >
              <MaterialCommunityIcons name="shield-lock-outline" size={20} color={colors.primary} />
              <Text style={styles.linkText}>Privacy Policy</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurface} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => handleLinkPress('https://quotemate.app/terms')}
            >
              <MaterialCommunityIcons name="file-document-outline" size={20} color={colors.primary} />
              <Text style={styles.linkText}>Terms of Service</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurface} />
            </TouchableOpacity>
          </Surface>

          <Text style={styles.copyright}>
            © 2024-2025 Hansen Dev. All rights reserved.
          </Text>
        </WebContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  logoContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.primary,
    marginTop: 12,
  },
  tagline: {
    fontSize: 15,
    color: colors.onSurface,
    marginTop: 4,
  },
  versionInfo: {
    borderTopWidth: 1,
    borderTopColor: colors.outline + '30',
    paddingTop: 16,
    marginTop: 8,
  },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  versionLabel: {
    fontSize: 15,
    color: colors.onSurface,
  },
  versionValue: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    color: colors.onSurface,
    lineHeight: 22,
    marginBottom: 20,
  },
  featureList: {
    gap: 12,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    fontSize: 15,
    color: colors.text,
    marginLeft: 12,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.outline + '20',
  },
  linkText: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    marginLeft: 12,
  },
  copyright: {
    textAlign: 'center',
    fontSize: 13,
    color: colors.onSurface,
    marginTop: 8,
  },
});
