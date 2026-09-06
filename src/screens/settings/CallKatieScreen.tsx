/**
 * CallKatieScreen
 *
 * Settings → Integrations → "Never Miss a Call". Pitches the call-answering
 * service (Katie) and lets the tradie hear it for themselves: one tap and Katie
 * phones them within ~30 seconds, answering as THEIR business. After the demo
 * call fires we hand off to CallKatie signup with their details pre-filled.
 *
 * "Prefer to talk to Tom first?" keeps the older white-glove interest form
 * around as a secondary path (it emails the founder + stores the lead).
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
  Linking,
} from 'react-native';
// Not react-native's: under edge-to-edge Android no longer resizes the window
// for the keyboard, so RN's KeyboardAvoidingView does nothing there — and a
// screen with no wrapper at all is the same bug without the tell-tale. See
// components/keyboardAvoidance.guard.test.ts.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Text, Surface, Title, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { makeStyles, useThemeColors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { RangeSlider } from '../../components/RangeSlider';
import { AlertModal, AlertType } from '../../components/AlertModal';
import { useStore } from '../../store/useStore';
import { submitLeadInterest } from '../../services/leadInterest';
import { requestKatieDemoCall, getKatieSignupLink } from '../../services/callKatieDemo';
import { GridBackground } from '../../components/GridBackground';

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

// Where the demo flow can be: waiting to ring, ringing, done (heard it), or
// spent (hit the 2-call cap / partner rate limit). 'called' and 'limit' both
// surface the "start your trial" conversion step.
type DemoState = 'idle' | 'calling' | 'called' | 'limit';

export function CallKatieScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const businessSettings = useStore((s) => s.businessSettings);

  const [businessName, setBusinessName] = useState(businessSettings?.businessName || '');
  const [contactPhone, setContactPhone] = useState(businessSettings?.phone || '');
  const website = (businessSettings?.website || '').trim();
  const [missedPerWeek, setMissedPerWeek] = useState(MISSED_CALLS_DEFAULT);
  const [jobValue, setJobValue] = useState(JOB_VALUE_DEFAULT);
  const [notes, setNotes] = useState('');

  // Live "what missed calls cost you" maths. Round the year to the nearest
  // $100 and the month to the nearest $50 so the figures read clean as the
  // sliders move.
  const lostPerYearRaw = missedPerWeek * 52 * jobValue * WIN_RATE;
  const lostPerYear = Math.round(lostPerYearRaw / 100) * 100;
  const lostPerMonth = Math.round(lostPerYearRaw / 12 / 50) * 50;

  // Live demo state.
  const [demoState, setDemoState] = useState<DemoState>('idle');
  const [demoMessage, setDemoMessage] = useState('');
  const [signupUrl, setSignupUrl] = useState<string | null>(null);
  const [openingTrial, setOpeningTrial] = useState(false);

  // Secondary "talk to Tom" interest form.
  const [showInterest, setShowInterest] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [modal, setModal] = useState<{ visible: boolean; type: AlertType; title: string; message: string }>({
    visible: false, type: 'info', title: '', message: '',
  });
  const showModal = (type: AlertType, title: string, message: string) =>
    setModal({ visible: true, type, title, message });

  const handleDemoCall = async () => {
    if (!contactPhone.trim()) {
      showModal('warning', 'Hold on', 'Pop in the number for Katie to ring so you can hear her in action.');
      return;
    }

    setDemoState('calling');
    try {
      const result = await requestKatieDemoCall(contactPhone.trim());
      if (result.status === 'success') {
        setSignupUrl(result.signupUrl);
        setDemoState('called');
      } else if (result.status === 'limit') {
        setDemoMessage(result.message);
        setDemoState('limit');
      } else {
        setDemoState('idle');
        showModal('error', 'Didn’t go through', result.message);
      }
    } catch {
      setDemoState('idle');
      showModal('error', 'Didn’t go through', 'Couldn’t reach Katie just now. Give it another crack in a sec.');
    }
  };

  const handleStartTrial = async () => {
    setOpeningTrial(true);
    try {
      // Ask the server for a fresh handoff link — this also records the tap so
      // the recovery drip leaves them alone. Fall back to the URL we already
      // have from the demo call so a hiccup never blocks signup.
      let url: string;
      try {
        url = await getKatieSignupLink();
      } catch {
        if (!signupUrl) throw new Error('no-url');
        url = signupUrl;
      }
      await Linking.openURL(url);
    } catch {
      showModal('error', 'Couldn’t open signup', 'Something went wrong opening the trial. Give it another go shortly.');
    } finally {
      setOpeningTrial(false);
    }
  };

  const handleSubmitInterest = async () => {
    if (!contactPhone.trim()) {
      showModal('warning', 'Hold on', 'Pop in the best number to reach you on so Tom can get Katie set up.');
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

  const conversion = demoState === 'called' || demoState === 'limit';

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <GridBackground />
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

          {/* Primary: hear it for yourself — live demo call → conversion */}
          {conversion ? (
            <Surface style={styles.demoCard}>
              <View style={styles.demoIcon}>
                <MaterialCommunityIcons
                  name={demoState === 'called' ? 'phone-in-talk' : 'phone-check'}
                  size={28}
                  color={themeColors.accentText}
                />
              </View>
              {demoState === 'called' ? (
                <>
                  <Title style={styles.demoTitle}>Pick up — that’s Katie</Title>
                  <Text style={styles.demoText}>
                    She’s ringing {contactPhone.trim()} now, answering as{' '}
                    {businessName.trim() || 'your business'}. Have a chat with her, ask about a job —
                    that’s exactly what your customers will hear.
                  </Text>
                </>
              ) : (
                <>
                  <Title style={styles.demoTitle}>You’ve heard her in action</Title>
                  <Text style={styles.demoText}>{demoMessage}</Text>
                </>
              )}

              <View style={styles.convertPanel}>
                <Text style={styles.convertTitle}>Want her answering your real calls?</Text>
                <Text style={styles.convertText}>
                  Start your 14-day trial and Katie picks up every call you can’t.
                </Text>
                <TouchableOpacity
                  style={[styles.primaryButton, openingTrial && styles.buttonDisabled]}
                  onPress={handleStartTrial}
                  activeOpacity={0.85}
                  disabled={openingTrial}
                >
                  {openingTrial ? (
                    <ActivityIndicator size="small" color={themeColors.onAccent} />
                  ) : (
                    <MaterialCommunityIcons name="rocket-launch" size={20} color={themeColors.onAccent} />
                  )}
                  <Text style={styles.primaryButtonText}>
                    {openingTrial ? 'Opening…' : 'Start your 14-day trial'}
                  </Text>
                </TouchableOpacity>
              </View>
            </Surface>
          ) : (
            <Surface style={styles.demoCard}>
              <View style={styles.demoIcon}>
                <MaterialCommunityIcons name="phone-ring" size={28} color={themeColors.accentText} />
              </View>
              <Title style={styles.demoTitle}>Hear it for yourself</Title>
              <Text style={styles.demoText}>
                Tap below and Katie will call you in about 30 seconds — answering as your business,
                just like she would for a real customer.
              </Text>

              <TextInput
                label="Number for Katie to call"
                mode="outlined"
                style={styles.input}
                placeholder="04xx xxx xxx"
                keyboardType="phone-pad"
                value={contactPhone}
                onChangeText={setContactPhone}
                disabled={demoState === 'calling'}
              />

              {!!website && (
                <View style={styles.websiteRow}>
                  <MaterialCommunityIcons name="web" size={16} color={themeColors.textMuted} />
                  <Text style={styles.websiteText}>
                    She’ll bone up on <Text style={styles.websiteStrong}>{website}</Text> so she
                    knows your business.
                  </Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.primaryButton, demoState === 'calling' && styles.buttonDisabled]}
                onPress={handleDemoCall}
                activeOpacity={0.85}
                disabled={demoState === 'calling'}
              >
                {demoState === 'calling' ? (
                  <ActivityIndicator size="small" color={themeColors.onAccent} />
                ) : (
                  <MaterialCommunityIcons name="phone-plus" size={20} color={themeColors.onAccent} />
                )}
                <Text style={styles.primaryButtonText}>
                  {demoState === 'calling' ? 'Getting Katie on the line…' : 'Katie, call me in 30 seconds'}
                </Text>
              </TouchableOpacity>
            </Surface>
          )}

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

          {/* "Missed money" calculator — two sliders feed a live figure. */}
          <Surface style={styles.card}>
            <View style={styles.calcHeader}>
              <MaterialCommunityIcons name="cash-multiple" size={18} color={themeColors.warning} />
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
          </Surface>

          {/* Secondary: prefer a hand getting set up? Talk to Tom. */}
          {submitted ? (
            <Surface style={styles.doneCard}>
              <View style={styles.doneIcon}>
                <MaterialCommunityIcons name="check-bold" size={28} color={themeColors.money} />
              </View>
              <Title style={styles.doneTitle}>You’re on the list!</Title>
              <Text style={styles.doneText}>
                Tom’ll be in touch soon to get Katie wired up to your number. Nothing to do for
                now — keep on the tools.
              </Text>
            </Surface>
          ) : showInterest ? (
            <Surface style={styles.card}>
              <Title style={styles.sectionTitle}>Prefer to talk to Tom first?</Title>
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
                style={[styles.secondaryButton, (!contactPhone.trim() || sending) && styles.buttonDisabled]}
                onPress={handleSubmitInterest}
                activeOpacity={0.8}
                disabled={sending}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={themeColors.accentText} />
                ) : (
                  <MaterialCommunityIcons name="phone-plus" size={20} color={themeColors.accentText} />
                )}
                <Text style={styles.secondaryButtonText}>{sending ? 'Sending…' : 'Register my interest'}</Text>
              </TouchableOpacity>
            </Surface>
          ) : (
            <TouchableOpacity
              style={styles.talkLink}
              onPress={() => setShowInterest(true)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="account-voice" size={18} color={themeColors.accentText} />
              <Text style={styles.talkLinkText}>Prefer to talk to Tom first?</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.footnote}>
            Katie calls Australian numbers only. No call centres, no spam — just a missed call
            turned into a lead.
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
    </KeyboardAvoidingView>
  );
}

