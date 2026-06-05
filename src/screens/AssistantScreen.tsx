// Mate — the QuoteMate assistant chat surface.
//
// The model never writes to Firestore. Read tools execute server-side; intent
// tools come back as Proposal cards rendered inline with the assistant
// message. Tap Apply -> store.applyProposal -> existing store actions ->
// the screen drives navigation off the returned hint.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useStore, NavigateHint } from '../store/useStore';
import { sendAssistantTurn } from '../services/assistantService';
import { openVoiceSession, VoiceSession } from '../services/assistant/voiceSession';
import { LiveAuthError, LiveOfflineError, LiveQuotaError } from '../services/assistant/liveSession';
import { rememberAppliedQuote } from '../services/assistant/quoteRefMap';
import { startMicCapture, MicCaptureHandle, MicUnavailableError } from '../services/assistant/mic';
import { AudioQueue, createAudioQueue, ensureAudioMode } from '../services/assistant/audioPlayer';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

// Tag for the screen-wake lock held during voice mode. Keeping it the same
// across activate/deactivate calls means even if a second voice session
// opens before the first one fully tears down, we don't end up stacking
// untracked locks (expo-keep-awake refcounts per-tag).
const VOICE_KEEP_AWAKE_TAG = 'mate-voice-session';
import { generateId } from '../utils/generateId';
import {
  ChatMessage,
  Proposal,
  ProposalStatus,
} from '../types/assistant';
import { MessageBubble } from '../components/assistant/MessageBubble';
import { ProposalCard } from '../components/assistant/ProposalCard';
import { WebContainer } from '../components/WebContainer';

type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking';

interface ChatItem {
  key: string;
  message: ChatMessage;
}

// Single chat row, lifted out + memoised so FlatList can skip work when
// AssistantScreen re-renders for unrelated reasons (composer keystrokes,
// voice-state ticks, etc). The callbacks all take `message`/`proposal` as
// arguments so the parent can hand in stable useCallback references.
interface ChatRowProps {
  item: ChatItem;
  onCtaPress: (message: ChatMessage) => void;
  onApply: (message: ChatMessage, proposal: Proposal) => void;
  onDismiss: (message: ChatMessage, proposal: Proposal) => void;
  onInlineQuoteEdit: (quoteId: string, step: any) => void;
  onInlineQuoteOpen: (quoteId: string) => void;
  onInlineJobEdit: (jobId: string) => void;
}
const ChatRowMemo = React.memo(function ChatRow({
  item,
  onCtaPress,
  onApply,
  onDismiss,
  onInlineQuoteEdit,
  onInlineQuoteOpen,
  onInlineJobEdit,
}: ChatRowProps) {
  const proposals = item.message.proposals || [];
  return (
    <View>
      <MessageBubble
        message={item.message}
        onCtaPress={() => onCtaPress(item.message)}
        onInlineQuoteEdit={onInlineQuoteEdit}
        onInlineQuoteOpen={onInlineQuoteOpen}
        onInlineJobEdit={onInlineJobEdit}
      />
      {proposals.map((p) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          status={(item.message.proposalStatus?.[p.id] as ProposalStatus) || 'pending'}
          onApply={() => onApply(item.message, p)}
          onDismiss={() => onDismiss(item.message, p)}
        />
      ))}
    </View>
  );
});

// Keep a faint baseline so the line gently undulates during silence instead of
// going dead flat, while real speech still pushes the wave to full height.
const WAVE_LEVEL_FLOOR = 0.12;
// SVG viewBox the wave is drawn in (stretched to the row via
// preserveAspectRatio="none"). Units are arbitrary — the path math works in
// this space and the Svg scales it to whatever width the composer gives us.
const WAVE_W = 100;
const WAVE_H = 36;
const WAVE_SAMPLES = 130; // polyline density — high enough to keep the higher-frequency wave smooth

// Derive a 0..1 amplitude from a base64-encoded 16-bit PCM mic chunk — the
// exact bytes we're already streaming to the voice session. Returns -1 when
// the chunk can't be decoded so the caller leaves the synthetic loop in
// charge.
function micLevelFromChunk(b64: string): number {
  if (typeof atob !== 'function') return -1;
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return -1;
  }
  const len = bin.length;
  if (len < 4) return 0;
  let sumSq = 0;
  let count = 0;
  // Sample one frame in eight — plenty for an amplitude read and keeps the
  // per-chunk work tiny (chunks land ~4x/sec).
  const stride = 8;
  for (let i = 0; i + 1 < len; i += 2 * stride) {
    const lo = bin.charCodeAt(i);
    const hi = bin.charCodeAt(i + 1);
    let v = (hi << 8) | lo;
    if (v >= 0x8000) v -= 0x10000;
    sumSq += v * v;
    count++;
  }
  if (!count) return 0;
  const rms = Math.sqrt(sumSq / count); // 0..32768
  // Speech RMS sits around ~500-5000. Normalise to that band and lift the
  // quiet end with a gentle curve so soft talking still moves the bars.
  const norm = Math.min(1, rms / 4500);
  return Math.min(1, Math.pow(norm, 0.6) * 1.1);
}

