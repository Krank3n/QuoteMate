/**
 * Feedback Screen
 * Encourages users to share what they hate or want changed,
 * and sends feedback via email.
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import {
  Text,
  Surface,
  Title,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';

const FEEDBACK_EMAIL = 'thomas.andrew.hansen@gmail.com';

type FeedbackCategory = 'hate' | 'buggy' | 'missing' | 'confusing' | 'other';

const CATEGORIES: { id: FeedbackCategory; label: string; icon: string }[] = [
  { id: 'hate', label: 'Something I hate', icon: 'thumb-down' },
  { id: 'buggy', label: 'Something is broken', icon: 'bug' },
  { id: 'missing', label: 'Missing feature', icon: 'puzzle' },
  { id: 'confusing', label: 'Confusing / hard to use', icon: 'help-circle' },
  { id: 'other', label: 'Other feedback', icon: 'message-text' },
];

export function FeedbackScreen() {
  const [selectedCategory, setSelectedCategory] = useState<FeedbackCategory | null>(null);
  const [feedbackText, setFeedbackText] = useState('');

  const handleSendFeedback = () => {
    if (!feedbackText.trim()) {
      Alert.alert('Hold on', 'Please write some feedback before sending.');
      return;
    }

    const categoryLabel = CATEGORIES.find(c => c.id === selectedCategory)?.label || 'General';
    const subject = encodeURIComponent(`QuoteMate Feedback: ${categoryLabel}`);
    const body = encodeURIComponent(
      `Category: ${categoryLabel}\n\n${feedbackText.trim()}\n\n---\nSent from QuoteMate app`
    );

    const mailtoUrl = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;

    Linking.openURL(mailtoUrl).catch(() => {
      Alert.alert(
        'Could not open email',
        `Please send your feedback directly to ${FEEDBACK_EMAIL}`,
      );
    });
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          {/* Hero / Call to action */}
          <Surface style={styles.heroCard}>
            <MaterialCommunityIcons name="bullhorn" size={48} color={colors.primary} />
            <Title style={styles.heroTitle}>We want your honest feedback</Title>
            <Text style={styles.heroText}>
              Don't hold back. Tell us what you hate, what's broken, or what's missing.
              We genuinely want to hear the stuff that frustrates you.
            </Text>
            <View style={styles.promiseBadge}>
              <MaterialCommunityIcons name="lightning-bolt" size={18} color={colors.secondary} />
              <Text style={styles.promiseText}>
                Good suggestions get shipped within 1 week
              </Text>
            </View>
          </Surface>

          {/* Category selection */}
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>What's this about?</Title>
            <View style={styles.categoryGrid}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.categoryChip,
                    selectedCategory === cat.id && styles.categoryChipSelected,
                  ]}
                  onPress={() => setSelectedCategory(cat.id)}
                >
                  <MaterialCommunityIcons
                    name={cat.icon as any}
                    size={20}
                    color={selectedCategory === cat.id ? colors.white : colors.primary}
                  />
                  <Text
                    style={[
                      styles.categoryLabel,
                      selectedCategory === cat.id && styles.categoryLabelSelected,
                    ]}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Surface>

          {/* Feedback text */}
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Tell us everything</Title>
            <Text style={styles.hint}>
              Be as blunt as you want. The more detail, the faster we can fix it.
            </Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. I hate that I can't... / It would be way better if... / This thing keeps breaking when..."
              placeholderTextColor={colors.onSurface + '80'}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              value={feedbackText}
              onChangeText={setFeedbackText}
            />
          </Surface>

          {/* Send button */}
          <TouchableOpacity
            style={[
              styles.sendButton,
              !feedbackText.trim() && styles.sendButtonDisabled,
            ]}
            onPress={handleSendFeedback}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="send" size={20} color={colors.white} />
            <Text style={styles.sendButtonText}>Send Feedback</Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            Your feedback goes straight to the developer. No bots, no ticket queues.
            We read every single message.
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
  heroCard: {
    padding: 24,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginTop: 12,
  },
  heroText: {
    fontSize: 15,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
  },
  promiseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondary + '15',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 16,
  },
  promiseText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.secondary,
    marginLeft: 6,
  },
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.primary + '40',
    backgroundColor: colors.primary + '08',
  },
  categoryChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
    marginLeft: 6,
  },
  categoryLabelSelected: {
    color: colors.white,
  },
  hint: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 12,
  },
  textInput: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: colors.text,
    minHeight: 140,
    borderWidth: 1,
    borderColor: colors.outline + '30',
    ...(Platform.OS === 'web' && {
      outlineStyle: 'none' as any,
    }),
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 12,
    gap: 8,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  footnote: {
    fontSize: 12,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
  },
});
