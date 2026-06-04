/**
 * CallKatieScreen
 *
 * Settings → Integrations → "Never Miss a Call". Pitches the call-answering
 * service (Katie) and captures interest. The real phone setup is done by hand
 * for the first customers, so this screen's job is to explain the benefit and
 * collect enough detail for the founder to follow up — it doesn't wire up any
 * call routing itself.
 *
 * Copy rule: describe what Katie *does* for the tradie. Never call it "AI".
 */
import React, { useState } from 'react';
import {
  View,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Text, Surface, Title, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { RangeSlider } from '../../components/RangeSlider';
import { AlertModal, AlertType } from '../../components/AlertModal';
import { useStore } from '../../store/useStore';
import { submitLeadInterest } from '../../services/leadInterest';

// "Missed money" calculator defaults/bounds. Tuned for a typical tradie:
// a handful of missed calls a week, a job worth a few hundred up to several
// grand. The headline figure assumes only a share of missed callers would've
// gone ahead — conservative on purpose so the number stays believable.
const MISSED_CALLS_DEFAULT = 5;
const MISSED_CALLS_MAX = 25;
const JOB_VALUE_DEFAULT = 850;
const JOB_VALUE_MIN = 200;
const JOB_VALUE_MAX = 10000;
const JOB_VALUE_STEP = 50;
const WIN_RATE = 1 / 3; // even 1 in 3 of those callers would've booked the job

/** Group digits with commas, no decimals: 73667 -> "$73,667". */
function formatMoney(n: number): string {
  return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function CallKatieScreen() {
  const businessSettings = useStore((s) => s.businessSettings);

  const [businessName, setBusinessName] = useState(businessSettings?.businessName || '');
  const [contactPhone, setContactPhone] = useState(businessSettings?.phone || '');
  const [missedPerWeek, setMissedPerWeek] = useState(MISSED_CALLS_DEFAULT);
  const [jobValue, setJobValue] = useState(JOB_VALUE_DEFAULT);
  const [notes, setNotes] = useState('');

  // Live "what missed calls cost you" maths. Round the year to the nearest
  // $100 and the month to the nearest $50 so the figures read clean as the
  // sliders move.
  const lostPerYearRaw = missedPerWeek * 52 * jobValue * WIN_RATE;
  const lostPerYear = Math.round(lostPerYearRaw / 100) * 100;
  const lostPerMonth = Math.round(lostPerYearRaw / 12 / 50) * 50;
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [modal, setModal] = useState<{ visible: boolean; type: AlertType; title: string; message: string }>({
    visible: false, type: 'info', title: '', message: '',
  });

  const showModal = (type: AlertType, title: string, message: string) =>
    setModal({ visible: true, type, title, message });

  const handleSubmit = async () => {
    if (!contactPhone.trim()) {
      showModal('warning', 'Hold on', 'Pop in the best number to reach you on so we can get Katie set up.');
      return;
    }

    setSending(true);
    try {
      await submitLeadInterest({
        businessName: businessName.trim(),
        contactPhone: contactPhone.trim(),
        missedCalls: `${missedPerWeek} a week`,
        typicalJobValue: jobValue,
        estLostPerYear: lostPerYear,
        notes: notes.trim() || undefined,
      });
      setSubmitted(true);
    } catch {
      showModal('error', 'Didn’t go through', 'Something went wrong sending that. Give it another crack in a sec.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
        <WebContainer>
          {/* Hero */}
          <Surface style={styles.heroCard}>
            <Image
              source={require('../../../assets/callkatie-logo.png')}
              style={styles.heroLogo}
              resizeMode="contain"
            />
            <Title style={styles.heroTitle}>Never miss a call</Title>
            <Text style={styles.heroBrand}>Powered by CallKatie</Text>
            <Text style={styles.heroText}>
              Katie answers the calls you can’t get to — takes down the job, the address and the
              customer’s number, so a missed call never means a missed job.
            </Text>
          </Surface>

          {/* How it works */}
          <Surface style={styles.infoCard}>
            <Text style={styles.infoTitle}>How it works</Text>
            <InfoRow
              icon="phone-ring"
              title="She picks up when you can’t"
              body="On the tools, up a ladder or driving? Katie answers in your business name so nobody gets bounced to voicemail."
            />
            <InfoRow
              icon="clipboard-text"
              title="Takes down the job"
              body="She gets the customer’s name, number and what they’re after, so you’ve got the lead written up ready to quote."
            />
            <InfoRow
              icon="phone-forward"
              title="Rings through on your own number"
              body="We point Katie at the mobile you already use — your customers ring the same number they always have."
            />
          </Surface>

          {/* Interest form OR submitted confirmation */}
          {submitted ? (
            <Surface style={styles.doneCard}>
              <View style={styles.doneIcon}>
                <MaterialCommunityIcons name="check-bold" size={28} color={colors.success} />
              </View>
              <Title style={styles.doneTitle}>You’re on the list!</Title>
              <Text style={styles.doneText}>
                Tom’ll be in touch soon to get Katie wired up to your number. Nothing to do for
                now — keep on the tools.
              </Text>
            </Surface>
          ) : (
            <Surface style={styles.card}>
              <Title style={styles.sectionTitle}>Keen to give it a crack?</Title>
              <Text style={styles.hint}>
                Pop your details in and Tom’ll give you a bell to get Katie set up on your number.
                No charge to have a chat.
              </Text>

              <TextInput
                label="Business name"
                mode="outlined"
                style={styles.input}
                value={businessName}
                onChangeText={setBusinessName}
              />

              <TextInput
                label="Best number to reach you"
                mode="outlined"
                style={styles.input}
                placeholder="04xx xxx xxx"
                keyboardType="phone-pad"
                value={contactPhone}
                onChangeText={setContactPhone}
              />

              {/* "Missed money" calculator — two sliders feed a live figure. */}
              <View style={styles.calcCard}>
                <View style={styles.calcHeader}>
                  <MaterialCommunityIcons name="cash-multiple" size={18} color={colors.secondary} />
                  <Text style={styles.calcTitle}>What missed calls cost you</Text>
                </View>

                <View style={styles.sliderRow}>
                  <View style={styles.sliderLabelRow}>
                    <Text style={styles.sliderLabel}>Calls you miss a week</Text>
                    <Text style={styles.sliderValue}>{missedPerWeek}</Text>
                  </View>
                  <RangeSlider
                    min={0}
                    max={MISSED_CALLS_MAX}
                    step={1}
                    value={missedPerWeek}
                    onChange={setMissedPerWeek}
                  />
                </View>

                <View style={styles.sliderRow}>
                  <View style={styles.sliderLabelRow}>
                    <Text style={styles.sliderLabel}>What a typical job’s worth</Text>
                    <Text style={styles.sliderValue}>
                      {formatMoney(jobValue)}{jobValue >= JOB_VALUE_MAX ? '+' : ''}
                    </Text>
                  </View>
                  <RangeSlider
                    min={JOB_VALUE_MIN}
                    max={JOB_VALUE_MAX}
                    step={JOB_VALUE_STEP}
                    value={jobValue}
                    onChange={setJobValue}
                  />
                </View>

                <View style={styles.resultPanel}>
                  <Text style={styles.resultLabel}>You could be missing out on</Text>
                  <Text style={styles.resultAmount}>{formatMoney(lostPerYear)}</Text>
                  <Text style={styles.resultPer}>
                    a year — about {formatMoney(lostPerMonth)} a month walking out the door
                  </Text>
                </View>

                <Text style={styles.calcCaption}>
                  Reckoned on even 1 in 3 of those callers booking the job. Katie answers them, so
                  you’re not the one who misses out.
                </Text>
              </View>

              <TextInput
                label="Anything else? (optional)"
                mode="outlined"
                style={styles.input}
                placeholder="e.g. I'm flat out mornings, best to call after 3"
                multiline
                numberOfLines={4}
                value={notes}
                onChangeText={setNotes}
              />

              <TouchableOpacity
                style={[styles.submitButton, (!contactPhone.trim() || sending) && styles.submitButtonDisabled]}
                onPress={handleSubmit}
                activeOpacity={0.8}
                disabled={sending}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <MaterialCommunityIcons name="phone-plus" size={20} color={colors.white} />
                )}
                <Text style={styles.submitButtonText}>{sending ? 'Sending…' : 'Register my interest'}</Text>
              </TouchableOpacity>
            </Surface>
          )}

          <Text style={styles.footnote}>
            Your details go straight to Tom, the developer. No call centres, no spam — just a hand
            getting it set up right.
          </Text>
        </WebContainer>
      </ScrollView>

      <AlertModal
        visible={modal.visible}
        onDismiss={() => setModal((m) => ({ ...m, visible: false }))}
        type={modal.type}
        title={modal.title}
        message={modal.message}
      />
    </View>
  );
}

function InfoRow({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoRowIcon}>
        <MaterialCommunityIcons name={icon as any} size={18} color={colors.primary} />
      </View>
      <View style={styles.infoRowBody}>
        <Text style={styles.infoRowTitle}>{title}</Text>
        <Text style={styles.infoRowText}>{body}</Text>
      </View>
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
    paddingBottom: 48,
  },
  heroCard: {
    padding: 24,
    marginBottom: 16,
    borderRadius: 16,
    elevation: 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  heroLogo: {
    width: 72,
    height: 72,
    borderRadius: 18,
    marginBottom: 12,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  heroBrand: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  heroText: {
    fontSize: 15,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
  },
  infoCard: {
    padding: 18,
    marginBottom: 16,
    borderRadius: 16,
    elevation: 2,
    backgroundColor: colors.surface,
    gap: 14,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 12,
  },
  infoRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRowBody: {
    flex: 1,
    gap: 2,
  },
  infoRowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  infoRowText: {
    fontSize: 13,
    color: colors.onSurface,
    lineHeight: 18,
  },
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 16,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  hint: {
    fontSize: 14,
    color: colors.onSurface,
    lineHeight: 20,
    marginTop: 4,
    marginBottom: 16,
  },
  input: {
    marginBottom: 16,
    backgroundColor: colors.surface,
  },
  calcCard: {
    marginTop: 4,
    marginBottom: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.outline + '30',
  },
  calcHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  calcTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  sliderRow: {
    marginTop: 14,
  },
  sliderLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  sliderLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurface,
  },
  sliderValue: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primary,
  },
  resultPanel: {
    marginTop: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surfaceDark,
    borderWidth: 1,
    borderColor: colors.secondary + '40',
    alignItems: 'center',
  },
  resultLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  resultAmount: {
    fontSize: 38,
    fontWeight: '800',
    color: colors.secondary,
    marginVertical: 2,
    letterSpacing: 0.5,
  },
  resultPer: {
    fontSize: 13,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 19,
  },
  calcCaption: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
    marginTop: 12,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 20,
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  doneCard: {
    padding: 24,
    marginBottom: 16,
    borderRadius: 16,
    elevation: 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  doneIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  doneTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  doneText: {
    fontSize: 14,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 6,
  },
  footnote: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
  },
});
