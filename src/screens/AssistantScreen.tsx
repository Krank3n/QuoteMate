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
  ScrollView,
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
import {
  AssistantOfflineError,
  AssistantQuotaError,
  sendAssistantTurn,
} from '../services/assistantService';
import {
  openVoiceSession,
  VoiceSession,
  VoiceSessionOfflineError,
  VoiceSessionQuotaError,
} from '../services/assistant/voiceSession';
import { startMicCapture, MicCaptureHandle, MicUnavailableError } from '../services/assistant/mic';
import { AudioQueue, createAudioQueue, ensureAudioMode } from '../services/assistant/audioPlayer';
import { generateId } from '../utils/generateId';
import {
  ChatMessage,
  Proposal,
  ProposalStatus,
} from '../types/assistant';
import { MessageBubble } from '../components/assistant/MessageBubble';
import { ProposalCard } from '../components/assistant/ProposalCard';
import { SuggestedPromptChip } from '../components/assistant/SuggestedPromptChip';
import { WebContainer } from '../components/WebContainer';
import { useSuggestedPrompts } from '../hooks/useSuggestedPrompts';

type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking';

interface ChatItem {
  key: string;
  message: ChatMessage;
}

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

export function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<any>>();
  const conversations = useStore((s) => s.conversations);
  const currentConversationId = useStore((s) => s.currentConversationId);
  const startConversation = useStore((s) => s.startConversation);
  const appendMessage = useStore((s) => s.appendMessage);
  const updateMessage = useStore((s) => s.updateMessage);
  const applyProposal = useStore((s) => s.applyProposal);
  const updateProposalStatus = useStore((s) => s.updateProposalStatus);
  const loadConversations = useStore((s) => s.loadConversations);
  const markScreenTourSeen = useStore((s) => s.markScreenTourSeen);
  const hasSeenScreenTour = useStore((s) => s.hasSeenScreenTour);
  const setCurrentQuote = useStore((s) => s.setCurrentQuote);
  const quotes = useStore((s) => s.quotes);
  const documents = useStore((s) => s.documents);
  const suggestedPrompts = useSuggestedPrompts();

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  // Mirror state of voiceModeRef — drives the send-button icon swap and
  // the status-row copy. Refs alone don't trigger re-renders.
  const [voiceMode, setVoiceMode] = useState<'sticky' | 'ptt' | null>(null);
  const listRef = useRef<FlatList<ChatItem>>(null);
  const seenIntro = hasSeenScreenTour('mate_intro');

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

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Lazy-create a conversation on first focus.
  useEffect(() => {
    if (!currentConversationId) startConversation();
  }, [currentConversationId, startConversation]);

  useEffect(() => {
    if (!seenIntro) {
      markScreenTourSeen('mate_intro');
    }
  }, [seenIntro, markScreenTourSeen]);

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

  const items: ChatItem[] = useMemo(() => {
    if (!conversation) return [];
    return conversation.messages
      .slice()
      .reverse()
      .map((m) => ({ key: m.id, message: m }));
  }, [conversation]);

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
          const doc = documents.find((d) => d.id === hint.documentId);
          if (!doc) return;
          // ViewJob is the unified job screen; the send modal lives inside it.
          navigation.navigate('ViewJob', { documentId: doc.id, openSend: true, prefillEmail: hint.recipientEmail });
          break;
        }
        case 'open_contact':
          navigation.navigate('Contacts', { highlightId: hint.contactId });
          break;
        case 'open_invoice':
          navigation.navigate('ViewJob', { documentId: hint.invoiceId });
          break;
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

      // While the materials + pricing pipeline grinds (15–40s), get Mate
      // to yarn audibly so the tradie isn't staring at dead air. The
      // narration prompt is a single user turn; Mate responds via audio
      // chunks for as long as the prompt asks. We suppress visible text
      // bubbles during this window via narrationModeRef so the chat
      // doesn't fill up with banter.
      const liveSessionForNarration = voiceSessionRef.current;
      const narrating =
        (proposal.type === 'propose_draft_quote' || proposal.type === 'propose_reprice') &&
        !!liveSessionForNarration?.isOpen();
      // Job label for the narration prompts (drafting + reprice both yarn).
      const narrationJobLabel =
        proposal.type === 'propose_draft_quote'
          ? (proposal as Extract<Proposal, { type: 'propose_draft_quote' }>).jobName
          : proposal.type === 'propose_reprice'
            ? (proposal as Extract<Proposal, { type: 'propose_reprice' }>).displayName || 'that quote'
            : '';
      if (narrating && liveSessionForNarration) {
        narrationModeRef.current = true;
        // Cut anything currently playing/queued — the narration starts
        // fresh so it doesn't collide with leftover audio from the
        // pre-Apply confirmation reply.
        try { audioQueueRef.current?.stop?.(); } catch { /* noop */ }
        audioQueueRef.current = createAudioQueue();
        const intro =
          proposal.type === 'propose_reprice'
            ? `Re-pricing "${narrationJobLabel}" now — the pipeline's re-checking the flagged rows`
            : `Apply just got tapped on "${narrationJobLabel}". The materials + pricing pipeline is running now`;
        liveSessionForNarration.sendUserText(
          `[narrate] ${intro} — usually 20 to 40 seconds. ` +
          `Yarn casually for that whole window, two or three short paragraphs with pauses. ` +
          `Riff on the job or whatever's natural. Chill, dry, unhurried. ` +
          `Stop when you see [narrate-done].`,
        );
      }

      const result = await applyProposal(proposal, (status) => {
        if (!workingMessageId) return;
        updateMessage(conversation.id, workingMessageId, { working: status });
      });

      if (narrating && liveSessionForNarration?.isOpen()) {
        // Wrap-up trigger. Single short line then back to normal Mate. When the
        // pricing pass flagged rows, hand Mate the summary so it gives one short
        // spoken heads-up about what needs a look (the [narrate-done] moment is
        // the one time it's allowed to mention pricing).
        const heads =
          result.ok && result.review && result.review.issues.length > 0
            ? ` Heads up — ${result.review.summary} Work that into one short line.`
            : '';
        const wrap = result.ok
          ? `[narrate-done] Pipeline finished. "${narrationJobLabel}" came together fine.${heads} One short line acknowledging, then stop.`
          : `[narrate-done] Pipeline hit a snag: ${result.error || 'unknown error'}. One short line acknowledging, then stop.`;
        liveSessionForNarration.sendUserText(wrap);
        // Give the wrap-up audio room to play before re-enabling visible
        // text bubbles. If Mate is still talking when this fires, the
        // first visible bubble starts mid-sentence — annoying — so a
        // generous tail is worth it.
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

      // If a voice session is open, feed it the resolved quote id so
      // Mate stops trying to re-find the draft via list_recent_quotes on
      // the next utterance. turnComplete:false means the model logs it
      // as context without speaking a reply about it.
      const liveSession = voiceSessionRef.current;
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
          case 'propose_reprice':
            liveSession.sendContextNote(
              `[context] Re-priced quote ${proposal.quoteId}.` +
              (result.review ? ` ${result.review.summary}` : ''),
            );
            break;
        }
      }

      // For draft + reprice, keep the user in chat. Render the quote inline
      // (JobScopeCard) so the tradie can review and keep chatting with Mate
      // to tweak it without leaving — and surface any rows the pricing pass
      // flagged right there (proactive review). Other proposal types (send,
      // delete, convert, create contact) still auto-navigate because their
      // result IS a navigation, not a long-running pipeline.
      if (proposal.type === 'propose_draft_quote' || proposal.type === 'propose_reprice') {
        if (result.navigate && result.navigate.kind === 'job_preview') {
          const hasIssues = !!result.review && result.review.issues.length > 0;
          const text =
            proposal.type === 'propose_draft_quote'
              ? hasIssues
                ? `Here's the draft — ${result.review!.summary} Tell me what to tweak, or tap to open it.`
                : "Here's the draft — have a squiz. Tell me what to tweak, or tap to open it."
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
            inlineQuoteId: result.navigate.quoteId,
          });
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

  const submit = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || sending) return;
      // Resolve the active conversation against the current store, not the
      // closure — `currentConversationId` can point at a missing conversation
      // after loadConversations runs (it clobbered the freshly minted one).
      // Always validate before using.
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
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn('[Mate] error', err?.name, err?.message);
        const isQuota = err instanceof AssistantQuotaError;
        const isOffline = err instanceof AssistantOfflineError;
        const errorMessage = isQuota
          ? err.message
          : isOffline
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
    [appendMessage, updateMessage, conversation, currentConversationId, input, sending, startConversation],
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

  const openVoiceMode = useCallback(async (mode: 'sticky' | 'ptt') => {
    voiceModeRef.current = mode;
    setVoiceMode(mode);

    const storeState = useStore.getState();
    let convoId = storeState.conversations.find((c) => c.id === storeState.currentConversationId)?.id;
    if (!convoId) convoId = startConversation();
    const seedHistory =
      useStore.getState().conversations.find((c) => c.id === convoId)?.messages || [];

    setVoiceState('connecting');
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
        onTurnComplete: () => {
          assistantBubbleIdRef.current = null;
          assistantBubbleTextRef.current = '';
          turnProposals = [];
          // PTT is a single-shot interaction. Close the WS as soon as the
          // model finishes, then wait for the audio queue to drain before
          // the final cleanup so Mate's reply plays out in full instead
          // of being cut mid-sentence by an immediate stop().
          if (voiceModeRef.current === 'ptt') {
            const queue = audioQueueRef.current;
            try { voiceSessionRef.current?.close(); } catch { /* noop */ }
            voiceSessionRef.current = null;
            setVoiceState('thinking');
            if (queue) {
              queue.setOnIdle(() => { void stopVoiceSession(); });
            } else {
              void stopVoiceSession();
            }
            return;
          }
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

      // Open the mic only once the session handshake completed — earlier
      // chunks would queue inside voiceSession until setupComplete anyway,
      // but starting the mic now keeps the buffer small. On web the
      // first call also triggers the browser permission prompt, so this
      // is awaited.
      try {
        micRef.current = await startMicCapture((chunk) => {
          voiceSessionRef.current?.sendMicChunk(chunk);
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
        err instanceof VoiceSessionQuotaError
          ? err.message
          : err instanceof VoiceSessionOfflineError
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
  }, [stopVoiceSession, appendMessage, updateMessage, startConversation, micLevel]);

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

  const renderItem = useCallback(
    ({ item }: { item: ChatItem }) => {
      const proposals = item.message.proposals || [];
      return (
        <View>
          <MessageBubble
            message={item.message}
            onCtaPress={() => handleCtaPress(item.message)}
            onInlineQuoteEdit={handleInlineQuoteEdit}
            onInlineQuoteOpen={handleInlineQuoteOpen}
            onInlineJobEdit={handleInlineJobEdit}
          />
          {proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              status={(item.message.proposalStatus?.[p.id] as ProposalStatus) || 'pending'}
              onApply={() => handleApply(item.message, p)}
              onDismiss={() => handleDismiss(item.message, p)}
            />
          ))}
        </View>
      );
    },
    [handleApply, handleDismiss, handleCtaPress, handleInlineQuoteEdit, handleInlineQuoteOpen],
  );

  const isEmpty = !conversation || conversation.messages.length === 0;
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
        {isEmpty && (
          <View style={[styles.intro, { paddingTop: insets.top + 16 }]}>
            <MaterialCommunityIcons name="chat-processing" size={36} color={colors.primary} />
            <Text style={styles.introTitle}>Mate</Text>
            <Text style={styles.introSubtitle}>
              Ask me to draft a quote, find a customer, or chase a follow-up. I draft, you confirm — nothing saves without your tap.
            </Text>
          </View>
        )}

        <FlatList
          ref={listRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={items}
          keyExtractor={(i) => i.key}
          renderItem={renderItem}
          inverted
          keyboardShouldPersistTaps="handled"
        />

        {sending && (
          <View style={styles.typingRow}>
            <ActivityIndicator size="small" color={colors.textMuted} />
            <Text style={styles.typing}>Mate is thinking…</Text>
          </View>
        )}

        {suggestedPrompts.length > 0 && isEmpty && !voiceActive && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsScroll}
            contentContainerStyle={styles.chips}
          >
            {suggestedPrompts.map((p) => (
              <SuggestedPromptChip
                key={p.id}
                label={p.label}
                onPress={() => submit(p.text)}
              />
            ))}
          </ScrollView>
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
  chipsScroll: {
    // Without an explicit cap, the horizontal ScrollView stretches to fill
    // the column's cross axis on react-native-web and the chips render as
    // giant vertical blocks. flexGrow: 0 keeps the row hugging its content.
    flexGrow: 0,
    flexShrink: 0,
    maxHeight: 48,
  },
  chips: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
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