// Build the SVG path string for a single flowing wave line. `phase` scrolls
// the wave horizontally over time; `amp` (0..1) is the live mic level. Two
// sine components at different frequencies are summed so it ripples like a
// real voice trace rather than a textbook sinusoid, and both ends are tapered
// to the midline (envelope) so the line resolves into the centre instead of
// being chopped off at the edges — the Siri/Whispr look.
function buildWavePath(phase: number, amp: number): string {
  const mid = WAVE_H / 2;
  // Headroom so the wave never clips the viewBox even at full tilt.
  const maxAmp = mid - 3;
  let d = '';
  for (let i = 0; i <= WAVE_SAMPLES; i++) {
    const t = i / WAVE_SAMPLES; // 0..1 across the width
    const x = t * WAVE_W;
    // Taper to the midline at both ends (sin envelope, 0 at edges, 1 centre).
    const envelope = Math.sin(t * Math.PI);
    const wave =
      Math.sin(t * Math.PI * 14 - phase) * 0.6 +
      Math.sin(t * Math.PI * 23 - phase * 1.7) * 0.4;
    const y = mid + wave * envelope * amp * maxAmp;
    d += i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`;
  }
  return d;
}

// Live waveform shown inside the composer while a voice session is active —
// a single continuous line that scrolls and swells with the tradie's voice.
// A requestAnimationFrame loop advances the scroll phase and eases the
// rendered amplitude toward the live mic `level` (read through a listener),
// then pushes a fresh path string into state ~30fps. Driving `d` via state
// (rather than setNativeProps) is the reliable cross-platform path —
// setNativeProps on an SVG Path is a no-op on react-native-web. memo'd so the
// chat's frequent re-renders during streaming don't reset this loop.
const VoiceWave = React.memo(function VoiceWave({
  level,
  accent,
}: {
  level: Animated.Value;
  accent: string;
}) {
  const [d, setD] = useState(() => buildWavePath(0, WAVE_LEVEL_FLOOR));

  useEffect(() => {
    let raf: number;
    let phase = 0;
    let amp = 0;
    let frame = 0;
    // Mirror the Animated level into a plain number we can read each frame.
    // Seed from the value's current reading so we don't start from a stale 0.
    let liveLevel = (level as any)._value ?? 0;
    const id = level.addListener(({ value }) => { liveLevel = value; });

    const tick = () => {
      raf = requestAnimationFrame(tick);
      phase += 0.13; // scroll speed
      // Ease the rendered amplitude toward the live level so spikes glide in
      // smoothly instead of snapping.
      amp += (Math.max(WAVE_LEVEL_FLOOR, liveLevel) - amp) * 0.18;
      // Repaint every other frame (~30fps) — smooth enough, easy on the CPU.
      if (frame++ % 2 === 0) {
        setD(buildWavePath(phase, amp));
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      level.removeListener(id);
    };
  }, [level]);

  return (
    <View style={styles.waveRow} pointerEvents="none">
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}
        preserveAspectRatio="none"
      >
        <Defs>
          {/* Fade the line into the edges so the tapered ends melt out rather
              than stopping abruptly. */}
          <LinearGradient id="waveGrad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={accent} stopOpacity={0} />
            <Stop offset="0.18" stopColor={accent} stopOpacity={1} />
            <Stop offset="0.82" stopColor={accent} stopOpacity={1} />
            <Stop offset="1" stopColor={accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path
          d={d}
          stroke="url(#waveGrad)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </View>
  );
});

// Pulsing concentric ring behind the mic button when voice mode is
// active. Two rings on offset loops so the effect never has a "dead"
// moment between pulses.
function MicPulse({ active, color }: { active: boolean; color: string }) {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (!active) return;
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, {
            toValue: 1,
            duration: 1400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: false }),
        ]),
      );
    const la = make(a, 0);
    const lb = make(b, 700);
    la.start();
    lb.start();
    return () => { la.stop(); lb.stop(); };
  }, [active, a, b]);

  if (!active) return null;

  const ring = (v: Animated.Value) => ({
    position: 'absolute' as const,
    left: -20,
    top: -20,
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: color,
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
  });

  return (
    <>
      <Animated.View pointerEvents="none" style={ring(a)} />
      <Animated.View pointerEvents="none" style={ring(b)} />
    </>
  );
}

// Big hero record button shown front-and-centre when the chat is empty.
// Lifted from the JobDetailsScreen voice-record UI (ripple rings + glow +
// pulse) so the two surfaces feel related. Self-contained animation loops
// run only while `active`; `pending` (connecting/thinking) shows a spinner
// over the icon without the rings, so the user gets feedback while the WS
// is handshaking but we don't fake a "recording" state that isn't true yet.
function HeroRecordButton({
  active,
  pending,
  onPress,
  accent,
}: {
  active: boolean;
  pending: boolean;
  onPress: () => void;
  accent: string;
}) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const rippleAnim = useRef(new Animated.Value(0)).current;
  const ripple2Anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      Animated.parallel([
        Animated.timing(pulseAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(rippleAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(ripple2Anim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
      return;
    }
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.12, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]),
    );
    const rippleLoop = Animated.loop(
      Animated.timing(rippleAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
    );
    const ripple2Loop = Animated.loop(
      Animated.sequence([
        Animated.delay(900),
        Animated.timing(ripple2Anim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(ripple2Anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    pulseLoop.start();
    glowLoop.start();
    rippleLoop.start();
    ripple2Loop.start();
    return () => {
      pulseLoop.stop();
      glowLoop.stop();
      rippleLoop.stop();
      ripple2Loop.stop();
    };
  }, [active, pulseAnim, glowAnim, rippleAnim, ripple2Anim]);

  const ringStyle = (anim: Animated.Value) => ({
    position: 'absolute' as const,
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 3,
    borderColor: accent,
    backgroundColor: 'transparent',
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
    transform: [
      { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) },
    ],
  });

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={pending}
      activeOpacity={0.85}
      style={heroStyles.touchable}
      accessibilityRole="button"
      accessibilityLabel={active ? 'Stop voice mode' : 'Tap to talk to Mate'}
    >
      {active && (
        <>
          <Animated.View style={ringStyle(rippleAnim)} />
          <Animated.View style={ringStyle(ripple2Anim)} />
        </>
      )}
      <Animated.View
        style={[
          heroStyles.glow,
          {
            backgroundColor: accent,
            shadowColor: accent,
            opacity: active
              ? glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.55] })
              : 0.18,
          },
        ]}
      />
      <Animated.View
        style={[
          heroStyles.button,
          { backgroundColor: accent, shadowColor: accent, transform: [{ scale: pulseAnim }] },
        ]}
      >
        {pending ? (
          <ActivityIndicator size="large" color={colors.white} />
        ) : (
          <MaterialCommunityIcons
            name={active ? 'stop' : 'microphone'}
            size={56}
            color={colors.white}
          />
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

const heroStyles = StyleSheet.create({
  touchable: {
    width: 128,
    height: 128,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.22)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 12,
  },
  glow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 28,
    elevation: 18,
  },
});

// Empty-state intro under the mic button. Two lines:
//   primary — one short sentence, context-aware (unfinished draft > time of day).
//   hint    — fixed, muted, smaller. The on-rails reminder.
// Keep both short. This sits beneath a big mic button, not a marketing page.
function getMateIntro(
  quotes: { status: string; updatedAt: Date; job?: { name?: string }; customerName?: string }[],
): { primary: string; hint: string } {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const hint = 'I draft. You tap to confirm. Nothing saves ’til you say.';

  // Most recently touched draft — surface it so the tradie can pick it up.
  const drafts = quotes
    .filter((q) => q.status === 'draft')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const draft = drafts[0];
  if (draft) {
    const label =
      draft.job?.name?.trim() ||
      (draft.customerName ? `${draft.customerName}'s job` : 'that draft quote');
    return {
      primary: `“${label}” is still a draft — finish it, or start something new?`,
      hint,
    };
  }

  // No drafts — a short time-of-day nudge.
  const h = new Date().getHours();
  let openers: string[];
  if (h < 11) openers = ['Mornin’. What are we quoting?', 'G’day. What’s the job?'];
  else if (h < 14) openers = ['What are we quoting?', 'What’s the job?'];
  else if (h < 17) openers = ['Arvo. What are we quoting?', 'What’s next on the list?'];
  else openers = ['Evenin’. What are we quoting?', 'What’s the job?'];
  return { primary: pick(openers), hint };
}

// Bracketed prompt tags we feed into the Live session as user turns to
// trigger Mate's pipeline-time narration. The model occasionally echoes
// the tag back at the start of its spoken/text response — a known
// prompt-format leak. Filtering them at the transcript layer keeps the
// chat clean even if the model misbehaves or the narrationModeRef gate
// races.
const LEAKED_PROMPT_TAG_RE = /^\s*\[(narrate|narrate-done|pipeline-done|context)\]/i;
function isLeakedPromptTag(text: string): boolean {
  return LEAKED_PROMPT_TAG_RE.test(text);
}