function InfoRow({ icon, title, body }: { icon: string; title: string; body: string }) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoRowIcon}>
        <MaterialCommunityIcons name={icon as any} size={18} color={themeColors.accentText} />
      </View>
      <View style={styles.infoRowBody}>
        <Text style={styles.infoRowTitle}>{title}</Text>
        <Text style={styles.infoRowText}>{body}</Text>
      </View>
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
    paddingBottom: 48,
  },
  heroCard: {
    padding: 24,
    marginBottom: 16,
    borderRadius: 16,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
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
    color: t.colors.text,
    textAlign: 'center',
  },
  heroBrand: {
    fontSize: 12,
    fontWeight: '700',
    color: t.colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  heroText: {
    fontSize: 15,
    color: t.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
  },
  demoCard: {
    padding: 22,
    marginBottom: 16,
    borderRadius: 16,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: t.colors.accentSubtle,
    alignItems: 'center',
  },
  demoIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  demoTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: t.colors.text,
    textAlign: 'center',
  },
  demoText: {
    fontSize: 14,
    color: t.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 6,
    marginBottom: 16,
  },
  websiteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'stretch',
    marginBottom: 16,
  },
  websiteText: {
    flex: 1,
    fontSize: 13,
    color: t.colors.textMuted,
    lineHeight: 18,
  },
  websiteStrong: {
    fontWeight: '700',
    color: t.colors.text,
  },
  convertPanel: {
    alignSelf: 'stretch',
    marginTop: 6,
    padding: 16,
    borderRadius: 12,
    backgroundColor: t.colors.bg,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: 'center',
  },
  convertTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: t.colors.text,
    textAlign: 'center',
  },
  convertText: {
    fontSize: 13,
    color: t.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 4,
    marginBottom: 14,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    backgroundColor: t.colors.accent,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.onAccent,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  infoCard: {
    padding: 18,
    marginBottom: 16,
    borderRadius: 16,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
    gap: 14,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.text,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 12,
  },
  infoRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: t.colors.accentSubtle,
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
    color: t.colors.text,
  },
  infoRowText: {
    fontSize: 13,
    color: t.colors.textSecondary,
    lineHeight: 18,
  },
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 16,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: t.colors.text,
  },
  hint: {
    fontSize: 14,
    color: t.colors.textSecondary,
    lineHeight: 20,
    marginTop: 4,
    marginBottom: 16,
  },
  input: {
    marginBottom: 16,
    backgroundColor: t.colors.surfaceRaised,
    alignSelf: 'stretch',
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
    color: t.colors.text,
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
    color: t.colors.textSecondary,
  },
  sliderValue: {
    fontSize: 16,
    fontWeight: '800',
    color: t.colors.accentText,
  },
  resultPanel: {
    marginTop: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.warningSubtle,
    alignItems: 'center',
  },
  resultLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: t.colors.textMuted,
    textAlign: 'center',
  },
  resultAmount: {
    fontSize: 38,
    fontWeight: '800',
    color: t.colors.warning,
    marginVertical: 2,
    letterSpacing: 0.5,
  },
  resultPer: {
    fontSize: 13,
    color: t.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  calcCaption: {
    fontSize: 12,
    color: t.colors.textMuted,
    lineHeight: 17,
    marginTop: 12,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.accentSubtle,
    borderWidth: 1,
    borderColor: t.colors.accentSubtle,
    paddingVertical: 15,
    borderRadius: 12,
    marginTop: 4,
    gap: 8,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.accentText,
  },
  talkLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginBottom: 8,
  },
  talkLinkText: {
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.accentText,
    textDecorationLine: 'underline',
  },
  doneCard: {
    padding: 24,
    marginBottom: 16,
    borderRadius: 16,
    elevation: 2,
    backgroundColor: t.colors.surfaceRaised,
    alignItems: 'center',
  },
  doneIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: t.colors.moneySubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  doneTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: t.colors.text,
    textAlign: 'center',
  },
  doneText: {
    fontSize: 14,
    color: t.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 6,
  },
  footnote: {
    fontSize: 12,
    color: t.colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
  },
}));
