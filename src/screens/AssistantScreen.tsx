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
  AppState,
  Image,
  Linking,
} from 'react-native';
import type { AppStateStatus } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useThemeColors } from '../theme';
import { useStore, NavigateHint } from '../store/useStore';
import { trackEvent } from '../services/analyticsService';
import { useDemoPlayback } from '../demo/demoPlayback';
import { sendAssistantTurn } from '../services/assistantService';
import { openVoiceSession, VoiceSession } from '../services/assistant/voiceSession';
import { LiveAuthError, LiveOfflineError, LiveQuotaError } from '../services/assistant/liveSession';
import { rememberAppliedQuote } from '../services/assistant/quoteRefMap';
import { startMicCapture, MicCaptureHandle, MicUnavailableError, micPermissionGranted } from '../services/assistant/mic';
import { AudioQueue, createAudioQueue, ensureAudioMode } from '../services/assistant/audioPlayer';
import { activateKeepAwakeAsync } from 'expo-keep-awake';
import { shouldAutoStartMic, resolveAutoStartMic } from './assistant/shouldAutoStartMic';
import { getMateIntro, isBlankSlate } from './assistant/mateIntro';
import { buildGreetPrompt, withTypeInsteadHint } from './assistant/voiceCopy';
import {
  voiceActionForAppState,
  VOICE_INACTIVE_GRACE_MS,
  VOICE_BACKGROUND_GRACE_MS,
} from './assistant/voiceAppStatePolicy';
import { createGraceController } from './assistant/voiceGraceController';
import { createVoiceOpenGate } from './assistant/voiceOpenGate';

// Tag for the screen-wake lock held during voice mode. Keeping it the same
// across activate/deactivate calls means even if a second voice session
// opens before the first one fully tears down, we don't end up stacking
// untracked locks (expo-keep-awake refcounts per-tag).
const VOICE_KEEP_AWAKE_TAG = 'mate-voice-session';
// Auto-close a sticky voice session after this many ms of true silence —
// no speech detected, Mate not speaking, no narration, no tool/turn in
// flight. Saves a continuous drip of input-audio tokens (and the WS
// itself) when the tradie taps the mic, walks off, and forgets it's on.
// 90 s feels long enough that a thinking pause doesn't kill the session
// mid-conversation, but short enough that a pocketed phone doesn't burn
// dollars. The watchdog only fires while voiceState === 'listening' and
// no pipeline activity is happening, so a long tool call / narration
// won't trip it.
const VOICE_IDLE_TIMEOUT_MS = 90_000;
const VOICE_IDLE_CHECK_MS = 5_000;
import { generateId } from '../utils/generateId';
import { releaseKeepAwake } from '../utils/keepAwake';
import {
  ChatAttachment,
  ChatMessage,
  Proposal,
  ProposalStatus,
} from '../types/assistant';
import { MessageBubble } from '../components/assistant/MessageBubble';
import { ProposalCard } from '../components/assistant/ProposalCard';
import { WebContainer } from '../components/WebContainer';
import { GridBackground } from '../components/GridBackground';
import { ActionSheet, ActionSheetOption } from '../components/ActionSheet';
import { AlertModal, AlertType } from '../components/AlertModal';
import { SupplierListCaptureModal } from '../components/SupplierListCaptureModal';
import { auth } from '../config/firebase';
import { uploadQuotePhoto, sniffLocalPhotoMime, UnsupportedPhotoError } from '../services/photoService';
import { detectIsPlan } from '../services/planDetection';
import {
  ATTACH_LIMIT_COPY,
  canAttachMore,
  collectQuotePhotos,
  markAttachmentConsumedBy,
  markAttachmentsConsumed,
  mostRecentUnconsumedAttachment,
} from './assistant/chatAttachments';
import { buildSupplierGapNote } from '../services/assistant/supplierGapNote';
import { setUnconsumedAttachmentProbe } from '../services/assistant/proposalTools';
import { ensureLocalUri } from '../services/assistant/attachmentBytes';
import { useSupplierListImport, type ExtractResult } from '../hooks/useSupplierListImport';
import type { SaveSummary } from '../hooks/useSupplierListImport';
import { SupplierListReviewModal } from '../components/SupplierListReviewModal';
import { SpreadsheetColumnMapperModal } from '../components/SpreadsheetColumnMapperModal';
import { loadFavoritesFromLocal } from '../services/materialFavorites';
import { loadGroups } from '../services/supplierGroupService';
import { searchFavorites } from '../services/localMaterialMatcher';
import { invalidateSupplierBookCache } from '../services/supplierBook';
import { canRunMatePipeline } from '../store/planGates';
import type { AssistantSheetHint } from '../store/useStore';