export function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<any>>();
  const conversations = useStore((s) => s.conversations);
  const currentConversationId = useStore((s) => s.currentConversationId);
  const startConversation = useStore((s) => s.startConversation);
  const newChat = useStore((s) => s.newChat);
  const appendMessage = useStore((s) => s.appendMessage);
  const updateMessage = useStore((s) => s.updateMessage);
  const applyProposal = useStore((s) => s.applyProposal);
  const updateProposalStatus = useStore((s) => s.updateProposalStatus);
  const setCurrentQuote = useStore((s) => s.setCurrentQuote);
  const quotes = useStore((s) => s.quotes);
  const documents = useStore((s) => s.documents);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  // Mirror state of voiceModeRef — drives the send-button icon swap and
  // the status-row copy. Refs alone don't trigger re-renders.
  const [voiceMode, setVoiceMode] = useState<'sticky' | 'ptt' | null>(null);
  const listRef = useRef<FlatList<ChatItem>>(null);

  // Shared 0..1 amplitude that drives the inline waveform. On web while
  // listening it's fed real mic RMS (see openVoiceMode); otherwise a gentle
  // breathing loop keeps the bars alive (see the effect below).
  const micLevel = useRef(new Animated.Value(0)).current;

  // Voice session refs. These live across renders so the mic capture and
  // audio queue don't get re-created when the screen re-renders mid-turn.
  const voiceSessionRef = useRef<VoiceSession | null>(null);
  const micRef = useRef<MicCaptureHandle | null>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);
  // 'sticky' = mic icon toggle (stays listening across turns).
  // 'ptt'    = press-and-hold the send button (auto-closes after one reply,
  //            once the audio queue has drained so Mate isn't cut off).
  const voiceModeRef = useRef<'sticky' | 'ptt' | null>(null);
  // Streaming-bubble targets — the user bubble being transcribed in real
  // time, and the assistant bubble currently being spoken/typed back.
  const userBubbleIdRef = useRef<string | null>(null);
  const assistantBubbleIdRef = useRef<string | null>(null);
  const userBubbleTextRef = useRef('');
  const assistantBubbleTextRef = useRef('');
  // True while the pipeline is running after Apply and Mate is yarning to
  // keep the tradie company. Audio still plays through the queue; text
  // bubbles are suppressed so the chat doesn't fill up with banter.
  const narrationModeRef = useRef(false);
  // Half-duplex gate: true while Mate's reply audio is actively playing
  // through the speaker. Mic chunks are dropped while this is set so the
  // speaker output doesn't bleed back into the mic and get re-transcribed
  // as the user talking — which would otherwise loop Mate replying to
  // itself forever on Android (and sometimes iOS speakerphone). Hardware
  // AEC via the VOICE_COMMUNICATION audio source handles most of it on
  // Android, this is the defensive belt-and-braces layer.
  const matePlayingRef = useRef(false);
  // Set when the tradie accepted/cancelled a card by voice this turn (Mate
  // called a control tool). We run the actual Apply / dismiss on turnComplete
  // so a draft's narration doesn't collide with Mate's spoken confirmation.
  const pendingVoiceActionRef = useRef<{
    decision: 'apply' | 'cancel';
    message: ChatMessage;
    proposal: Proposal;
  } | null>(null);

  // Lazy-create a conversation on first focus. Chat history isn't persisted —
  // a cold launch always starts fresh (see store: in-memory only).
  useEffect(() => {
    if (!currentConversationId) startConversation();
  }, [currentConversationId, startConversation]);

  // Drive the inline waveform's overall amplitude. On web while listening the
  // mic chunk callback feeds real RMS in (see openVoiceMode); for every other
  // state — connecting, thinking, or native where we get no live PCM — run a
  // gentle breathing loop so the line still feels alive. Reset to flat on idle.
  // Always JS-driven (useNativeDriver:false): VoiceWave reads this value every
  // frame via addListener, which a native-driven value wouldn't surface.
  useEffect(() => {
    if (voiceState === 'idle') {
      micLevel.stopAnimation(() => micLevel.setValue(0));
      return;
    }
    const liveFromMic = Platform.OS === 'web' && voiceState === 'listening';
    if (liveFromMic) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(micLevel, {
          toValue: 0.9,
          duration: 650,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(micLevel, {
          toValue: 0.4,
          duration: 650,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [voiceState, micLevel]);

  const conversation = useMemo(
    () => conversations.find((c) => c.id === currentConversationId),
    [conversations, currentConversationId],
  );
  const isEmpty = !conversation || conversation.messages.length === 0;

  // A bit of unique Aussie flavour for the empty-state intro — riffs on an
  // unfinished draft if there is one, otherwise on the time of day. Picked
  // once per mount so it doesn't reshuffle while the user is reading it.
  const introBlurb = useMemo(() => getMateIntro(quotes), []); // eslint-disable-line react-hooks/exhaustive-deps


  // Native uses an inverted FlatList: newest-first data renders bottom-up and
  // sticks to the bottom for free. react-native-web's inverted list can't
  // reliably scroll to the very top once the chat grows long, so on web we run
  // a normal chronological list and auto-stick to the bottom via
  // onContentSizeChange instead — which leaves the user free to scroll all the
  // way up to the start when nothing's streaming.
  const inverted = Platform.OS !== 'web';

  const items: ChatItem[] = useMemo(() => {
    if (!conversation) return [];
    const ordered = inverted
      ? conversation.messages.slice().reverse()
      : conversation.messages.slice();
    return ordered.map((m) => ({ key: m.id, message: m }));
  }, [conversation, inverted]);

  const handleNavigate = useCallback(
    (hint: NavigateHint | undefined) => {
      if (!hint) return;
      switch (hint.kind) {
        case 'job_preview': {
          // setCurrentQuote so the wizard's screens read the right draft.
          const quote = quotes.find((q) => q.id === hint.quoteId);
          if (quote) setCurrentQuote(quote);
          navigation.navigate('NewJob', { screen: 'JobPreview' });
          break;
        }
        case 'quote_materials_list': {
          // Materials were generated in-chat; navigate to MaterialsList with
          // autoFetchPrices=true so the wizard's existing pricing UI kicks
          // off automatically (Phase 2 will bring pricing into chat too).
          const quote = quotes.find((q) => q.id === hint.quoteId);
          if (quote) setCurrentQuote(quote);
          navigation.navigate('NewJob', {
            screen: 'MaterialsList',
            params: { autoFetchPrices: true },
          });
          break;
        }
        case 'open_send_modal': {
          // ViewJob is the unified job screen; the send modal lives inside it.
          // It keys off jobId, so resolve the doc to its job and pass
          // openSendDocId so ViewJob auto-opens the send sheet for this doc.
          const doc = useStore.getState().getDocumentById(hint.documentId);
          if (!doc?.jobId) return;
          navigation.navigate('ViewJob', { jobId: doc.jobId, openSendDocId: doc.id });
          break;
        }
        case 'open_contact':
          navigation.navigate('Contacts', { highlightId: hint.contactId });
          break;
        case 'open_invoice': {
          // The invoice was just minted by Apply; read the freshest store so
          // we can route to its job (ViewJob keys off jobId, not documentId).
          const doc = useStore.getState().getDocumentById(hint.invoiceId);
          if (!doc?.jobId) return;
          navigation.navigate('ViewJob', { jobId: doc.jobId });
          break;
        }
      }
    },
    [navigation, quotes, documents, setCurrentQuote],
  );

  const handleApply = useCallback(
    async (message: ChatMessage, proposal: Proposal) => {
      if (!conversation) return;
      updateProposalStatus(conversation.id, message.id, proposal.id, 'applied');

      // For proposals that run the long materials pipeline, mount a working
      // card up-front so the chat shows live progress instead of a silent
      // gap. Pricing in Phase 2 will extend this same card.
      const wantsProgress =
        proposal.type === 'propose_draft_quote' || proposal.type === 'propose_reprice';
      let workingMessageId: string | undefined;
      if (wantsProgress) {
        workingMessageId = generateId();
        appendMessage(conversation.id, {
          id: workingMessageId,
          role: 'assistant',
          text: '',
          createdAt: new Date().toISOString(),
          working:
            proposal.type === 'propose_reprice'
              ? { phase: 'pricing', status: 'Re-checking prices…', done: false }
              : { phase: 'preflight', status: 'Getting ready…', done: false },
        });
      }

      // Pipeline-first narration. The earlier flow fired the [narrate]
      // prompt BEFORE awaiting the pipeline, which meant Mate's audio
      // chunks started before the pipeline had even kicked off — the
      // tradie heard yarn first, then the working card appeared. Worse,
      // the prompt asked Mate to yarn for the WHOLE 20–40s window which
      // was way too much. New contract:
      //   1. Kick off the pipeline first.
      //   2. After a short beat (so the working card is on screen and
      //      the pipeline is actually grinding), send a SHORT narration
      //      prompt — a sentence or two, not a monologue.
      //   3. When the pipeline returns, fire [pipeline-done] for one
      //      short confirmation line.
      const liveSessionForNarration = voiceSessionRef.current;
      const narrating =
        (proposal.type === 'propose_draft_quote' || proposal.type === 'propose_reprice') &&
        !!liveSessionForNarration?.isOpen();
      const narrationJobLabel =
        proposal.type === 'propose_draft_quote'
          ? (proposal as Extract<Proposal, { type: 'propose_draft_quote' }>).jobName
          : proposal.type === 'propose_reprice'
            ? (proposal as Extract<Proposal, { type: 'propose_reprice' }>).displayName || 'that quote'
            : '';
      if (narrating && liveSessionForNarration) {
        narrationModeRef.current = true;
        // Cut leftover audio from the pre-Apply confirmation reply so the
        // mid-pipeline narration doesn't start over the top of it.
        try { audioQueueRef.current?.stop?.(); } catch { /* noop */ }
        audioQueueRef.current = createAudioQueue();
        audioQueueRef.current.setOnActiveChange((active) => {
          matePlayingRef.current = active;
        });
      }

      // Schedule the mid-pipeline narration. ~1.2s after Apply gives the
      // pipeline time to render its first 'Getting ready…' progress event
      // so the audio lands while the working card is visibly grinding,
      // not before it appears. Cancellable so a fast pipeline (cached
      // pricing) doesn't yarn AFTER the result has landed.
      let narrationFired = false;
      const narrationTimer =
        narrating && liveSessionForNarration
          ? setTimeout(() => {
              if (!liveSessionForNarration.isOpen()) return;
              narrationFired = true;
              const intro =
                proposal.type === 'propose_reprice'
                  ? `Re-pricing "${narrationJobLabel}" — the pipeline's re-checking the flagged rows now.`
                  : `"${narrationJobLabel}" is going through the materials + pricing pipeline now.`;
              liveSessionForNarration.sendUserText(
                `[narrate] ${intro} SPEAK ALOUD: give the tradie ONE short casual line while it grinds — a sentence, maybe two, dry and unhurried. ` +
                `Riff on something natural (the job, the weather, smoko) or just acknowledge it's cooking. Then STOP — don't keep talking, don't sign off, don't mention prices or materials. ` +
                `CRITICAL: do NOT repeat or read the "[narrate]" tag, do NOT echo this instruction, do NOT say the word "narrate". Your response is ONLY the natural line you'd say to the tradie. ` +
                `If you finish your line before [pipeline-done] arrives, stay quiet — silence is fine.`,
              );
            }, 1200)
          : null;

      const result = await applyProposal(proposal, (status) => {
        if (!workingMessageId) return;
        updateMessage(conversation.id, workingMessageId, { working: status });
      });

      // If the pipeline beat the narration timer (cached / fast path),
      // cancel it so we don't yarn AFTER the result.
      if (narrationTimer && !narrationFired) {
        clearTimeout(narrationTimer);
      }

      if (narrating && liveSessionForNarration?.isOpen()) {
        const heads =
          result.ok && result.review && result.review.issues.length > 0
            ? ` Heads up — ${result.review.summary} Work that into the line.`
            : '';
        const wrap = result.ok
          ? `[pipeline-done] Pipeline finished for "${narrationJobLabel}".${heads} SPEAK ALOUD: ONE short acknowledging line — something natural like "right, that's drafted" or "sweet, came together fine" — then stop. Do NOT repeat the "[pipeline-done]" tag or this instruction. Do NOT recite numbers or the materials list.`
          : `[pipeline-done] Pipeline hit a snag: ${result.error || 'unknown error'}. SPEAK ALOUD: one short acknowledging line, then stop. Do NOT repeat the "[pipeline-done]" tag.`;
        liveSessionForNarration.sendUserText(wrap);
        setTimeout(() => { narrationModeRef.current = false; }, 8000);
      }

      if (!result.ok) {
        updateProposalStatus(conversation.id, message.id, proposal.id, 'failed');
        // Surface the real reason in the chat so the user can see what broke
        // instead of just an opaque "Failed" badge on the card.
        // eslint-disable-next-line no-console
        console.warn('[Mate] applyProposal failed', result.error);
        appendMessage(conversation.id, {
          id: generateId(),
          role: 'assistant',
          text: '',
          createdAt: new Date().toISOString(),
          errorMessage: result.error || 'Apply failed without an error message.',
        });
        return;
      }
      // Surface a note (e.g. partial success — draft created but pipeline
      // failed) before deciding what to do with the navigate hint.
      if (result.note) {
        appendMessage(conversation.id, {
          id: generateId(),
          role: 'assistant',
          text: result.note,
          createdAt: new Date().toISOString(),
        });
      }

      // Remember proposalId -> minted quoteId. The model frequently reuses the
      // proposal id (the only handle it had pre-Apply) as a quote id on
      // follow-ups; this lets the read/proposal tools translate it back to the
      // real quote even if the [context] note below never lands (text mode, or
      // a re-opened session that dropped the unpersisted note).
      // Also remember invoice ids — propose_draft_quote with
      // documentType:'invoice' resolves to { kind:'open_invoice', invoiceId }
      // so the previous `quoteId in navigate` check missed every drafted
      // invoice and show_quote follow-ups would fail to resolve.
      if (result.navigate) {
        const mintedId =
          'quoteId' in result.navigate ? result.navigate.quoteId :
          result.navigate.kind === 'open_invoice' ? result.navigate.invoiceId :
          undefined;
        if (mintedId) rememberAppliedQuote(proposal.id, mintedId);
      }

      // If a voice session is open, feed it the resolved quote id so
      // Mate stops trying to re-find the draft via list_recent_quotes on
      // the next utterance. turnComplete:false means the model logs it
      // as context without speaking a reply about it.
      const liveSession = voiceSessionRef.current;
      // Most context notes need result.navigate (they reference the minted
      // quote/invoice/contact id). propose_delete_quote is the exception —
      // the doc is gone, so it never returns a navigate, but Mate still
      // needs the heads-up that the id is dead.
      if (liveSession?.isOpen() && proposal.type === 'propose_delete_quote') {
        const label = proposal.displayName || proposal.displayCustomerName || proposal.quoteId;
        liveSession.sendContextNote(
          `[context] Deleted ${proposal.displayDocType || 'quote'} ${proposal.quoteId} ("${label}"). ` +
            `It's gone — do NOT reference this id on follow-ups, and don't list it.`,
        );
      }
      if (liveSession?.isOpen() && result.navigate) {
        switch (proposal.type) {
          case 'propose_draft_quote':
            if (result.navigate.kind === 'job_preview' || result.navigate.kind === 'quote_materials_list') {
              liveSession.sendContextNote(
                `[context] The tradie tapped Apply on propose_draft_quote. ` +
                `The resulting quote is ${result.navigate.quoteId} ` +
                `("${proposal.jobName}"). Reference this id on follow-ups; ` +
                `do not draft a new quote for the same job.`,
              );
            }
            break;
          case 'propose_add_line_item':
            liveSession.sendContextNote(
              `[context] Added "${proposal.searchTerm}" (${proposal.qty} ${proposal.unit}) to quote ${proposal.quoteId}.`,
            );
            break;
          case 'propose_delete_line_item':
            liveSession.sendContextNote(
              `[context] Removed material ${proposal.materialId} from quote ${proposal.quoteId}.`,
            );
            break;

          case 'propose_send_quote':
            liveSession.sendContextNote(
              `[context] Sent quote ${proposal.quoteId} to the customer.`,
            );
            break;
          case 'propose_convert_to_invoice':
            if (result.navigate.kind === 'open_invoice') {
              liveSession.sendContextNote(
                `[context] Converted quote ${proposal.quoteId} to invoice ${result.navigate.invoiceId}.`,
              );
            }
            break;
          case 'propose_create_contact':
            if (result.navigate.kind === 'open_contact') {
              liveSession.sendContextNote(
                `[context] Created new contact ${result.navigate.contactId} ("${proposal.name}").`,
              );
            }
            break;
          case 'propose_update_customer':
            liveSession.sendContextNote(
              `[context] Changed the customer on quote ${proposal.quoteId}` +
              (proposal.customerName ? ` to "${proposal.customerName}".` : '.'),
            );
            break;
          case 'propose_reprice':
            liveSession.sendContextNote(
              `[context] Re-priced quote ${proposal.quoteId}.` +
              (result.review ? ` ${result.review.summary}` : ''),
            );
            break;
          case 'propose_update_quote_rates': {
            const parts: string[] = [];
            if (typeof proposal.markup === 'number') parts.push(`markup ${proposal.markup}%`);
            if (typeof proposal.laborMarkup === 'number') parts.push(`labour markup ${proposal.laborMarkup}%`);
            if (typeof proposal.laborRate === 'number') parts.push(`labour rate $${proposal.laborRate}/h`);
            if (typeof proposal.laborHours === 'number') parts.push(`labour hours ${proposal.laborHours}`);
            liveSession.sendContextNote(
              `[context] Updated rates on quote ${proposal.quoteId}: ${parts.join(', ')}.`,
            );
            break;
          }
        }
      }

      // For draft + reprice + customer change, keep the user in chat. Render
      // the quote inline (JobScopeCard) so the tradie can review and keep
      // chatting with Mate to tweak it without leaving — and surface any rows
      // the pricing pass flagged right there (proactive review). Other
      // proposal types (send, delete, convert, create contact) still
      // auto-navigate because their result IS a navigation, not an in-place
      // edit of the quote on screen.
      if (
        proposal.type === 'propose_draft_quote' ||
        proposal.type === 'propose_reprice' ||
        proposal.type === 'propose_update_customer' ||
        proposal.type === 'propose_update_quote_rates'
      ) {
        // Resolve the freshly-minted doc id regardless of whether the
        // pipeline landed on a quote (job_preview) or an auto-converted
        // invoice (open_invoice). Both render the same way via InlineQuote
        // — the component reads doc.type from the unified store.
        const renderableId =
          result.navigate?.kind === 'job_preview'
            ? result.navigate.quoteId
            : result.navigate?.kind === 'open_invoice'
              ? result.navigate.invoiceId
              : undefined;
        if (renderableId) {
          const isInvoice = result.navigate!.kind === 'open_invoice';
          const docNoun = isInvoice ? 'invoice' : 'draft';
          const hasIssues = !!result.review && result.review.issues.length > 0;
          const text =
            proposal.type === 'propose_draft_quote'
              ? hasIssues
                ? `Here's the ${docNoun} — ${result.review!.summary} Tell me what to tweak, or tap to open it.`
                : `Here's the ${docNoun} — have a squiz. Tell me what to tweak, or tap to open it.`
              : proposal.type === 'propose_update_customer'
                ? `Done — this one's on ${proposal.customerName || 'the new contact'} now. Tap to open it.`
                : proposal.type === 'propose_update_quote_rates'
                  ? "Rates updated and totals re-run. Tap to open it."
                  : hasIssues
                    ? `Re-priced. ${result.review!.summary} Tap to open it, or say the word and I'll have another go.`
                    : 'Re-priced — every line came back clean. Tap to open it.';
          appendMessage(conversation.id, {
            id: generateId(),
            role: 'assistant',
            text,
            createdAt: new Date().toISOString(),
          });
          appendMessage(conversation.id, {
            id: generateId(),
            role: 'assistant',
            text: '',
            createdAt: new Date().toISOString(),
            inlineQuoteId: renderableId,
          });
        }
        return;
      }

      // Mark paid stays in chat — the proposal card already flipped to
      // "Applied". Don't navigate away mid-conversation; just let Mate
      // confirm verbally / textually on the next turn. The [context] line
      // below tells the model the payment landed.
      if (proposal.type === 'propose_mark_paid') {
        const liveSession = voiceSessionRef.current;
        if (liveSession?.isOpen() && result.navigate?.kind === 'open_invoice') {
          const label = proposal.displayName || proposal.displayCustomerName || 'that invoice';
          liveSession.sendContextNote(
            `[context] Marked invoice ${result.navigate.invoiceId} ("${label}") as paid in full. ` +
              `The books are updated — confirm to the tradie in one short line, don't navigate or re-show it.`,
          );
        }
        return;
      }

      handleNavigate(result.navigate);
    },
    [conversation, applyProposal, appendMessage, updateMessage, updateProposalStatus, handleNavigate],
  );

  const handleDismiss = useCallback(
    (message: ChatMessage, proposal: Proposal) => {
      if (!conversation) return;
      updateProposalStatus(conversation.id, message.id, proposal.id, 'dismissed');
    },
    [conversation, updateProposalStatus],
  );

  // Put a quote on screen — render it inline in the chat (job header + scope +
  // materials) so the tradie can actually see it. Mate triggers this via the
  // show_quote tool. Returns false when the id doesn't resolve to a known
  // quote/invoice so the caller can say so instead of pretending it worked.
  const showQuoteInChat = useCallback(
    (convoId: string, quoteId: string): boolean => {
      const state = useStore.getState();
      const exists = !!(state.getDocumentById(quoteId) || state.quotes.find((q) => q.id === quoteId));
      if (!exists) return false;
      appendMessage(convoId, {
        id: generateId(),
        role: 'assistant',
        text: '',
        createdAt: new Date().toISOString(),
        inlineQuoteId: quoteId,
      });
      return true;
    },
    [appendMessage],
  );

  const submit = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || sending) return;
      // Resolve the active conversation against the current store, not the
      // closure — `currentConversationId` can point at a missing conversation
      // (e.g. right after newChat replaced the array). Always validate first.
      const storeState = useStore.getState();
      let convoId = storeState.conversations.find((c) => c.id === storeState.currentConversationId)?.id;
      if (!convoId) convoId = startConversation();
      const currentMessages =
        useStore.getState().conversations.find((c) => c.id === convoId)?.messages || [];

      setInput('');
      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        text,
        createdAt: new Date().toISOString(),
      };
      appendMessage(convoId, userMsg);

      setSending(true);
      // Mount an empty assistant bubble up-front so streaming text deltas
      // from the Live session land in a stable target message id. If the
      // turn errors out, we either replace it with an error message or
      // (on partial responses) leave the partial text and append the error
      // separately.
      const streamingId = generateId();
      let streamedText = '';
      appendMessage(convoId, {
        id: streamingId,
        role: 'assistant',
        text: '',
        createdAt: new Date().toISOString(),
      });
      try {
        const history = [...currentMessages, userMsg];
        const response = await sendAssistantTurn({
          history,
          onTextDelta: (delta) => {
            streamedText += delta;
            updateMessage(convoId, streamingId, { text: streamedText });
          },
        });
        // eslint-disable-next-line no-console
        console.log('[Mate] response', {
          textLen: response.text?.length || 0,
          proposalCount: response.proposals.length,
          usage: response.usage,
        });
        const hasContent = !!(response.text && response.text.trim()) || response.proposals.length > 0;
        const fallback = '(Mate returned an empty reply — check the Firebase Functions logs for assistantToken.)';
        updateMessage(convoId, streamingId, {
          text: response.text?.trim() || (response.proposals.length > 0 ? 'Here you go — tap Apply.' : ''),
          proposals: response.proposals,
          proposalStatus: Object.fromEntries(response.proposals.map((p) => [p.id, 'pending' as ProposalStatus])),
          errorMessage: hasContent ? undefined : fallback,
        });
        // Render any quotes the model asked to show. Each lands as its own
        // inline card below the reply; an unresolved id gets a short nudge
        // instead of a silently missing card.
        for (const qid of response.showQuoteIds || []) {
          if (!showQuoteInChat(convoId, qid)) {
            appendMessage(convoId, {
              id: generateId(),
              role: 'assistant',
              text: "Hmm, couldn't pull that one up — which quote did you mean?",
              createdAt: new Date().toISOString(),
            });
          }
        }
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn('[Mate] error', err?.name, err?.message);
        const friendly =
          err instanceof LiveQuotaError ||
          err instanceof LiveOfflineError ||
          err instanceof LiveAuthError;
        const errorMessage = friendly
          ? err.message
          : `Mate hit a snag: ${err?.message || 'unknown error'}`;
        // If we got partial streamed text, keep it visible and append a
        // separate error bubble. Otherwise replace the empty placeholder.
        if (streamedText) {
          appendMessage(convoId, {
            id: generateId(),
            role: 'assistant',
            text: '',
            createdAt: new Date().toISOString(),
            errorMessage,
          });
        } else {
          updateMessage(convoId, streamingId, { text: '', errorMessage });
        }
      } finally {
        setSending(false);
      }
    },
    [appendMessage, updateMessage, conversation, currentConversationId, input, sending, startConversation, showQuoteInChat],
  );

  const stopVoiceSession = useCallback(async () => {
    const mic = micRef.current;
    const queue = audioQueueRef.current;
    const session = voiceSessionRef.current;
    micRef.current = null;
    audioQueueRef.current = null;
    voiceSessionRef.current = null;
    voiceModeRef.current = null;
    setVoiceMode(null);
    matePlayingRef.current = false;
    // Release the wake lock now that the session is torn down. Fire-and-
    // forget — if it fails (or the tag was never held, e.g. open errored
    // before activate) the OS just keeps the default sleep behaviour.
    try { void deactivateKeepAwake(VOICE_KEEP_AWAKE_TAG); } catch { /* noop */ }
    userBubbleIdRef.current = null;
    assistantBubbleIdRef.current = null;
    userBubbleTextRef.current = '';
    assistantBubbleTextRef.current = '';
    setVoiceState('idle');
    if (mic) {
      try { await mic.stop(); } catch { /* noop */ }
    }
    if (queue) {
      try { await queue.stop(); } catch { /* noop */ }
    }
    if (session) {
      try { session.close(); } catch { /* noop */ }
    }
  }, []);

  // Clear the chat and start fresh. Tears down any live voice session first so
  // the mic doesn't keep streaming into a discarded conversation.
  const handleNewChat = useCallback(async () => {
    await stopVoiceSession();
    setInput('');
    newChat();
  }, [stopVoiceSession, newChat]);

  // "New chat" button in the header. Disabled while the current chat is empty
  // (nothing to clear) so it can't spawn a throwaway conversation.
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={handleNewChat}
          disabled={isEmpty}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginRight: 12,
            padding: 4,
            opacity: isEmpty ? 0.4 : 1,
          }}
          accessibilityRole="button"
          accessibilityLabel="New chat"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name="square-edit-outline" size={22} color={colors.white} />
          <Text style={{ color: colors.white, fontSize: 15, fontWeight: '600', marginLeft: 5 }}>
            New
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, handleNewChat, isEmpty]);

  const openVoiceMode = useCallback(async (mode: 'sticky' | 'ptt') => {
    voiceModeRef.current = mode;
    setVoiceMode(mode);

    const storeState = useStore.getState();
    let convoId = storeState.conversations.find((c) => c.id === storeState.currentConversationId)?.id;
    if (!convoId) convoId = startConversation();
    const seedHistory =
      useStore.getState().conversations.find((c) => c.id === convoId)?.messages || [];

    setVoiceState('connecting');
    // Hold the screen awake for the duration of the voice session. Without
    // this Android (and iOS) will dim and lock the phone after the user's
    // configured timeout while Mate is mid-conversation — mic capture stops,
    // playback chokes, the WS gets killed. Activated here (before any await)
    // so even a slow Live token mint can't sneak the screen off; released in
    // stopVoiceSession when the session is fully torn down.
    try { await activateKeepAwakeAsync(VOICE_KEEP_AWAKE_TAG); } catch { /* non-fatal */ }
    try {
      await ensureAudioMode();
    } catch { /* non-fatal */ }

    let session: VoiceSession | null = null;
    try {
      // Proposals accumulate per assistant turn so the bubble that's
      // currently being spoken/transcribed can render its cards on
      // turnComplete without juggling separate state.
      let turnProposals: Proposal[] = [];

      // The server's inputTranscription.finished flag isn't sent reliably
      // across utterances — without a hard boundary, every spoken sentence
      // accumulates into one giant user bubble. Treat the first sign of
      // model output as the natural end of the user's turn and flush the
      // bubble so the next utterance starts a fresh one.
      const flushUserBubbleIfOpen = () => {
        if (!userBubbleIdRef.current) return;
        userBubbleIdRef.current = null;
        userBubbleTextRef.current = '';
      };

      session = await openVoiceSession(seedHistory, {
        onInputTranscription: (text, finished) => {
          if (!text) return;
          if (!userBubbleIdRef.current) {
            const id = generateId();
            userBubbleIdRef.current = id;
            userBubbleTextRef.current = text;
            appendMessage(convoId!, {
              id,
              role: 'user',
              text,
              createdAt: new Date().toISOString(),
            });
          } else {
            userBubbleTextRef.current += text;
            updateMessage(convoId!, userBubbleIdRef.current, { text: userBubbleTextRef.current });
          }
          if (finished) {
            userBubbleIdRef.current = null;
            userBubbleTextRef.current = '';
            setVoiceState('thinking');
          }
        },
        onOutputTranscription: (text, finished) => {
          if (!text) return;
          flushUserBubbleIfOpen();
          // During the post-Apply narration window, Mate is yarning
          // entirely for the speakers. Don't pollute the chat with
          // banter — audio chunks still play normally via the queue.
          if (narrationModeRef.current) return;
          // Hard guard: any transcript that leaks one of our bracketed
          // prompt tags is a prompt-format echo from the model, never
          // user-facing. Drop the chunk silently rather than risking it
          // bleeding into a visible bubble (the narrationModeRef gate
          // above SHOULD catch the narration case, but a stale bundle
          // or a race on the ref leaves [narrate]/[pipeline-done]/[context]
          // showing in chat — see the production sighting where the
          // narration prompt rendered verbatim).
          if (isLeakedPromptTag(text)) return;
          if (!assistantBubbleIdRef.current) {
            const id = generateId();
            assistantBubbleIdRef.current = id;
            assistantBubbleTextRef.current = text;
            turnProposals = [];
            appendMessage(convoId!, {
              id,
              role: 'assistant',
              text,
              createdAt: new Date().toISOString(),
            });
          } else {
            assistantBubbleTextRef.current += text;
            updateMessage(convoId!, assistantBubbleIdRef.current, {
              text: assistantBubbleTextRef.current,
            });
          }
          if (finished) {
            assistantBubbleIdRef.current = null;
            assistantBubbleTextRef.current = '';
          }
        },
        onTextDelta: (delta) => {
          // Audio-modality sessions usually omit TEXT parts, but some
          // tool-bound replies still emit short text fragments. Append to
          // the same bubble used for the output transcription so the user
          // sees a single coherent reply.
          if (!delta) return;
          if (narrationModeRef.current) return;
          if (isLeakedPromptTag(delta)) return;
          flushUserBubbleIfOpen();
          if (!assistantBubbleIdRef.current) {
            const id = generateId();
            assistantBubbleIdRef.current = id;
            assistantBubbleTextRef.current = delta;
            turnProposals = [];
            appendMessage(convoId!, {
              id,
              role: 'assistant',
              text: delta,
              createdAt: new Date().toISOString(),
            });
          } else {
            assistantBubbleTextRef.current += delta;
            updateMessage(convoId!, assistantBubbleIdRef.current, {
              text: assistantBubbleTextRef.current,
            });
          }
        },
        onAudioChunk: (b64) => {
          flushUserBubbleIfOpen();
          audioQueueRef.current?.enqueuePcmChunk(b64);
        },
        onProposal: (proposal) => {
          flushUserBubbleIfOpen();
          turnProposals = [...turnProposals, proposal];
          // Re-attach the growing proposal list to whichever bubble is
          // currently in play, or mint a new bubble if Mate sent a tool
          // call without speaking any words first.
          let bubbleId = assistantBubbleIdRef.current;
          if (!bubbleId) {
            bubbleId = generateId();
            assistantBubbleIdRef.current = bubbleId;
            assistantBubbleTextRef.current = '';
            appendMessage(convoId!, {
              id: bubbleId,
              role: 'assistant',
              text: '',
              createdAt: new Date().toISOString(),
            });
          }
          updateMessage(convoId!, bubbleId, {
            proposals: turnProposals,
            proposalStatus: Object.fromEntries(
              turnProposals.map((p) => [p.id, 'pending' as ProposalStatus]),
            ),
          });
        },
        onControlAction: (decision, proposalId) => {
          // Resolve which card the tradie just confirmed/cancelled. Newest
          // pending card wins; an explicit proposalId (if Mate tracked it)
          // pins a specific one. We stash it and act on turnComplete so the
          // spoken reply finishes first.
          const convo = useStore.getState().conversations.find((c) => c.id === convoId);
          const findPending = (): { message: ChatMessage; proposal: Proposal } | null => {
            if (!convo) return null;
            for (let i = convo.messages.length - 1; i >= 0; i--) {
              const m = convo.messages[i];
              if (!m.proposals?.length) continue;
              const status = m.proposalStatus || {};
              for (let j = m.proposals.length - 1; j >= 0; j--) {
                const p = m.proposals[j];
                if ((status[p.id] || 'pending') !== 'pending') continue;
                if (proposalId && p.id !== proposalId) continue;
                return { message: m, proposal: p };
              }
            }
            return null;
          };
          const found = findPending();
          if (!found) {
            return {
              ok: false,
              error: proposalId ? 'That card is no longer waiting.' : 'No card is waiting to confirm.',
            };
          }
          pendingVoiceActionRef.current = { decision, message: found.message, proposal: found.proposal };
          return { ok: true };
        },
        onShowQuote: (quoteId) => {
          // Render it inline straight away — no need to wait for turn end, it's
          // not a draft and won't collide with narration.
          const shown = showQuoteInChat(convoId!, quoteId);
          return shown
            ? { ok: true }
            : { ok: false, error: "Couldn't find that quote to put on screen." };
        },
        onTurnComplete: () => {
          assistantBubbleIdRef.current = null;
          assistantBubbleTextRef.current = '';
          turnProposals = [];

          // The tradie confirmed/cancelled a card by voice this turn — run the
          // same Apply / dismiss the buttons do, now that Mate's spoken reply
          // has finished. Deferring to turn end keeps a draft's narration from
          // colliding with the confirmation reply.
          const voiceAction = pendingVoiceActionRef.current;
          pendingVoiceActionRef.current = null;
          const runVoiceAction = () => {
            if (!voiceAction) return;
            if (voiceAction.decision === 'apply') {
              void handleApply(voiceAction.message, voiceAction.proposal);
            } else {
              handleDismiss(voiceAction.message, voiceAction.proposal);
            }
          };

          // PTT is a single-shot interaction. Close the WS as soon as the
          // model finishes, then wait for the audio queue to drain before
          // the final cleanup so Mate's reply plays out in full instead
          // of being cut mid-sentence by an immediate stop().
          if (voiceModeRef.current === 'ptt') {
            const queue = audioQueueRef.current;
            try { voiceSessionRef.current?.close(); } catch { /* noop */ }
            voiceSessionRef.current = null;
            setVoiceState('thinking');
            // Session's closing, so a draft won't narrate here — fine for PTT.
            // Still resolve the card so the apply/dismiss lands.
            runVoiceAction();
            if (queue) {
              queue.setOnIdle(() => { void stopVoiceSession(); });
            } else {
              void stopVoiceSession();
            }
            return;
          }
          // Continuous mode: session stays open, so applying a draft here lets
          // it narrate the pipeline wait as usual.
          runVoiceAction();
          if (voiceSessionRef.current) setVoiceState('listening');
        },
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.warn('[Mate voice] session error', err.message);
          appendMessage(convoId!, {
            id: generateId(),
            role: 'assistant',
            text: '',
            createdAt: new Date().toISOString(),
            errorMessage: err.message,
          });
          void stopVoiceSession();
        },
        onClose: () => {
          void stopVoiceSession();
        },
      });

      voiceSessionRef.current = session;
      audioQueueRef.current = createAudioQueue();
      audioQueueRef.current.setOnActiveChange((active) => {
        matePlayingRef.current = active;
      });

      // Fresh chat + sticky (big record button) mode: get Mate to kick things
      // off with a short, slightly cheeky Aussie greeting so the tradie hears
      // a voice the moment the session connects, instead of dead air. Skipped
      // for PTT (the user's already talking) and for resumed conversations.
      if (mode === 'sticky' && seedHistory.length === 0) {
        const latestDraft = useStore
          .getState()
          .quotes.filter((q) => q.status === 'draft')
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
        const draftLabel = latestDraft
          ? latestDraft.job?.name?.trim() ||
            (latestDraft.customerName ? `${latestDraft.customerName}'s job` : '')
          : '';
        const hour = new Date().getHours();
        const tod =
          hour < 6 ? 'sparrow\'s fart (pre-dawn)'
          : hour < 11 ? 'morning'
          : hour < 14 ? 'middle of the day / smoko'
          : hour < 17 ? 'arvo'
          : hour < 21 ? 'evening / knock-off'
          : 'late night';
        const draftHint = draftLabel
          ? `There's an unfinished draft quote called "${draftLabel}" — you can rib them about it sitting half-done if it feels natural, or ignore it.`
          : 'There are no unfinished drafts right now.';
        session.sendUserText(
          `[greet] Kick off the chat with ONE short Aussie greeting, 1–2 sentences max. ` +
          `Dry, warm, slightly cheeky tradie humour. No emojis. Don't list options or features. ` +
          `Time of day: ${tod}. ${draftHint} ` +
          `End by inviting them to tell you what they need. Then stop and wait.`,
        );
      }

      // Open the mic only once the session handshake completed — earlier
      // chunks would queue inside voiceSession until setupComplete anyway,
      // but starting the mic now keeps the buffer small. On web the
      // first call also triggers the browser permission prompt, so this
      // is awaited.
      try {
        micRef.current = await startMicCapture((chunk) => {
          // Half-duplex: while Mate's audio reply is playing, drop mic
          // chunks so the speaker output doesn't get echoed back into
          // Gemini's server-side VAD as a fresh user turn (which was the
          // root cause of the infinite-loop bug on Android — and the
          // occasional iOS one when on speakerphone).
          if (!matePlayingRef.current) {
            voiceSessionRef.current?.sendMicChunk(chunk);
          }
          // Web only: feed the same PCM we're streaming into the inline
          // waveform so the line reacts to the tradie's actual voice. On native
          // the breathing loop (see the micLevel effect) owns this value, so
          // don't double-drive it here. JS-driven so VoiceWave's per-frame
          // listener picks it up.
          if (Platform.OS === 'web') {
            const lvl = micLevelFromChunk(chunk);
            if (lvl >= 0) {
              Animated.timing(micLevel, {
                toValue: Math.max(WAVE_LEVEL_FLOOR, lvl),
                duration: 130,
                easing: Easing.out(Easing.quad),
                useNativeDriver: false,
              }).start();
            }
          }
        });
      } catch (err: any) {
        appendMessage(convoId!, {
          id: generateId(),
          role: 'assistant',
          text: '',
          createdAt: new Date().toISOString(),
          errorMessage:
            err instanceof MicUnavailableError
              ? err.message
              : `Mate couldn't open the mic: ${err?.message || 'unknown error'}`,
        });
        await stopVoiceSession();
        return;
      }

      setVoiceState('listening');
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('[Mate voice] open failed', err?.name, err?.message);
      const message =
        err instanceof LiveQuotaError ||
        err instanceof LiveOfflineError ||
        err instanceof LiveAuthError
          ? err.message
          : `Voice mode is offline: ${err?.message || 'unknown error'}`;
      appendMessage(convoId!, {
        id: generateId(),
        role: 'assistant',
        text: '',
        createdAt: new Date().toISOString(),
        errorMessage: message,
      });
      await stopVoiceSession();
    }
  }, [stopVoiceSession, appendMessage, updateMessage, startConversation, micLevel, handleApply, handleDismiss, showQuoteInChat]);

  const handleVoiceToggle = useCallback(async () => {
    if (voiceState !== 'idle') {
      await stopVoiceSession();
      return;
    }
    await openVoiceMode('sticky');
  }, [voiceState, stopVoiceSession, openVoiceMode]);

  // Push-to-talk on the send button: long-press to open a single-shot
  // voice turn, release to commit and let Mate respond.
  const handlePttPressIn = useCallback(async () => {
    if (Platform.OS === 'web') return;
    if (voiceState !== 'idle' || sending) return;
    await openVoiceMode('ptt');
  }, [voiceState, sending, openVoiceMode]);

  const handlePttPressOut = useCallback(() => {
    if (voiceModeRef.current !== 'ptt') return;
    // Stop capturing — keep the WS open so Mate can still respond. The
    // server-side VAD plus explicit audioStreamEnd flush whatever was
    // captured. Don't close the session here; onTurnComplete handles
    // the drain-and-close once the reply is done playing.
    const mic = micRef.current;
    micRef.current = null;
    if (mic) void mic.stop();
    voiceSessionRef.current?.endUserTurn();
    setVoiceState('thinking');
  }, []);

  // Always tear voice down when the screen unmounts so the mic isn't
  // left hot in the background.
  useEffect(() => {
    return () => {
      void stopVoiceSession();
    };
  }, [stopVoiceSession]);

  const handleCtaPress = useCallback(
    (message: ChatMessage) => {
      if (!message.cta) return;
      if (message.cta.action.type === 'open_quote') {
        handleNavigate({ kind: 'job_preview', quoteId: message.cta.action.quoteId });
      }
    },
    [handleNavigate],
  );

  const handleInlineQuoteEdit = useCallback(
    (quoteId: string, step: 'job' | 'materials' | 'labor') => {
      const quote = quotes.find((q) => q.id === quoteId);
      if (!quote) return;
      setCurrentQuote(quote);
      // Mirror JobsList/ViewJob: tap an edit affordance on the scope card,
      // land on the matching wizard step. Mate stays in history so the user
      // can come back and keep chatting.
      const screen =
        step === 'materials'
          ? 'MaterialsList'
          : step === 'labor'
            ? 'LaborMarkup'
            : 'Details';
      navigation.navigate('NewJob', { screen });
    },
    [navigation, quotes, setCurrentQuote],
  );

  const handleInlineQuoteOpen = useCallback(
    (quoteId: string) => {
      const quote = quotes.find((q) => q.id === quoteId);
      if (quote) setCurrentQuote(quote);
      navigation.navigate('NewJob', { screen: 'JobPreview' });
    },
    [navigation, quotes, setCurrentQuote],
  );

  const handleInlineJobEdit = useCallback(
    (jobId: string) => {
      navigation.navigate('NewJob', {
        screen: 'Details',
        params: { jobId, editing: true },
      });
    },
    [navigation],
  );

  // Pull the per-row out so its callbacks can be stabilised against `message`
  // identity rather than recreated on every parent render. MessageBubble and
  // ProposalCard are React.memo'd, so stable props let them skip work on
  // every composer keystroke / voice tick. This was the main cause of Android
  // chat feeling skippy.
  const ChatRow = useCallback(
    ({ item }: { item: ChatItem }) => (
      <ChatRowMemo
        item={item}
        onCtaPress={handleCtaPress}
        onApply={handleApply}
        onDismiss={handleDismiss}
        onInlineQuoteEdit={handleInlineQuoteEdit}
        onInlineQuoteOpen={handleInlineQuoteOpen}
        onInlineJobEdit={handleInlineJobEdit}
      />
    ),
    [
      handleApply,
      handleDismiss,
      handleCtaPress,
      handleInlineQuoteEdit,
      handleInlineQuoteOpen,
      handleInlineJobEdit,
    ],
  );
  const renderItem = ChatRow;

  const voiceActive = voiceState !== 'idle';
  const voiceAccent = voiceState === 'thinking' ? colors.primary : colors.error;
  const voiceLabel =
    voiceState === 'connecting'
      ? 'Connecting…'
      : voiceState === 'thinking'
        ? "Mate's thinking…"
        : voiceMode === 'ptt'
          ? 'Recording'
          : 'Listening';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <WebContainer style={styles.webBody}>
        {isEmpty ? (
          // Hero empty state — big record button front and centre. Keeps the
          // composer mounted below so typing is still one tap away.
          <View style={[styles.heroWrap, { paddingTop: insets.top + 8 }]}>
            <View style={styles.heroCenter}>
              <HeroRecordButton
                active={voiceMode === 'sticky' && voiceState === 'listening'}
                pending={voiceState === 'connecting' || voiceState === 'thinking'}
                onPress={handleVoiceToggle}
                accent={
                  voiceState === 'listening'
                    ? colors.error
                    : voiceState === 'thinking'
                      ? colors.primary
                      : colors.primary
                }
              />
              <Text
                style={[
                  styles.heroStatus,
                  voiceState === 'listening' && { color: colors.error },
                  voiceState === 'thinking' && { color: colors.primary },
                ]}
              >
                {voiceState === 'connecting'
                  ? 'Connecting…'
                  : voiceState === 'listening'
                    ? "I'm listening — yarn away"
                    : voiceState === 'thinking'
                      ? "Mate's thinking…"
                      : 'Tap to talk to Mate'}
              </Text>
              <Text style={styles.heroBlurb}>{introBlurb.primary}</Text>
              <Text style={styles.heroHint}>{introBlurb.hint}</Text>
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={items}
            keyExtractor={(i) => i.key}
            renderItem={renderItem}
            inverted={inverted}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            // Perf tuning — chat scroll on mid-range Android was skippy
            // because every parent re-render forced every bubble to re-render.
            // Memoising the row + these list knobs together keeps frames stable.
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            windowSize={9}
            removeClippedSubviews={Platform.OS === 'android'}
            // Web (non-inverted): keep pinned to the newest message as content
            // grows. While idle the content size is stable so this never fires,
            // leaving the user free to scroll up to the start.
            onContentSizeChange={
              inverted ? undefined : () => listRef.current?.scrollToEnd({ animated: false })
            }
          />
        )}

        {sending && (
          <View style={styles.typingRow}>
            <ActivityIndicator size="small" color={colors.textMuted} />
            <Text style={styles.typing}>Mate is thinking…</Text>
          </View>
        )}

        <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 8) + 70 }]}>
          <View
            style={[
              styles.composer,
              voiceActive && styles.composerActive,
              voiceState === 'thinking' && styles.composerThinking,
            ]}
          >
            {/* Left region morphs between the text input and the live
                waveform, but the buttons on the right stay mounted so a
                push-to-talk press never loses its onPressOut. */}
            {voiceActive ? (
              <View style={styles.inlineVoice}>
                <VoiceWave level={micLevel} accent={voiceAccent} />
                <Text style={[styles.inlineVoiceLabel, { color: voiceAccent }]} numberOfLines={1}>
                  {voiceLabel}
                </Text>
              </View>
            ) : (
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder="Ask Mate…"
                placeholderTextColor={colors.placeholder}
                editable={!sending}
                multiline
                returnKeyType="send"
                // iOS single-line Return fires onSubmitEditing; we keep multiline
                // for long messages but still want Return to send. On web, Enter
                // (without Shift) submits — Shift+Enter inserts a newline.
                onSubmitEditing={() => submit()}
                blurOnSubmit={false}
                {...(Platform.OS === 'web'
                  ? {
                      onKeyPress: (e: any) => {
                        if (e?.nativeEvent?.key === 'Enter' && !e?.nativeEvent?.shiftKey) {
                          e.preventDefault?.();
                          submit();
                        }
                      },
                    }
                  : {})}
              />
            )}

            {/* Mic / stop toggle. Hidden during PTT (driven by the send button
                being held) to keep the active row uncluttered. */}
            {voiceMode !== 'ptt' && (
              <View style={styles.voiceBtnWrap}>
                <MicPulse active={voiceMode === 'sticky' && voiceState === 'listening'} color={colors.error} />
                <TouchableOpacity
                  style={[
                    styles.voiceBtn,
                    voiceMode === 'sticky' && styles.voiceBtnActive,
                  ]}
                  onPress={handleVoiceToggle}
                  disabled={voiceState === 'connecting'}
                  accessibilityRole="button"
                  accessibilityLabel={voiceMode === 'sticky' ? 'Stop voice mode' : 'Start voice mode'}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {voiceState === 'connecting' && voiceMode === 'sticky' ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <MaterialCommunityIcons
                      name={voiceMode === 'sticky' ? 'stop' : 'microphone-outline'}
                      size={22}
                      color={colors.white}
                    />
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Send / push-to-talk. Hidden during sticky voice mode (there's
                nothing to send), but always mounted during PTT so the
                long-press → release gesture stays intact. */}
            {voiceMode !== 'sticky' && (
              <Pressable
                style={({ pressed }) => [
                  styles.sendBtn,
                  voiceMode === 'ptt' && styles.sendBtnRecording,
                  !input.trim() && voiceMode !== 'ptt' && styles.sendBtnDisabled,
                  pressed && styles.sendBtnPressed,
                ]}
                onPress={() => {
                  // Tap with text → send. Tap with no text → no-op (long-press
                  // would normally fire instead but iOS may emit onPress only).
                  if (!input.trim() || sending) return;
                  submit();
                }}
                onLongPress={handlePttPressIn}
                onPressOut={handlePttPressOut}
                delayLongPress={250}
                disabled={voiceMode !== 'ptt' && (sending || voiceState === 'connecting')}
                accessibilityRole="button"
                accessibilityLabel={
                  voiceMode === 'ptt'
                    ? 'Recording — release to send'
                    : input.trim()
                      ? 'Send message'
                      : 'Hold to record'
                }
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons
                  name={voiceMode === 'ptt' ? 'record-circle-outline' : 'arrow-up'}
                  size={22}
                  color={colors.white}
                />
              </Pressable>
            )}
          </View>
        </View>
      </WebContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  webBody: {
    flex: 1,
  },
  intro: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 16,
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
  },
  heroWrap: {
    flex: 1,
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
    paddingHorizontal: 24,
  },
  heroTop: {
    alignItems: 'center',
    paddingTop: 4,
  },
  heroBrand: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  heroCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 24,
  },
  heroStatus: {
    marginTop: 28,
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  heroBlurb: {
    marginTop: 14,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 12,
    maxWidth: 420,
  },
  heroHint: {
    marginTop: 8,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    letterSpacing: 0.2,
    paddingHorizontal: 12,
    maxWidth: 360,
  },
  introTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 6,
  },
  introSubtitle: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  list: { flex: 1 },
  listContent: {
    paddingVertical: 8,
    // Cap chat content on iPad/large screens so bubbles don't stretch
    // edge-to-edge — matches MaterialsListScreen's 800px cap. WebContainer
    // handles this on web, but it's a no-op on native, so set it here too.
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 6,
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
  },
  typing: { color: colors.textMuted, fontSize: 13 },
  composerWrap: {
    paddingHorizontal: 8,
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    maxHeight: 120,
  },
  // The voice "input" — waveform + status word — occupies the same flex slot
  // the TextInput would, centred to line up with the round buttons.
  inlineVoice: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingLeft: 4,
  },
  inlineVoiceLabel: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginLeft: 10,
  },
  waveRow: {
    flex: 1,
    justifyContent: 'center',
    height: 32,
    overflow: 'hidden',
  },
  sendBtn: {
    backgroundColor: colors.primary,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBtnWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBtn: {
    backgroundColor: colors.primary,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBtnActive: {
    backgroundColor: colors.error,
  },
  composerActive: {
    borderColor: colors.error,
    shadowColor: colors.error,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  composerThinking: {
    borderColor: colors.primary,
    shadowColor: colors.primary,
  },
  sendBtnRecording: {
    backgroundColor: colors.error,
  },
  sendBtnPressed: {
    opacity: 0.8,
  },
  sendBtnDisabled: {
    backgroundColor: colors.surfaceGray,
  },
});
