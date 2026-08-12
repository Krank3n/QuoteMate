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
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import {
  Text,
  Surface,
  Title,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { makeStyles, useThemeColors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal, AlertType } from '../../components/AlertModal';
import { GridBackground } from '../../components/GridBackground';

type FeedbackCategory = 'hate' | 'buggy' | 'missing' | 'confusing' | 'other';

const CATEGORIES: { id: FeedbackCategory; label: string; icon: string }[] = [
  { id: 'hate', label: 'Something I hate', icon: 'thumb-down' },
  { id: 'buggy', label: 'Something is broken', icon: 'bug' },
  { id: 'missing', label: 'Missing feature', icon: 'puzzle' },
  { id: 'confusing', label: 'Confusing / hard to use', icon: 'help-circle' },
  { id: 'other', label: 'Other feedback', icon: 'message-text' },
];

export function FeedbackScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [selectedCategory, setSelectedCategory] = useState<FeedbackCategory | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [sending, setSending] = useState(false);
  const [modal, setModal] = useState<{ visible: boolean; type: AlertType; title: string; message: string }>({
    visible: false, type: 'info', title: '', message: '',
  });

  const showModal = (type: AlertType, title: string, message: string) => {
    setModal({ visible: true, type, title, message });
  };

  const handleSendFeedback = async () => {
    if (!feedbackText.trim()) {
      showModal('warning', 'Hold on', 'Please write some feedback before sending.');
      return;
    }

    const categoryLabel = CATEGORIES.find(c => c.id === selectedCategory)?.label || 'General';

    setSending(true);
    try {
      const functions = getFunctions();
      const submitFeedback = httpsCallable(functions, 'submitFeedback');
      await submitFeedback({ category: categoryLabel, feedback: feedbackText.trim() });

      showModal('success', 'Feedback Sent!', 'Thanks for taking the time. We read every single message.');
      setFeedbackText('');
      setSelectedCategory(null);
    } catch (error: any) {
      showModal('error', 'Failed to Send', 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <GridBackground />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          {/* WhatsApp quick feedback */}
          <TouchableOpacity
            style={styles.whatsappCard}
            onPress={() => Linking.openURL('https://api.whatsapp.com/send/?phone=61480232922&text=Hey%20Tom%21%20Got%20some%20feedback%20about%20QuoteMate%3A%20&type=phone_number&app_absent=0')}
            activeOpacity={0.8}
          >
            <View style={styles.whatsappCardLeft}>
              <View style={styles.whatsappIconCircle}>
                <MaterialCommunityIcons name="whatsapp" size={28} color="#ffffff" />
              </View>
              <View style={styles.whatsappCardText}>
                <Text style={styles.whatsappCardTitle}>Message me directly</Text>
                <Text style={styles.whatsappCardSubtitle}>Fastest way to get your feedback heard — I reply to every message</Text>
              </View>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color="#25D366" />
          </TouchableOpacity>

          {/* Hero / Call to action */}
          <Surface style={styles.heroCard}>
            <MaterialCommunityIcons name="bullhorn" size={48} color={themeColors.accentText} />
            <Title style={styles.heroTitle}>We want your honest feedback</Title>
            <Text style={styles.heroText}>
              Don't hold back. Tell us what you hate, what's broken, or what's missing.
              We genuinely want to hear the stuff that frustrates you.
            </Text>
            <View style={styles.promiseBadge}>
              <MaterialCommunityIcons name="lightning-bolt" size={18} color={themeColors.warning} />
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
                    color={selectedCategory === cat.id ? themeColors.alwaysLight : themeColors.accent}
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
              placeholderTextColor={themeColors.textMuted}
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
              (!feedbackText.trim() || sending) && styles.sendButtonDisabled,
            ]}
            onPress={handleSendFeedback}
            activeOpacity={0.8}
            disabled={sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color={themeColors.onAccent} />
            ) : (
              <MaterialCommunityIcons name="send" size={20} color={themeColors.onAccent} />
            )}
            <Text style={styles.sendButtonText}>{sending ? 'Sending...' : 'Send Feedback'}</Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            Your feedback goes straight to the developer. No bots, no ticket queues.
            We read every single message.
          </Text>
        </WebContainer>
      </ScrollView>

      <AlertModal
        visible={modal.visible}
        onDismiss={() => setModal(m => ({ ...m, visible: false }))}
        type={modal.type}
        title={modal.title}
        message={modal.message}
        showConfetti={modal.type === 'success'}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  whatsappCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#25D366' + '15',
    borderWidth: 2,
    borderColor: '#25D366' + '40',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  whatsappCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 14,
  },
  whatsappIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
  },
  whatsappCardText: {
    flex: 1,
  },
  whatsappCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#25D366',
    marginBottom: 2,
  },
  whatsappCardSubtitle: {
    fontSize: 13,
    color: '#25D366' + 'BB',
    lineHeight: 18,
  },
  heroCard: {
    padding: 24,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
    alignItems: 'center',
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: t.colors.text,
    textAlign: 'center',
    marginTop: 12,
  },
  heroText: {
    fontSize: 15,
    color: t.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
  },
  promiseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.warningSubtle,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 16,
  },
  promiseText: {
    fontSize: 13,
    fontWeight: '700',
    color: t.colors.warning,
    marginLeft: 6,
  },
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
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
    borderColor: t.colors.accentSubtle,
    backgroundColor: t.colors.accentSubtle,
  },
  categoryChipSelected: {
    backgroundColor: t.colors.accent,
    borderColor: t.colors.accent,
  },
  categoryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.accentText,
    marginLeft: 6,
  },
  categoryLabelSelected: {
    color: t.colors.onAccent,
  },
  hint: {
    fontSize: 14,
    color: t.colors.textSecondary,
    marginBottom: 12,
  },
  textInput: {
    backgroundColor: t.colors.bg,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: t.colors.text,
    minHeight: 140,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...(Platform.OS === 'web' && {
      outlineStyle: 'none' as any,
    }),
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.accent,
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
    color: t.colors.onAccent,
  },
  footnote: {
    fontSize: 12,
    color: t.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
  },
}));
