/**
 * About Screen
 * App version and information
 */

import React, { useEffect, useState } from 'react';
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
  Button,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { auth } from '../../config/firebase';

type BackfillSummary = {
  usersProcessed: number;
  quotesMirrored: number;
  invoicesMirrored: number;
  skipped: number;
  errors: number;
  errorSamples?: Array<{ userId: string; kind: string; error: string }>;
};

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
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const buildNumber = Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || '1';

  const [isAdmin, setIsAdmin] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [backfillResult, setBackfillResult] = useState<BackfillSummary | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    user.getIdTokenResult()
      .then((tr) => setIsAdmin(tr.claims?.admin === true))
      .catch(() => setIsAdmin(false));
  }, []);

  const runBackfill = async () => {
    setBackfillStatus('running');
    setBackfillError(null);
    setBackfillResult(null);
    try {
      const fn = httpsCallable<unknown, BackfillSummary>(getFunctions(), 'mirrorAllDocuments');
      const res = await fn({});
      setBackfillResult(res.data);
      setBackfillStatus('done');
    } catch (err: any) {
      setBackfillError(err?.message || String(err));
      setBackfillStatus('error');
    }
  };

  const handleLinkPress = (url: string) => {
    Linking.openURL(url);
  };

  return (
    <View style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          {/* Hero Section */}
          <LinearGradient
            colors={['#064E3B', '#0F172A']}
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
                      color={colors.primary}
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
                    color={colors.primary}
                  />
                </View>
                <Text style={styles.linkText}>{link.text}</Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={colors.placeholder}
                />
              </TouchableOpacity>
            ))}
          </Surface>

          {isAdmin && (
            <Surface style={styles.card}>
              <Text style={styles.sectionTitle}>Admin tools</Text>
              <Text style={styles.description}>
                Backfill the unified documents collection from existing quotes
                and invoices. Safe to re-run.
              </Text>
              <Button
                mode="contained"
                onPress={runBackfill}
                loading={backfillStatus === 'running'}
                disabled={backfillStatus === 'running'}
                style={styles.adminButton}
              >
                {backfillStatus === 'running' ? 'Running…' : 'Run documents backfill'}
              </Button>
              {backfillResult && (
                <View style={styles.adminResult}>
                  <Text style={styles.adminResultLine}>
                    Users processed: {backfillResult.usersProcessed}
                  </Text>
                  <Text style={styles.adminResultLine}>
                    Quotes mirrored: {backfillResult.quotesMirrored}
                  </Text>
                  <Text style={styles.adminResultLine}>
                    Invoices mirrored: {backfillResult.invoicesMirrored}
                  </Text>
                  <Text style={styles.adminResultLine}>
                    Skipped (up-to-date): {backfillResult.skipped}
                  </Text>
                  <Text style={styles.adminResultLine}>
                    Errors: {backfillResult.errors}
                  </Text>
                </View>
              )}
              {backfillError && (
                <Text style={styles.adminError}>{backfillError}</Text>
              )}
            </Surface>
          )}

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  adminButton: {
    marginTop: 12,
  },
  adminResult: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  adminResultLine: {
    fontSize: 13,
    color: colors.text,
    marginBottom: 4,
    fontFamily: 'monospace',
  },
  adminError: {
    marginTop: 12,
    color: colors.error,
    fontSize: 13,
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
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  tagline: {
    fontSize: 15,
    color: colors.onSurface,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  versionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  versionBadgeText: {
    fontSize: 13,
    color: colors.onSurface,
    fontWeight: '500',
  },
  versionDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginHorizontal: 8,
  },

  // Cards
  card: {
    padding: 20,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
  },
  description: {
    fontSize: 14,
    color: colors.onSurface,
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
    backgroundColor: colors.surfaceGray3,
    borderRadius: 12,
    padding: 14,
  },
  featureIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  featureText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    flex: 1,
  },

  // Links
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.outline + '15',
  },
  linkRowLast: {
    borderBottomWidth: 0,
  },
  linkIconContainer: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  linkText: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
  },

  // Footer
  footer: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 4,
  },
  madeWith: {
    fontSize: 13,
    color: colors.onSurface,
  },
  copyright: {
    fontSize: 12,
    color: colors.placeholder,
  },
});