interface AlertConfig {
  type: AlertType;
  title: string;
  message: string;
  primaryButtonText?: string;
  primaryButtonAction?: () => void;
  secondaryButtonText?: string;
  secondaryButtonAction?: () => void;
}

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
  const styles = useStyles();
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
  const styles = useStyles();
  const themeColors = useThemeColors();
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
  const styles = useStyles();
  const themeColors = useThemeColors();
  const heroStyles = useHeroStyles();
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
          <ActivityIndicator size="large" color={themeColors.onAccent} />
        ) : (
          <MaterialCommunityIcons
            name={active ? 'stop' : 'microphone'}
            size={56}
            color={themeColors.onAccent}
          />
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

const useHeroStyles = makeStyles((t) => ({
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
    borderColor: t.colors.border,
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
}));

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
  const styles = useStyles();
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<any>>();
  const route = useRoute<any>();
  // Ref mirror of route so the focus-count effect below can read the latest
  // params without re-running (and re-firing) when setParams clears them.
  const routeRef = useRef(route);
  routeRef.current = route;
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
  const businessSettings = useStore((s) => s.businessSettings);

  // Marketing demo playback — no-op unless this is a capture build with an
  // injected payload (see src/demo/demoPlayback.ts). Never runs for real users.
  useDemoPlayback();

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // Photos staged for the next message. Ref-mirrored so the upload loop and
  // submit() read the live tray rather than the render they were created in.
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const pendingAttachmentsRef = useRef<ChatAttachment[]>([]);
  useEffect(() => { pendingAttachmentsRef.current = pendingAttachments; }, [pendingAttachments]);
  const [photoSheetVisible, setPhotoSheetVisible] = useState(false);
  const [captureModalVisible, setCaptureModalVisible] = useState(false);
  const [alertConfig, setAlertConfig] = useState<AlertConfig | null>(null);

  // --- Supplier-list import -------------------------------------------------
  // The extracted rows live in a ref, not on the message: chat history is
  // in-memory only so the ref has the same lifetime, and a 400-row extraction
  // on a Firestore-mirrored message would be a 400-row write per flush.
  const supplierImportsRef = useRef<Map<string, ExtractResult>>(new Map());
  const activeImportIdRef = useRef<string | null>(null);
  const importCardPhaseRef = useRef<string>('');
  const [reviewImportId, setReviewImportId] = useState<string | null>(null);
  const reviewImportIdRef = useRef<string | null>(null);
  useEffect(() => { reviewImportIdRef.current = reviewImportId; }, [reviewImportId]);
  const [importSourceSheetVisible, setImportSourceSheetVisible] = useState(false);
  const importSupplierNameRef = useRef<string | undefined>(undefined);
  // Deterministic nudge control. The model is not trusted to remember it said
  // no once — a second ask about the same thing is how a helper becomes a nag.
  const importOfferRef = useRef<{ declined: boolean; offeredForQuote: Set<string> }>({
    declined: false,
    offeredForQuote: new Set(),
  });
  // The quote the chat is working on, so a finished import can say how much of
  // it now prices off the tradie's own list.
  const activeQuoteIdRef = useRef<string | null>(null);
  // Late-bound so the hook (and handleApply, which is declared first) can
  // reach handlers defined further down.
  const onImportSavedRef = useRef<(summary: SaveSummary) => void>(() => {});
  const startSupplierImportRef = useRef<(hint: AssistantSheetHint) => Promise<void>>(async () => {});
  const importer = useSupplierListImport({
    onSaved: (summary) => onImportSavedRef.current(summary),
  });
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  // Ref mirror of voiceState so long-lived closures (the sticky idle
  // watchdog interval) read the current value instead of the one
  // captured when the interval was installed.
  const voiceStateRef = useRef<VoiceState>('idle');
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);
  // Mirror state of voiceModeRef — drives the send-button icon swap and
  // the status-row copy. Refs alone don't trigger re-renders.
  const [voiceMode, setVoiceMode] = useState<'sticky' | 'ptt' | null>(null);
  const listRef = useRef<FlatList<ChatItem>>(null);
  // Composer input — the hero chips prefill it and pull focus so the tradie
  // lands mid-sentence, not mid-hunt.
  const inputRef = useRef<TextInput>(null);

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
  // Wall-clock ms of the last sign that the tradie (or Mate) is still in
  // the conversation: speech detected by server VAD, a model reply
  // streaming, a turn completing, narration running, etc. The sticky
  // idle watchdog (see openVoiceMode) compares against this to decide
  // when it's safe to auto-close.
  const lastVoiceActivityRef = useRef<number>(0);
  // setInterval handle for the sticky idle watchdog. Only ever set while
  // a sticky session is open; cleared in stopVoiceSession.
  const idleWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  // One assistant_opened per focus visit. The dashboard door navigates here
  // with { source: 'dashboard_door' }; the param is cleared after counting so
  // a later tab-bar visit reads as 'tab'. The route ref (not a dep) keeps the
  // setParams clear from re-running this and double-counting the visit.
  const openCountedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!openCountedRef.current) {
        openCountedRef.current = true;
        const fromDoor = routeRef.current?.params?.source === 'dashboard_door';
        trackEvent('assistant_opened', { source: fromDoor ? 'dashboard_door' : 'tab' });
        if (fromDoor) navigation.setParams({ source: undefined } as never);
      }
      return () => {
        openCountedRef.current = false;
      };
    }, [navigation]),
  );

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
  // Error-only / hidden-context-only conversations still count as blank —
  // the hero (with its capability line and the composer hint) must survive a
  // failed voice open, or the error bubble hides the fact that typing works.
  const isEmpty = isBlankSlate(conversation?.messages);
  const latestError = useMemo(() => {
    const messages = conversation?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].errorMessage) return messages[i].errorMessage;
    }
    return undefined;
  }, [conversation]);

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
    // Hidden messages are "[context]" notes for the model only — they ride in
    // the history sent to Gemini but must never render as a bubble.
    const visible = conversation.messages.filter((m) => !m.hidden);
    const ordered = inverted ? visible.slice().reverse() : visible;
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

  // Tell Mate what just happened. Voice has a live socket and takes the note
  // over the wire; text chat has no socket, so the note is parked in the
  // history as a hidden message the next turn will carry. Either way the
  // model learns the outcome — before this, text-mode Mate never found out
  // an Apply had failed and would re-propose the same broken card forever.
  const noteToMate = useCallback(
    (convoId: string, note: string) => {
      const liveSession = voiceSessionRef.current;
      if (liveSession?.isOpen()) {
        liveSession.sendContextNote(note);
        return;
      }
      appendMessage(convoId, {
        id: generateId(),
        role: 'user',
        text: note,
        createdAt: new Date().toISOString(),
        hidden: true,
      });
    },
    [appendMessage],
  );

  // Append an error bubble unless the tail of the chat already says the same
  // thing. A voice reconnect storm used to stack eleven identical "too many
  // requests" bubbles in ninety seconds; the tradie only needs to be told
  // once.
  const appendErrorMessage = useCallback(
    (convoId: string, errorMessage: string) => {
      const messages =
        useStore.getState().conversations.find((c) => c.id === convoId)?.messages || [];
      const last = messages[messages.length - 1];
      if (last?.errorMessage === errorMessage) return;
      appendMessage(convoId, {
        id: generateId(),
        role: 'assistant',
        text: '',
        createdAt: new Date().toISOString(),
        errorMessage,
      });
    },
    [appendMessage],
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

      // Photos the tradie sent in this chat ride onto the draft so the gear
      // generator reads them on its first pass. Snapshot the messages once —
      // the same list is stamped consumed further down.
      const messagesForPhotos =
        useStore.getState().conversations.find((c) => c.id === conversation.id)?.messages || [];
      const chatPhotos =
        proposal.type === 'propose_draft_quote' ? collectQuotePhotos(messagesForPhotos) : [];

      const result = await applyProposal(
        proposal,
        (status) => {
          if (!workingMessageId) return;
          updateMessage(conversation.id, workingMessageId, { working: status });
        },
        chatPhotos.length ? { photos: chatPhotos } : undefined,
      );

      // If the pipeline beat the narration timer (cached / fast path),
      // cancel it so we don't yarn AFTER the result.
      if (narrationTimer && !narrationFired) {
        clearTimeout(narrationTimer);
      }

      const mintedId = !result.ok || !result.navigate
        ? undefined
        : 'quoteId' in result.navigate ? result.navigate.quoteId
        : result.navigate.kind === 'open_invoice' ? result.navigate.invoiceId
        : undefined;
      if (mintedId) activeQuoteIdRef.current = mintedId;

      // The supplier-book gap, if this run is worth mentioning at all. Text
      // chat never receives [pipeline-done] (that needs an open live session),
      // so this rides the [context] line further down as well. Suppressed once
      // the tradie has knocked the import back, and once per quote — the model
      // is not trusted to remember either.
      const gapQuoteId = mintedId || (proposal.type === 'propose_reprice' ? proposal.quoteId : undefined);
      const gapNote =
        !importOfferRef.current.declined &&
        !(gapQuoteId && importOfferRef.current.offeredForQuote.has(gapQuoteId)) &&
        result.ok &&
        result.supplierGap
          ? buildSupplierGapNote(result.supplierGap)
          : null;
      if (gapNote && gapQuoteId) importOfferRef.current.offeredForQuote.add(gapQuoteId);

      if (narrating && liveSessionForNarration?.isOpen()) {
        const heads =
          (result.ok && result.review && result.review.issues.length > 0
            ? ` Heads up — ${result.review.summary} Work that into the line.`
            : '') + (gapNote ? ` ${gapNote}` : '');
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
        appendErrorMessage(
          conversation.id,
          result.error || 'Apply failed without an error message.',
        );
        // Free plan tapped a pipeline card — the fix is the paywall, not a
        // retry, so open it over the chat as well as marking the card failed.
        if (result.code === 'PLAN_GATED') {
          navigation.navigate('Paywall', { source: 'mate' });
        }
        // Tell the model too. It has no other way to know the card failed —
        // it only ever saw `{ ok: true, proposalId }` from the tool call —
        // which is how a tradie ended up tapping the same broken "mark paid"
        // card three times in a row while Mate re-proposed it each time.
        noteToMate(
          conversation.id,
          `[context] The tradie tapped Apply on ${proposal.type} and it FAILED: ` +
            `"${result.error || 'unknown error'}". Do NOT propose the same action again — ` +
            `it will fail the same way. Tell them plainly what went wrong in one short line, ` +
            `and either try a genuinely different approach or point them at the manual path ` +
            `in the app. Never claim it worked.`,
        );
        return;
      }
      // A sheet opens OVER the chat — never route it through handleNavigate,
      // which would leave the conversation the import is for.
      if (result.sheet?.kind === 'supplier_import') {
        await startSupplierImportRef.current(result.sheet);
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
      if (mintedId) rememberAppliedQuote(proposal.id, mintedId);

      // Claim the photos this draft carried. Without the stamp, an unrelated
      // second job drafted in the same chat would inherit them.
      if (proposal.type === 'propose_draft_quote' && chatPhotos.length > 0 && mintedId) {
        for (const patch of markAttachmentsConsumed(messagesForPhotos, mintedId)) {
          updateMessage(conversation.id, patch.messageId, { attachments: patch.attachments });
        }
      }

      // Feed Mate the resolved quote id so it stops trying to re-find the
      // draft via list_recent_quotes on the next turn. noteToMate picks the
      // right channel: the live socket in voice (logged as context without
      // speaking a reply), a hidden history message in text.
      const note = (text: string) => noteToMate(conversation.id, text);
      // Most context notes need result.navigate (they reference the minted
      // quote/invoice/contact id). propose_delete_quote is the exception —
      // the doc is gone, so it never returns a navigate, but Mate still
      // needs the heads-up that the id is dead.
      if (proposal.type === 'propose_delete_quote') {
        const label = proposal.displayName || proposal.displayCustomerName || proposal.quoteId;
        note(
          `[context] Deleted ${proposal.displayDocType || 'quote'} ${proposal.quoteId} ("${label}"). ` +
            `It's gone — do NOT reference this id on follow-ups, and don't list it.`,
        );
      }
      if (result.navigate) {
        switch (proposal.type) {
          case 'propose_draft_quote':
            if (result.navigate.kind === 'job_preview' || result.navigate.kind === 'quote_materials_list') {
              note(
                `[context] The tradie tapped Apply on propose_draft_quote. ` +
                `The resulting quote is ${result.navigate.quoteId} ` +
                `("${proposal.jobName}"). Reference this id on follow-ups; ` +
                `do not draft a new quote for the same job.` +
                (chatPhotos.length
                  ? ` Their site photos are on it — don't ask them to add photos again.`
                  : '') +
                (gapNote ? ` ${gapNote}` : ''),
              );
            }
            break;
          case 'propose_add_line_item':
            note(
              `[context] Added "${proposal.searchTerm}" (${proposal.qty} ${proposal.unit}) to quote ${proposal.quoteId}.`,
            );
            break;
          case 'propose_delete_line_item':
            note(
              `[context] Removed material ${proposal.materialId} from quote ${proposal.quoteId}.`,
            );
            break;

          case 'propose_send_quote':
            note(
              `[context] Sent quote ${proposal.quoteId} to the customer.`,
            );
            break;
          case 'propose_convert_to_invoice':
            if (result.navigate.kind === 'open_invoice') {
              note(
                `[context] Converted quote ${proposal.quoteId} to invoice ${result.navigate.invoiceId}.`,
              );
            }
            break;
          case 'propose_create_contact':
            if (result.navigate.kind === 'open_contact') {
              note(
                `[context] Created new contact ${result.navigate.contactId} ("${proposal.name}").`,
              );
            }
            break;
          case 'propose_update_customer':
            note(
              `[context] Changed the customer on quote ${proposal.quoteId}` +
              (proposal.customerName ? ` to "${proposal.customerName}".` : '.'),
            );
            break;
          case 'propose_reprice':
            note(
              `[context] Re-priced quote ${proposal.quoteId}.` +
              (result.review ? ` ${result.review.summary}` : '') +
              (gapNote ? ` ${gapNote}` : ''),
            );
            break;
          case 'propose_update_quote_rates': {
            const parts: string[] = [];
            if (typeof proposal.markup === 'number') parts.push(`markup ${proposal.markup}%`);
            if (typeof proposal.laborMarkup === 'number') parts.push(`labour markup ${proposal.laborMarkup}%`);
            if (typeof proposal.laborRate === 'number') parts.push(`labour rate $${proposal.laborRate}/h`);
            if (typeof proposal.laborHours === 'number') parts.push(`labour hours ${proposal.laborHours}`);
            note(
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
        if (result.navigate?.kind === 'open_invoice') {
          const label = proposal.displayName || proposal.displayCustomerName || 'that invoice';
          note(
            `[context] Marked invoice ${result.navigate.invoiceId} ("${label}") as paid in full. ` +
              `The books are updated — confirm to the tradie in one short line, don't navigate or re-show it.`,
          );
        }
        return;
      }

      handleNavigate(result.navigate);
    },
    [
      conversation,
      applyProposal,
      appendMessage,
      appendErrorMessage,
      noteToMate,
      updateMessage,
      updateProposalStatus,
      handleNavigate,
      navigation,
    ],
  );

  const handleDismiss = useCallback(
    (message: ChatMessage, proposal: Proposal) => {
      if (!conversation) return;
      updateProposalStatus(conversation.id, message.id, proposal.id, 'dismissed');
      // A "no thanks" on the price-list import is final for this chat. Told to
      // the model AND enforced here — dedupe is not something to leave to it.
      if (proposal.type === 'propose_import_supplier_list') {
        importOfferRef.current.declined = true;
        noteToMate(
          conversation.id,
          "[context] The tradie knocked back the supplier-list import. Don't offer it again in this chat.",
        );
      }
    },
    [conversation, updateProposalStatus, noteToMate],
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
      // The quote a finished import measures its coverage against.
      activeQuoteIdRef.current = quoteId;
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

  const showAlert = useCallback((config: AlertConfig) => setAlertConfig(config), []);
  const dismissAlert = useCallback(() => setAlertConfig(null), []);

  // Mate only ever asks for "the photo they just sent" — it never sees or
  // names an attachment id. The validator asks this before it lets a
  // source:'attachment' import through.
  useEffect(() => {
    setUnconsumedAttachmentProbe(() => {
      const state = useStore.getState();
      const messages =
        state.conversations.find((c) => c.id === state.currentConversationId)?.messages || [];
      return !!mostRecentUnconsumedAttachment(messages);
    });
    return () => setUnconsumedAttachmentProbe(() => false);
  }, []);

  // Nobody wants Mate talking over them while they edit forty rows of prices.
  // stop() is terminal on an audio queue, so resuming means a fresh one.
  const suspendVoiceForModal = useCallback(() => {
    narrationModeRef.current = false;
    const queue = audioQueueRef.current;
    audioQueueRef.current = null;
    matePlayingRef.current = false;
    if (queue) { try { void queue.stop(); } catch { /* noop */ } }
  }, []);

  const resumeVoiceAfterModal = useCallback(() => {
    if (!voiceSessionRef.current || audioQueueRef.current) return;
    const queue = createAudioQueue();
    queue.setOnActiveChange((active) => {
      matePlayingRef.current = active;
      if (active) lastVoiceActivityRef.current = Date.now();
    });
    audioQueueRef.current = queue;
    lastVoiceActivityRef.current = Date.now();
  }, []);

  const openSupplierReview = useCallback(
    (importId: string) => {
      suspendVoiceForModal();
      setReviewImportId(importId);
    },
    [suspendVoiceForModal],
  );

  const closeSupplierReview = useCallback(() => {
    setReviewImportId(null);
    importer.cancelReview();
    resumeVoiceAfterModal();
  }, [importer, resumeVoiceAfterModal]);

  /**
   * Open the price-list reader over the chat. Never navigates — the import
   * exists to fix the quote the tradie is mid-conversation about.
   */
  const startSupplierImport = useCallback(
    async (hint: AssistantSheetHint) => {
      importSupplierNameRef.current = hint.supplierName;
      const state = useStore.getState();
      const convoId = state.conversations.find((c) => c.id === state.currentConversationId)?.id;
      if (!convoId) return;

      if (hint.source === 'attachment') {
        const messages = state.conversations.find((c) => c.id === convoId)?.messages || [];
        const attachment = mostRecentUnconsumedAttachment(messages);
        if (attachment) {
          // Claim it first — a price list is not a site photo, and it must not
          // also ride onto the quote.
          for (const patch of markAttachmentConsumedBy(messages, attachment.id, 'supplier_import')) {
            updateMessage(convoId, patch.messageId, { attachments: patch.attachments });
          }
          // FileSystem.readAsStringAsync can't read https://, so a photo whose
          // local copy is gone gets pulled back into the cache first.
          const uri = await ensureLocalUri(attachment);
          if (!uri) {
            appendMessage(convoId, {
              id: generateId(),
              role: 'assistant',
              text: "Lost that photo — send it again and I'll read it.",
              createdAt: new Date().toISOString(),
            });
            return;
          }
          await importer.importFromUris({
            uris: [uri],
            mimeType: attachment.mimeType,
            supplierName: hint.supplierName,
          });
          return;
        }
        // Nothing spare to read — fall through and ask.
      }

      if (
        hint.source === 'camera' ||
        hint.source === 'gallery' ||
        hint.source === 'pdf' ||
        hint.source === 'spreadsheet'
      ) {
        await importer.startImport(hint.source);
        return;
      }
      setImportSourceSheetVisible(true);
    },
    [importer, appendMessage, updateMessage],
  );

  useEffect(() => { startSupplierImportRef.current = startSupplierImport; }, [startSupplierImport]);

  const importSourceOptions: ActionSheetOption[] = useMemo(
    () => [
      { icon: 'camera', label: 'Snap the price list', onPress: () => { void importer.startImport('camera'); } },
      { icon: 'image-multiple', label: 'Pick from photos', onPress: () => { void importer.startImport('gallery'); } },
      { icon: 'file-pdf-box', label: 'PDF price list', onPress: () => { void importer.startImport('pdf'); } },
      { icon: 'file-document-edit-outline', label: 'Spreadsheet (CSV or Excel)', onPress: () => { void importer.startImport('spreadsheet'); } },
    ],
    [importer],
  );

  // Mount the card the moment extraction actually starts — not when a picker
  // opens, or a cancelled pick would leave a card spinning forever.
  useEffect(() => {
    if (importer.phase !== 'extracting' || activeImportIdRef.current || !conversation) return;
    const importId = generateId();
    activeImportIdRef.current = importId;
    importCardPhaseRef.current = 'extracting';
    appendMessage(conversation.id, {
      id: importId,
      role: 'assistant',
      text: '',
      createdAt: new Date().toISOString(),
      supplierImport: { importId, phase: 'extracting' },
    });
  }, [importer.phase, conversation, appendMessage]);

  // Extraction landed — park the rows in the ref, flip the card, open the
  // reader. The message id IS the import id, so updates need no lookup table.
  useEffect(() => {
    const importId = activeImportIdRef.current;
    if (!importId || !conversation) return;
    if (importCardPhaseRef.current !== 'extracting') return;
    if (importer.phase !== 'reviewing' || !importer.extractedItems.length) return;
    importCardPhaseRef.current = 'ready';
    activeImportIdRef.current = null;
    supplierImportsRef.current.set(importId, {
      supplierName: importer.extractedSupplierName,
      supplierContact: importer.extractedSupplierContact,
      items: importer.extractedItems,
    });
    updateMessage(conversation.id, importId, {
      supplierImport: {
        importId,
        phase: 'ready',
        supplierName: importer.extractedSupplierName || undefined,
        itemCount: importer.extractedItems.length,
        sampleNames: importer.extractedItems.slice(0, 3).map((i) => i.name),
      },
      cta: { label: 'Check & save', action: { type: 'open_supplier_review', importId } },
    });
    openSupplierReview(importId);
  }, [
    importer.phase,
    importer.extractedItems,
    importer.extractedSupplierName,
    importer.extractedSupplierContact,
    conversation,
    updateMessage,
    openSupplierReview,
  ]);

  // Extraction failed. On site, "no signal" is the likeliest cause and the
  // right advice is "keep the photo", not "try a sharper one".
  useEffect(() => {
    const importId = activeImportIdRef.current;
    if (!importId || !conversation || !importer.errorMessage) return;
    activeImportIdRef.current = null;
    importCardPhaseRef.current = '';
    const offline = /network|offline|internet|connection|timed out/i.test(importer.errorMessage);
    updateMessage(conversation.id, importId, {
      supplierImport: {
        importId,
        phase: 'failed',
        error: offline
          ? "No signal — hang onto that photo and I'll read it when you're back on."
          : importer.errorMessage,
      },
      cta: { label: 'Try again', action: { type: 'open_supplier_review', importId } },
    });
    importer.clearError();
  }, [importer.errorMessage, importer.clearError, conversation, updateMessage]);

  // Backing out of the column mapper drops the importer to idle with no rows
  // and no error, which would leave the card spinning forever.
  useEffect(() => {
    const importId = activeImportIdRef.current;
    if (!importId || !conversation) return;
    if (importer.phase !== 'idle' || importCardPhaseRef.current !== 'extracting') return;
    if (importer.errorMessage) return;
    activeImportIdRef.current = null;
    importCardPhaseRef.current = '';
    updateMessage(conversation.id, importId, {
      supplierImport: {
        importId,
        phase: 'failed',
        error: "Didn't get a price list out of that one.",
      },
      cta: { label: 'Try again', action: { type: 'open_supplier_review', importId } },
    });
  }, [importer.phase, importer.errorMessage, conversation, updateMessage]);

  /**
   * THE guard that decides whether this feature looks like it works. An
   * imported list that silently doesn't match is indistinguishable from a
   * broken import: the pipeline searches "Colorbond fence infill sheet 1.8m
   * per piece" against an imported "Colorbond sheet 1.8m Monument", and below
   * the 0.6 threshold nothing happens and the tradie can't tell why. So count
   * the real matches and say the number.
   */
  const countCoveredRows = useCallback(async (quoteId: string): Promise<number> => {
    try {
      const state = useStore.getState();
      const materials =
        state.getDocumentById(quoteId)?.materials ||
        state.quotes.find((q) => q.id === quoteId)?.materials ||
        [];
      if (!materials.length) return 0;
      const [favorites, groups] = await Promise.all([
        loadFavoritesFromLocal(),
        loadGroups().catch(() => []),
      ]);
      const favList = Object.values(favorites);
      let covered = 0;
      for (const m of materials) {
        const term = m.searchTerm || m.name;
        if (!term) continue;
        if (searchFavorites(term, favList, groups).length > 0) covered += 1;
      }
      return covered;
    } catch {
      return 0;
    }
  }, []);

  useEffect(() => {
    onImportSavedRef.current = (summary: SaveSummary) => {
      const importId = reviewImportIdRef.current;
      setReviewImportId(null);
      resumeVoiceAfterModal();
      // Without this the next get_job_requirements still reports an empty book
      // and Mate re-offers the import it just finished.
      invalidateSupplierBookCache();
      const convoId = useStore.getState().currentConversationId;
      if (!convoId) return;
      const quoteId = activeQuoteIdRef.current;
      void (async () => {
        const coveredRows = quoteId ? await countCoveredRows(quoteId) : 0;
        if (importId) {
          updateMessage(convoId, importId, {
            supplierImport: {
              importId,
              phase: 'saved',
              supplierName: summary.supplierName || undefined,
              savedCount: summary.itemCount,
              coveredRows,
            },
            cta: undefined,
          });
        }
        // Only dangle a re-price at someone who can actually run one —
        // rewarding a successful import with a paywall is worse than silence.
        const canReprice = canRunMatePipeline(useStore.getState().getEffectivePlan());
        const tail =
          coveredRows > 0 && quoteId
            ? canReprice
              ? ` ${coveredRows} row${coveredRows === 1 ? '' : 's'} on quote ${quoteId} would now price off their own list — offer propose_reprice in one short line.`
              : ` ${coveredRows} row${coveredRows === 1 ? '' : 's'} on quote ${quoteId} would now price off their own list, but re-pricing isn't in their plan. Say the list is saved and the next quote will use it — do NOT offer a re-price.`
            : ' Nothing on the quote in hand matched it yet — say the list is saved and move on.';
        noteToMate(
          convoId,
          `[context] The tradie saved ${summary.itemCount} item${summary.itemCount === 1 ? '' : 's'}` +
            (summary.supplierName ? ` from ${summary.supplierName}` : '') +
            ` into their supplier book.${tail}`,
        );
      })();
    };
  }, [countCoveredRows, noteToMate, resumeVoiceAfterModal, updateMessage]);

  /**
   * Land an upload's outcome wherever the attachment has got to. A tradie who
   * hits send mid-upload has already moved it out of the tray and onto a
   * message — patching only the tray would leave that bubble spinning forever
   * and the photo with no storageUrl to ride onto a quote.
   */
  const settleAttachment = useCallback(
    (id: string, patch: Partial<ChatAttachment>) => {
      if (pendingAttachmentsRef.current.some((p) => p.id === id)) {
        pendingAttachmentsRef.current = pendingAttachmentsRef.current.map((p) =>
          p.id === id ? { ...p, ...patch } : p,
        );
        setPendingAttachments((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
        return;
      }
      const state = useStore.getState();
      const convo = state.conversations.find((c) => c.id === state.currentConversationId);
      if (!convo) return;
      for (const m of convo.messages) {
        if (!m.attachments?.some((a) => a.id === id)) continue;
        updateMessage(convo.id, m.id, {
          attachments: m.attachments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        });
      }
    },
    [updateMessage],
  );

  /**
   * Stage picked photos on the composer and upload each one. Uploads run
   * SEQUENTIALLY — parallel uploadBytes calls from RN have historically hit
   * XHR/blob races on some devices (same reason JobPhotos does it this way).
   */
  const attachUris = useCallback(
    async (uris: string[], opts: { isPlan?: boolean } = {}) => {
      if (!uris.length) return;
      const userId = auth.currentUser?.uid;
      if (!userId) {
        showAlert({ type: 'error', title: 'Not signed in', message: 'Sign in to send Mate a photo.' });
        return;
      }
      const state = useStore.getState();
      const messages = state.conversations.find((c) => c.id === state.currentConversationId)?.messages || [];

      let staged = [...pendingAttachmentsRef.current];
      const accepted: ChatAttachment[] = [];
      let blocked: string | undefined;
      for (const uri of uris) {
        // A 14MB plan is ~19MB of base64 — past the 1st-gen request cap. Job
        // Photos carries PDFs end-to-end; chat doesn't.
        if ((await sniffLocalPhotoMime(uri)) === 'application/pdf') {
          blocked = ATTACH_LIMIT_COPY.pdf;
          continue;
        }
        // detectIsPlan is web-only by design, so the native sheet's explicit
        // "Plan or drawing" option is the only route to PLAN_MAX_WIDTH there.
        const isPlan = opts.isPlan ?? (await detectIsPlan(uri));
        const gate = canAttachMore({ pending: staged, messages, isPlan });
        if (!gate.ok) {
          blocked = gate.message;
          break;
        }
        const attachment: ChatAttachment = {
          id: generateId(),
          localUri: uri,
          isPlan,
          status: 'uploading',
        };
        accepted.push(attachment);
        staged = [...staged, attachment];
      }
      if (accepted.length) {
        pendingAttachmentsRef.current = staged;
        setPendingAttachments(staged);
      }
      if (blocked) showAlert({ type: 'info', title: 'Photos', message: blocked });

      for (const attachment of accepted) {
        try {
          const storageUrl = await uploadQuotePhoto(userId, attachment.localUri!, {
            isPlan: attachment.isPlan,
          });
          settleAttachment(attachment.id, { storageUrl, status: 'ready' });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[Mate] attachment upload failed', err);
          settleAttachment(attachment.id, { status: 'failed' });
          if (err instanceof UnsupportedPhotoError) {
            showAlert({ type: 'error', title: 'File not supported', message: err.message });
          }
        }
      }
    },
    [showAlert, settleAttachment],
  );

  const removeAttachment = useCallback((id: string) => {
    pendingAttachmentsRef.current = pendingAttachmentsRef.current.filter((p) => p.id !== id);
    setPendingAttachments((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const pickFromGallery = useCallback(
    async (opts: { isPlan?: boolean } = {}) => {
      const current = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (current.status !== 'granted') {
        if (!current.canAskAgain) {
          showAlert({
            type: 'warning',
            title: 'Photo Library Access Needed',
            message:
              'QuoteMate needs photo library access to send Mate a photo. You can enable it in Settings.',
            primaryButtonText: 'Open Settings',
            primaryButtonAction: () => {
              dismissAlert();
              Linking.openSettings();
            },
            secondaryButtonText: 'Not Now',
            secondaryButtonAction: dismissAlert,
          });
          return;
        }
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsMultipleSelection: true,
        // 0 (unlimited) keeps iOS in multi-select mode; the caps are applied
        // in attachUris, which can explain itself.
        selectionLimit: 0,
      });
      if (result.canceled || !result.assets?.length) return;
      await attachUris(result.assets.map((a) => a.uri), opts);
    },
    [attachUris, showAlert, dismissAlert],
  );

  const openCameraCapture = useCallback(async () => {
    // The capture modal handles its own permission prompt, but a previously
    // denied camera leaves the user stuck on it — deep-link to Settings.
    const current = await ImagePicker.getCameraPermissionsAsync();
    if (current.status !== 'granted' && !current.canAskAgain) {
      showAlert({
        type: 'warning',
        title: 'Camera Access Needed',
        message: 'QuoteMate needs camera access to take a photo for Mate. You can enable it in Settings.',
        primaryButtonText: 'Open Settings',
        primaryButtonAction: () => {
          dismissAlert();
          Linking.openSettings();
        },
        secondaryButtonText: 'Not Now',
        secondaryButtonAction: dismissAlert,
      });
      return;
    }
    setCaptureModalVisible(true);
  }, [showAlert, dismissAlert]);

  const showAttachOptions = useCallback(() => {
    // Web auto-detects plans and has no camera sheet worth showing — go
    // straight to the picker, same as JobPhotos.
    if (Platform.OS === 'web') {
      void pickFromGallery();
      return;
    }
    setPhotoSheetVisible(true);
  }, [pickFromGallery]);

  const attachSheetOptions: ActionSheetOption[] = useMemo(
    () => [
      { icon: 'camera', label: 'Take Photo', onPress: () => { void openCameraCapture(); } },
      { icon: 'image-multiple', label: 'Photo Library', onPress: () => { void pickFromGallery(); } },
      { icon: 'floor-plan', label: 'Plan or drawing (hi-res)', onPress: () => { void pickFromGallery({ isPlan: true }); } },
    ],
    [openCameraCapture, pickFromGallery],
  );

  const submit = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      const pending = pendingAttachmentsRef.current;
      // A photo with no caption is a perfectly good message.
      if ((!text && !pending.length) || sending) return;
      // Resolve the active conversation against the current store, not the
      // closure — `currentConversationId` can point at a missing conversation
      // (e.g. right after newChat replaced the array). Always validate first.
      const storeState = useStore.getState();
      let convoId = storeState.conversations.find((c) => c.id === storeState.currentConversationId)?.id;
      if (!convoId) convoId = startConversation();
      const currentMessages =
        useStore.getState().conversations.find((c) => c.id === convoId)?.messages || [];

      setInput('');
      // Clear the ref synchronously: an upload still in flight settles onto
      // the message from here on, not the tray.
      pendingAttachmentsRef.current = [];
      setPendingAttachments([]);
      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        text,
        createdAt: new Date().toISOString(),
        ...(pending.length ? { attachments: pending } : {}),
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

  // Bump the idle watchdog. Called from every signal that means the
  // session is still in use — server-side VAD picked up speech, Mate is
  // replying, a tool just ran, etc. Cheap, fires often.
  const touchVoiceActivity = useCallback(() => {
    lastVoiceActivityRef.current = Date.now();
  }, []);

  // Serialises opens against stops — see voiceOpenGate for the two races.
  const voiceOpenGateRef = useRef(createVoiceOpenGate());
  // Wall-clock ms of the last auto-start attempt. Feeds the cooldown that
  // stops any residual AppState/focus churn from re-minting in a tight loop
  // (the "too many requests" mint storm). Manual taps bypass it.
  const lastAutoStartAttemptRef = useRef(0);

  const stopVoiceSession = useCallback(async () => {
    // Cancel any open still in flight so it can't resurrect refs after
    // this teardown finishes.
    voiceOpenGateRef.current.invalidate();
    const mic = micRef.current;
    const queue = audioQueueRef.current;
    const session = voiceSessionRef.current;
    micRef.current = null;
    audioQueueRef.current = null;
    voiceSessionRef.current = null;
    voiceModeRef.current = null;
    setVoiceMode(null);
    matePlayingRef.current = false;
    // Kill the idle watchdog so it can't fire after teardown.
    if (idleWatchdogRef.current) {
      clearInterval(idleWatchdogRef.current);
      idleWatchdogRef.current = null;
    }
    // Release the wake lock now that the session is torn down. Fire-and-
    // forget — if it fails (or the tag was never held, e.g. open errored
    // before activate) the OS just keeps the default sleep behaviour.
    releaseKeepAwake(VOICE_KEEP_AWAKE_TAG);
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
          <MaterialCommunityIcons name="square-edit-outline" size={22} color={themeColors.text} />
          <Text style={{ color: themeColors.text, fontSize: 15, fontWeight: '600', marginLeft: 5 }}>
            New
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, handleNewChat, isEmpty]);

  const openVoiceMode = useCallback(async (mode: 'sticky' | 'ptt') => {
    // One open at a time. The auto-start path awaits a permission check
    // before landing here, so a manual tap can arrive concurrently — without
    // this, both opens run and the loser's mic/queue/socket are orphaned.
    const gate = voiceOpenGateRef.current;
    const openToken = gate.tryBegin();
    if (openToken === null || voiceModeRef.current) {
      if (openToken !== null) gate.end(openToken);
      return;
    }
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

      // The audio queue is single-use — stop() is terminal (no restart), so a
      // reconnect swaps in a fresh queue rather than reusing the drained one.
      const makeQueue = () => {
        const q = createAudioQueue();
        q.setOnActiveChange((active) => {
          matePlayingRef.current = active;
          // Audio playback is itself activity — don't time out mid-reply.
          if (active) touchVoiceActivity();
        });
        return q;
      };

      session = await openVoiceSession(seedHistory, {
        onReconnecting: (attempt) => {
          // The socket dropped mid-session (patchy site coverage). Whatever
          // turn was in flight is gone — flush the half-open bubbles so the
          // next turn starts clean, cut the stale audio, and show connecting
          // instead of an error.
          touchVoiceActivity();
          userBubbleIdRef.current = null;
          userBubbleTextRef.current = '';
          assistantBubbleIdRef.current = null;
          assistantBubbleTextRef.current = '';
          const staleQueue = audioQueueRef.current;
          audioQueueRef.current = null;
          matePlayingRef.current = false;
          if (staleQueue) { try { void staleQueue.stop(); } catch { /* noop */ } }
          setVoiceState('connecting');
          // eslint-disable-next-line no-console
          console.log('[Mate voice] reconnecting, attempt', attempt);
        },
        onReconnected: () => {
          touchVoiceActivity();
          audioQueueRef.current = makeQueue();
          setVoiceState('listening');
        },
        onInputTranscription: (text, finished) => {
          if (!text) return;
          // Real speech detected by server VAD — keep the watchdog at bay.
          touchVoiceActivity();
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
          touchVoiceActivity();
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
          touchVoiceActivity();
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
          touchVoiceActivity();
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
          // Mate just finished replying. Reset the idle clock so the
          // tradie gets a full timeout window to respond before we
          // auto-close.
          touchVoiceActivity();
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
          appendErrorMessage(convoId!, withTypeInsteadHint(err.message));
          void stopVoiceSession();
        },
        onClose: () => {
          void stopVoiceSession();
        },
      }, {
        // Sticky sessions ride out socket drops (job-site coverage comes and
        // goes); PTT is single-shot — half a push-to-talk turn can't be
        // restored, so it just ends like before.
        reconnect: mode === 'sticky',
        // Reseed with the latest transcript so turns spoken since the
        // original open survive the reconnect.
        getSeedHistory: () =>
          useStore.getState().conversations.find((c) => c.id === convoId)?.messages || [],
      });

      // A stop landed while the mint/handshake was in flight — this open is
      // cancelled. Close the fresh session instead of resurrecting refs the
      // teardown just nulled (hot mic + live socket behind an idle UI).
      if (!gate.isCurrent(openToken)) {
        try { session.close(); } catch { /* noop */ }
        return;
      }

      voiceSessionRef.current = session;
      audioQueueRef.current = makeQueue();

      // Sticky-only idle watchdog. PTT auto-closes on turnComplete already,
      // so it doesn't need this. We only ever fire the auto-close when the
      // session is parked at 'listening' with nothing in flight — every
      // other state is the pipeline doing real work and must be left alone.
      touchVoiceActivity();
      if (mode === 'sticky') {
        idleWatchdogRef.current = setInterval(() => {
          // Guard: pipeline activity — any of these and we're still working.
          if (voiceModeRef.current !== 'sticky') return;
          if (!voiceSessionRef.current) return;
          if (matePlayingRef.current) return;          // Mate is speaking
          if (narrationModeRef.current) return;        // post-Apply narration
          if (userBubbleIdRef.current) return;         // tradie mid-utterance
          if (assistantBubbleIdRef.current) return;    // model still streaming
          if (pendingVoiceActionRef.current) return;   // voice card action queued
          // Only auto-close while we're actually parked waiting for the
          // tradie. 'connecting' / 'thinking' mean a tool call or initial
          // handshake is still in flight — don't yank the rug.
          if (voiceStateRef.current !== 'listening') return;
          const idleFor = Date.now() - lastVoiceActivityRef.current;
          if (idleFor < VOICE_IDLE_TIMEOUT_MS) return;
          // Quiet auto-close. Drop a short note in the chat so the tradie
          // sees why the mic stopped pulsing next time they look.
          // eslint-disable-next-line no-console
          console.log('[Mate voice] idle auto-close after', Math.round(idleFor / 1000), 's');
          const cid = convoId;
          if (cid) {
            appendMessage(cid, {
              id: generateId(),
              role: 'assistant',
              text: "Quiet on the line — I've stepped off the mic. Tap it again when you want to keep yarning.",
              createdAt: new Date().toISOString(),
            });
          }
          void stopVoiceSession();
        }, VOICE_IDLE_CHECK_MS);
      }

      // Fresh chat + sticky (big record button) mode: get Mate to kick things
      // off with a short, slightly cheeky Aussie greeting so the tradie hears
      // a voice the moment the session connects, instead of dead air. Skipped
      // for PTT (the user's already talking) and for resumed conversations —
      // but an error-only history still greets (isBlankSlate), or a retry
      // after a failed open would connect to dead air.
      if (mode === 'sticky' && isBlankSlate(seedHistory)) {
        const latestDraft = useStore
          .getState()
          .quotes.filter((q) => q.status === 'draft')
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
        const draftLabel = latestDraft
          ? latestDraft.job?.name?.trim() ||
            (latestDraft.customerName ? `${latestDraft.customerName}'s job` : '')
          : '';
        session.sendUserText(buildGreetPrompt({ hour: new Date().getHours(), draftLabel }));
      }

      // Open the mic only once the session handshake completed — earlier
      // chunks would queue inside voiceSession until setupComplete anyway,
      // but starting the mic now keeps the buffer small. On web the
      // first call also triggers the browser permission prompt, so this
      // is awaited.
      try {
        const mic = await startMicCapture((chunk) => {
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
        // A stop landed while the mic was spinning up — release it instead
        // of assigning it into a ref the teardown already nulled.
        if (!gate.isCurrent(openToken)) {
          try { void mic.stop(); } catch { /* noop */ }
          return;
        }
        micRef.current = mic;
      } catch (err: any) {
        appendErrorMessage(
          convoId!,
          withTypeInsteadHint(
            err instanceof MicUnavailableError
              ? err.message
              : `Mate couldn't open the mic: ${err?.message || 'unknown error'}`,
          ),
        );
        await stopVoiceSession();
        return;
      }

      setVoiceState('listening');
      gate.end(openToken);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('[Mate voice] open failed', err?.name, err?.message);
      const message =
        err instanceof LiveQuotaError ||
        err instanceof LiveOfflineError ||
        err instanceof LiveAuthError
          ? err.message
          : `Voice mode is offline: ${err?.message || 'unknown error'}`;
      appendErrorMessage(convoId!, withTypeInsteadHint(message));
      await stopVoiceSession();
    }
  }, [stopVoiceSession, appendMessage, appendErrorMessage, updateMessage, startConversation, micLevel, handleApply, handleDismiss, showQuoteInChat]);

  // Keep the latest openVoiceMode / stopVoiceSession in refs so the
  // auto-start focus effect below can call them without taking them as
  // deps. Their identities change on every conversation mutation (via
  // handleApply/handleDismiss), and depending on them directly would re-run
  // the focus effect on every transcription chunk — tearing down the live
  // voice session mid-turn.
  const openVoiceModeRef = useRef(openVoiceMode);
  useEffect(() => { openVoiceModeRef.current = openVoiceMode; }, [openVoiceMode]);
  const stopVoiceSessionRef = useRef(stopVoiceSession);
  useEffect(() => { stopVoiceSessionRef.current = stopVoiceSession; }, [stopVoiceSession]);

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

  // Auto-start voice mode when the Mate tab gains focus so the tradie can
  // just start talking — opt-IN only (every focus mints a Live token and
  // burns a daily assistant turn, so the default lands in text), and only
  // when mic permission is already granted, so we never trigger a fresh
  // prompt. The cleanup tears voice down on blur/unmount (replacing the old
  // standalone unmount effect) so the mic is never left hot in the
  // background, and the AppState listener mutes on background and re-arms on
  // return to foreground while the tab is still focused — it stays
  // unconditional because it also tears down manually opened sessions.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const enabled = resolveAutoStartMic(businessSettings?.autoStartMicOnMate);
      // Only auto-start once per focused visit. Without this, every
      // navigation Mate launches (e.g. opening a draft) blurs and re-focuses
      // this screen, tearing down and re-opening the voice session — a new
      // WS connection, a fresh greeting, and burnt tokens each time. The
      // ref resets on blur (cleanup) so a deliberate return to the tab can
      // auto-start fresh.
      let hasAutoStartedThisVisit = false;

      const tryAutoStart = async () => {
        if (hasAutoStartedThisVisit) return;
        const granted = await micPermissionGranted();
        if (cancelled) return;
        if (
          shouldAutoStartMic({
            enabled,
            voiceState: voiceStateRef.current,
            permissionGranted: granted,
            // We're inside useFocusEffect, so the screen is focused.
            isFocused: true,
            appActive: AppState.currentState === 'active',
            sinceLastAttemptMs: Date.now() - lastAutoStartAttemptRef.current,
          }) &&
          // openVoiceMode sets voiceModeRef synchronously; guard against a
          // manual mic tap landing during the await above and opening a
          // second concurrent session that orphans the first.
          !voiceModeRef.current
        ) {
          hasAutoStartedThisVisit = true;
          lastAutoStartAttemptRef.current = Date.now();
          void openVoiceModeRef.current('sticky');
        }
      };

      if (enabled) {
        void tryAutoStart();
      }

      // Debounced teardown — see voiceAppStatePolicy + voiceGraceController.
      // A 'background' starts a SHORT grace that absorbs the spurious
      // background→active bounce Android fires when the audio/mic stack starts
      // (the bounce that, left to tear the session down and re-open it, minted
      // a token every cycle until the "too many requests" rate limit tripped).
      // iOS 'inactive' (Control Center, notification shade, call banner) gets
      // a LONG grace. Either is cancelled if the app returns to 'active' first.
      const grace = createGraceController(() => {
        // eslint-disable-next-line no-console
        console.log('[Mate voice] grace expired — stopping session');
        void stopVoiceSessionRef.current();
      });

      const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
        const action = voiceActionForAppState({
          nextState,
          hasVoiceSession: !!voiceModeRef.current,
          graceRunning: grace.isRunning(),
        });
        switch (action) {
          case 'stop':
            grace.clear();
            void stopVoiceSessionRef.current();
            break;
          case 'start-grace-short':
            grace.start(VOICE_BACKGROUND_GRACE_MS);
            break;
          case 'start-grace-long':
            grace.start(VOICE_INACTIVE_GRACE_MS);
            break;
          case 'cancel-grace':
            grace.clear();
            if (enabled) {
              // Returning to the foreground. If the session rode out a grace
              // window it's still open, so tryAutoStart's voiceState guard
              // (and the cooldown) makes this a no-op — it only re-opens when
              // a genuine background actually stopped the session.
              hasAutoStartedThisVisit = false;
              void tryAutoStart();
            }
            break;
          case 'ignore':
            break;
        }
      });

      return () => {
        cancelled = true;
        grace.clear();
        sub.remove();
        void stopVoiceSessionRef.current();
      };
    }, [businessSettings?.autoStartMicOnMate]),
  );

  const handleCtaPress = useCallback(
    (message: ChatMessage) => {
      if (!message.cta) return;
      if (message.cta.action.type === 'open_quote') {
        handleNavigate({ kind: 'job_preview', quoteId: message.cta.action.quoteId });
        return;
      }
      if (message.cta.action.type === 'open_supplier_review') {
        const { importId } = message.cta.action;
        if (supplierImportsRef.current.has(importId)) {
          openSupplierReview(importId);
          return;
        }
        // The rows never landed — start over rather than reopen an empty form.
        if (message.supplierImport?.phase === 'failed') {
          void startSupplierImportRef.current({ kind: 'supplier_import', source: 'ask' });
          return;
        }
        // Chat history is in-memory only, so the ref died with it. Say so
        // instead of opening a reader with nothing in it.
        if (conversation) {
          updateMessage(conversation.id, message.id, {
            supplierImport: { importId, phase: 'expired' },
            cta: undefined,
          });
        }
      }
    },
    [handleNavigate, openSupplierReview, conversation, updateMessage],
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

  // A staged photo is enough to send on its own — a caption is optional.
  const canSend = !!input.trim() || pendingAttachments.length > 0;
  const voiceActive = voiceState !== 'idle';
  const voiceAccent = voiceState === 'thinking' ? themeColors.accent : themeColors.error;
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
      <GridBackground />
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
                    ? themeColors.error
                    : voiceState === 'thinking'
                      ? themeColors.accent
                      : themeColors.accent
                }
              />
              <Text
                style={[
                  styles.heroStatus,
                  voiceState === 'listening' && { color: themeColors.error },
                  voiceState === 'thinking' && { color: themeColors.accentText },
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
              {voiceState === 'idle' && (
                <Text style={styles.heroCapability}>{introBlurb.capability}</Text>
              )}
              <Text style={styles.heroHint}>{introBlurb.hint}</Text>
              {/* Blank-but-errored: the error bubble no longer replaces the
                  hero, so surface the latest failure here instead of
                  swallowing it. */}
              {!!latestError && <Text style={styles.heroError}>{latestError}</Text>}
              {voiceState === 'idle' && (
                <View style={styles.chipRow}>
                  {introBlurb.chips.map((chip) => (
                    <TouchableOpacity
                      key={chip.label}
                      style={styles.chip}
                      onPress={() => {
                        // Prefill, never send — the tradie always owns the send.
                        setInput(chip.prefill);
                        inputRef.current?.focus();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={chip.label}
                    >
                      <Text style={styles.chipLabel}>{chip.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
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
            <ActivityIndicator size="small" color={themeColors.textMuted} />
            <Text style={styles.typing}>Mate is thinking…</Text>
          </View>
        )}

        <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 8) + 70 }]}>
          {pendingAttachments.length > 0 && !voiceActive && (
            <View style={styles.tray}>
              {pendingAttachments.map((a) => (
                <View key={a.id} style={styles.trayTile}>
                  <Image
                    source={{ uri: a.localUri || a.storageUrl }}
                    style={[styles.trayImage, a.status !== 'ready' && styles.trayImageBusy]}
                    resizeMode="cover"
                    accessibilityLabel="Photo ready to send"
                  />
                  {a.status === 'uploading' && (
                    <View style={styles.trayOverlay}>
                      <ActivityIndicator size="small" color={themeColors.onAccent} />
                    </View>
                  )}
                  {a.status === 'failed' && (
                    <View style={styles.trayOverlay}>
                      <MaterialCommunityIcons name="alert-circle-outline" size={18} color={themeColors.error} />
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.trayRemove}
                    onPress={() => removeAttachment(a.id)}
                    accessibilityRole="button"
                    accessibilityLabel="Remove photo"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialCommunityIcons name="close" size={12} color={themeColors.onAccent} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
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
              <>
                {/* Leads the input rather than joining the right-hand cluster:
                    that's already two 40px buttons, and send's long-press is
                    push-to-talk — nothing else can share it. */}
                <TouchableOpacity
                  style={styles.attachBtn}
                  onPress={showAttachOptions}
                  disabled={sending}
                  accessibilityRole="button"
                  accessibilityLabel="Attach a photo"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <MaterialCommunityIcons name="paperclip" size={20} color={themeColors.textMuted} />
                </TouchableOpacity>
                <TextInput
                ref={inputRef}
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder="Ask Mate…"
                placeholderTextColor={themeColors.textDisabled}
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
              </>
            )}

            {/* Mic / stop toggle. Hidden during PTT (driven by the send button
                being held) to keep the active row uncluttered. */}
            {voiceMode !== 'ptt' && (
              <View style={styles.voiceBtnWrap}>
                <MicPulse active={voiceMode === 'sticky' && voiceState === 'listening'} color={themeColors.error} />
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
                    <ActivityIndicator size="small" color={themeColors.onAccent} />
                  ) : (
                    <MaterialCommunityIcons
                      name={voiceMode === 'sticky' ? 'stop' : 'microphone-outline'}
                      size={22}
                      color={themeColors.onAccent}
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
                  !canSend && voiceMode !== 'ptt' && styles.sendBtnDisabled,
                  pressed && styles.sendBtnPressed,
                ]}
                onPress={() => {
                  // Tap with something to send → send. Tap with nothing → no-op
                  // (long-press would normally fire instead but iOS may emit
                  // onPress only).
                  if (!canSend || sending) return;
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
                    : canSend
                      ? 'Send message'
                      : 'Hold to record'
                }
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons
                  name={voiceMode === 'ptt' ? 'record-circle-outline' : 'arrow-up'}
                  size={22}
                  color={themeColors.onAccent}
                />
              </Pressable>
            )}
          </View>
        </View>

        <ActionSheet
          visible={photoSheetVisible}
          onDismiss={() => setPhotoSheetVisible(false)}
          title="Send Mate a photo"
          options={attachSheetOptions}
        />

        <SupplierListCaptureModal
          visible={captureModalVisible}
          onCancel={() => setCaptureModalVisible(false)}
          onComplete={async (uris) => {
            setCaptureModalVisible(false);
            await attachUris(uris);
          }}
          maxPhotos={2}
          counterLabel="photos"
          tips={[
            'Step back for the whole area, then step in for the detail',
            'Snap anything with a measurement written on it',
            'Watch the shadows — Mate reads what it can see',
            "Two at a time; send them and I'll take the next lot",
          ]}
        />

        {/* Price-list reader, hosted OVER the chat. The capture + column
            mapper + review trio is the same block SuppliersStep renders; the
            review modal is a plain RNModal with no navigation coupling. */}
        <SupplierListCaptureModal
          visible={importer.captureModalVisible}
          onCancel={importer.cancelCapture}
          onComplete={importer.handleCaptureComplete}
          processing={importer.phase === 'extracting'}
          processingLabel={importer.loadingLabel}
          counterLabel="pages"
          tips={[
            'Hold steady and let the autofocus settle',
            'Get the supplier header in — it names the list',
            'Make sure the prices and product names are sharp',
            'Multiple pages? Snap them all before hitting Done',
          ]}
        />

        <SpreadsheetColumnMapperModal
          visible={importer.columnMappingVisible}
          parsed={importer.parsedSpreadsheet}
          initialMapping={importer.autoDetectedMapping}
          onCancel={importer.cancelColumnMapping}
          onConfirm={importer.applyColumnMapping}
        />

        <SupplierListReviewModal
          visible={!!reviewImportId}
          initialSupplierName={
            (reviewImportId && supplierImportsRef.current.get(reviewImportId)?.supplierName) ||
            importSupplierNameRef.current ||
            ''
          }
          initialItems={
            (reviewImportId && supplierImportsRef.current.get(reviewImportId)?.items) || []
          }
          existingSupplierNames={importer.existingSupplierNames}
          saving={importer.saving}
          onCancel={closeSupplierReview}
          onSave={importer.handleSaveImported}
        />

        <ActionSheet
          visible={importSourceSheetVisible}
          onDismiss={() => setImportSourceSheetVisible(false)}
          title="Where's the price list?"
          options={importSourceOptions}
        />

        <AlertModal
          visible={!!alertConfig}
          onDismiss={dismissAlert}
          type={alertConfig?.type}
          title={alertConfig?.title || ''}
          message={alertConfig?.message || ''}
          primaryButtonText={alertConfig?.primaryButtonText}
          primaryButtonAction={alertConfig?.primaryButtonAction}
          secondaryButtonText={alertConfig?.secondaryButtonText}
          secondaryButtonAction={alertConfig?.secondaryButtonAction}
        />
      </WebContainer>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg,
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
    color: t.colors.text,
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
    color: t.colors.text,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  heroBlurb: {
    marginTop: 14,
    color: t.colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 12,
    maxWidth: 420,
  },
  heroHint: {
    marginTop: 8,
    color: t.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    letterSpacing: 0.2,
    paddingHorizontal: 12,
    maxWidth: 360,
  },
  heroCapability: {
    marginTop: 10,
    color: t.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 12,
    maxWidth: 420,
  },
  heroError: {
    marginTop: 10,
    color: t.colors.error,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    paddingHorizontal: 12,
    maxWidth: 420,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  chip: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipLabel: {
    color: t.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  introTitle: {
    color: t.colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 6,
  },
  introSubtitle: {
    color: t.colors.textMuted,
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
  typing: { color: t.colors.textMuted, fontSize: 13 },
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
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    color: t.colors.text,
    fontSize: 15,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    maxHeight: 120,
  },
  attachBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tray: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  trayTile: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'visible',
    backgroundColor: t.colors.surfaceOverlay,
  },
  trayImage: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  trayImageBusy: {
    opacity: 0.5,
  },
  trayOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trayRemove: {
    position: 'absolute',
    right: -6,
    top: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: t.colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: t.colors.accent,
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
    backgroundColor: t.colors.accent,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBtnActive: {
    backgroundColor: t.colors.error,
  },
  composerActive: {
    borderColor: t.colors.error,
    shadowColor: t.colors.error,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  composerThinking: {
    borderColor: t.colors.accent,
    shadowColor: t.colors.accent,
  },
  sendBtnRecording: {
    backgroundColor: t.colors.error,
  },
  sendBtnPressed: {
    opacity: 0.8,
  },
  sendBtnDisabled: {
    backgroundColor: t.colors.surfaceOverlay,
  },
}));
