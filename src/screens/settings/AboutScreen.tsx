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
  Image,
} from 'react-native';
import {
  Text,
  Surface,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';

import { makeStyles, useThemeColors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { GridBackground } from '../../components/GridBackground';

const features = [
  { icon: 'robot' as const, text: 'AI-powered job analysis' },
  { icon: 'store' as const, text: 'Live price integration' },
  { icon: 'file-pdf-box' as const, text: 'Professional PDF quotes' },
  { icon: 'cloud-sync' as const, text: 'Cloud sync across devices' },
];

const supportLinks = [
  {
    icon: 'email-outline' as const,
    text: 'Contact Support',
    url: 'mailto:tom@hansendev.com.au',
  },
  {
    icon: 'shield-lock-outline' as const,
    text: 'Privacy Policy',
    url: 'https://hansendev.com.au/projects/quotemate-privacy',
  },
  {
    icon: 'file-document-outline' as const,
    text: 'Terms of Service',
    url: 'https://hansendev.com.au/projects/quotemate-terms',
  },
];

export function AboutScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const buildNumber = Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || '1';

  const handleLinkPress = (url: string) => {
    Linking.openURL(url);
  };

  return (
    <View style={styles.container}>
      <GridBackground />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          {/* Hero Section */}
          <LinearGradient
            colors={[themeColors.surfaceRaised, themeColors.bg]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.heroGradient}
          >
            <Image
              source={require('../../../assets/logo-scaled.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.appName}>QuoteMate</Text>
            <Text style={styles.tagline}>Professional Quoting Made Easy</Text>

            <View style={styles.versionBadge}>
              <Text style={styles.versionBadgeText}>v{appVersion}</Text>
              <View style={styles.versionDot} />
              <Text style={styles.versionBadgeText}>Build {buildNumber}</Text>
            </View>
          </LinearGradient>

          {/* Features Section */}
          <Surface style={styles.card}>
            <Text style={styles.sectionTitle}>What we offer</Text>
            <Text style={styles.description}>
              Built specifically for Australian tradies. AI-powered job analysis
              and Bunnings integration make professional quoting effortless.
            </Text>

            <View style={styles.featureGrid}>
              {features.map((feature) => (
                <View key={feature.icon} style={styles.featureCard}>
                  <View style={styles.featureIconContainer}>
                    <MaterialCommunityIcons
                      name={feature.icon}
                      size={22}
                      color={themeColors.accentText}
                    />
                  </View>
                  <Text style={styles.featureText}>{feature.text}</Text>
                </View>
              ))}
            </View>
          </Surface>

          {/* Support Section */}
          <Surface style={styles.card}>
            <Text style={styles.sectionTitle}>Support</Text>

            {supportLinks.map((link, index) => (
              <TouchableOpacity
                key={link.url}
                style={[
                  styles.linkRow,
                  index === supportLinks.length - 1 && styles.linkRowLast,
                ]}
                onPress={() => handleLinkPress(link.url)}
                activeOpacity={0.6}
              >
                <View style={styles.linkIconContainer}>
                  <MaterialCommunityIcons
                    name={link.icon}
                    size={18}
                    color={themeColors.accentText}
                  />
                </View>
                <Text style={styles.linkText}>{link.text}</Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={themeColors.textDisabled}
                />
              </TouchableOpacity>
            ))}
          </Surface>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.madeWith}>
              Made with {'❤️'} in Australia
            </Text>
            <Text style={styles.copyright}>
              © 2024–2026 Hansen Dev
            </Text>
          </View>
        </WebContainer>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  scrollContent: {
    paddingBottom: 32,
  },

  // Hero
  heroGradient: {
    alignItems: 'center',
    paddingTop: 36,
    paddingBottom: 28,
    marginBottom: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 16,
  },
  appName: {
    fontSize: 32,
    fontWeight: '800',
    color: t.colors.text,
    letterSpacing: 0.5,
  },
  tagline: {
    fontSize: 15,
    color: t.colors.textSecondary,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  versionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaceOverlay,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  versionBadgeText: {
    fontSize: 13,
    color: t.colors.textSecondary,
    fontWeight: '500',
  },
  versionDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.colors.accent,
    marginHorizontal: 8,
  },

  // Cards
  card: {
    padding: 20,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: t.colors.text,
    marginBottom: 10,
  },
  description: {
    fontSize: 14,
    color: t.colors.textSecondary,
    lineHeight: 21,
    marginBottom: 20,
  },

  // Features
  featureGrid: {
    gap: 10,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfacePressed,
    borderRadius: 12,
    padding: 14,
  },
  featureIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  featureText: {
    fontSize: 14,
    fontWeight: '500',
    color: t.colors.text,
    flex: 1,
  },

  // Links
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  linkRowLast: {
    borderBottomWidth: 0,
  },
  linkIconContainer: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  linkText: {
    flex: 1,
    fontSize: 15,
    color: t.colors.text,
  },

  // Footer
  footer: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 4,
  },
  madeWith: {
    fontSize: 13,
    color: t.colors.textSecondary,
  },
  copyright: {
    fontSize: 12,
    color: t.colors.textDisabled,
  },
}));
