/**
 * DictationButton
 *
 * Reusable mic toggle that dictates into any text field. Follows the exact
 * voice pattern from JobDetailsScreen: Web Speech API on web,
 * expo-speech-recognition on native (guarded require — the module may be
 * absent if the dev client wasn't rebuilt), same permission flow with the
 * 10s request timeout, continuous recognition with auto-restart on silent
 * 'end' events.
 *
 * Controlled: the parent owns the text via `value` and receives every
 * interim/final update through `onText(next)`. Recognised speech is APPENDED
 * to whatever was in the field when recording started (single-space joins —
 * see utils/dictationTranscript.ts, where the segment folding lives as pure,
 * tested helpers).
 *
 * On platforms with no speech support (browser without the Web Speech API,
 * native build without the module) it renders nothing — graceful absence,
 * never an error.
 *
 * Multiple instances can be mounted on one screen: native speech events are
 * global, so every handler guards on isRecordingRef and only the instance
 * whose mic was tapped reacts.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Alert,
  Platform,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors } from '../theme';
import {
  appendTranscript,
  commitSegment,
  emptyDictationState,
  finalizeDictation,
  foldDictationResult,
  type DictationSegmentState,
} from '../utils/dictationTranscript';

// Safe import — native module may not be available if dev client wasn't rebuilt
let ExpoSpeechRecognitionModule: any = null;
let useSpeechRecognitionEvent: any = (_event: string, _callback: Function) => {};
try {
  const speechModule = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = speechModule.ExpoSpeechRecognitionModule;
  useSpeechRecognitionEvent = speechModule.useSpeechRecognitionEvent;
} catch (e) {
  // silently ignore - speech features disabled
}

const NATIVE_START_OPTIONS = {
  lang: 'en-AU',
  interimResults: true,
  maxAlternatives: 1,
  continuous: true, // Keep recording until the tradie taps stop
  requiresOnDeviceRecognition: false,
};

function getWebSpeechRecognition(): any {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  // @ts-ignore - Web Speech API
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export interface DictationButtonProps {
  /** Current text of the field being dictated into. */
  value: string;
  /** Receives the full updated text (existing + recognised speech). */
  onText: (next: string) => void;
  /** Idle helper label. Defaults to "Talk instead of type". */
  hint?: string;
  disabled?: boolean;
  /**
   * 'inline' (default) — a small round mic with the hint beside it, for
   * sitting next to a single field.
   *
   * 'hero' — the big centred mic with its label underneath, matching the
   * record button on NewQuote/JobDetailsScreen. That is this app's
   * established voice affordance, so dictation that heads a whole block of
   * fields should look like it there too. (Deliberately NOT a full-width
   * bordered button: that is the shape of the Mate clean-up action it sits
   * above, and two identical shapes doing different things read as a pair
   * of the same control.)
   */
  variant?: 'inline' | 'hero';
  /** Idle label under the mic in 'hero' variant. Ignored when inline. */
  label?: string;
}

export function DictationButton({
  value,
  onText,
  hint = 'Talk instead of type',
  disabled = false,
  variant = 'inline',
  label = 'Talk instead of type',
}: DictationButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const segmentRef = useRef<DictationSegmentState>(emptyDictationState());
  const webRecognitionRef = useRef<any>(null);

  // Latest props via refs so the once-registered event handlers never close
  // over stale values (same pattern as SignaturePad).
  const valueRef = useRef(value);
  valueRef.current = value;
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  // Ref is set synchronously alongside state so global event handlers see
  // the change in the same frame (no effect-sync lag).
  const setRecording = (next: boolean) => {
    isRecordingRef.current = next;
    setIsRecording(next);
  };

  // --- Native speech events (no-op stubs on web / when module missing) ---

  useSpeechRecognitionEvent('end', () => {
    // Recogniser ended on its own (silence) while the tradie is still
    // recording — bank the in-flight segment and restart.
    if (!isRecordingRef.current) return;
    segmentRef.current = commitSegment(segmentRef.current);
    setTimeout(async () => {
      if (!isRecordingRef.current) return;
      try {
        await ExpoSpeechRecognitionModule.start(NATIVE_START_OPTIONS);
      } catch (error) {
        setRecording(false);
      }
    }, 100);
  });

  useSpeechRecognitionEvent('result', (event: any) => {
    if (!isRecordingRef.current) return; // Not this instance / not recording

    const allResults = event.results || [];
    // Each result carries the full transcript for its segment, not
    // incremental text — the latest one is what we fold in.
    const lastResult = allResults[allResults.length - 1];
    if (!lastResult?.transcript) return;

    const folded = foldDictationResult(segmentRef.current, lastResult.transcript, allResults.length);
    if (!folded) return;
    segmentRef.current = folded.state;
    onTextRef.current(folded.display);
  });

  useSpeechRecognitionEvent('error', (event: any) => {
    if (!isRecordingRef.current) return;
    setRecording(false);
    Alert.alert('Voice recognition error', event.error || 'Could not recognise speech');
  });

  // Stop listening if the screen unmounts mid-recording — never leave the
  // mic running with nowhere to put the words.
  useEffect(() => {
    return () => {
      if (!isRecordingRef.current) return;
      isRecordingRef.current = false;
      if (webRecognitionRef.current) {
        try { webRecognitionRef.current.stop(); } catch {}
      } else if (ExpoSpeechRecognitionModule) {
        ExpoSpeechRecognitionModule.stop().catch(() => {});
      }
    };
  }, []);

  const handleToggle = async () => {
    // Web: Use native Web Speech API directly
    if (Platform.OS === 'web') {
      if (isRecordingRef.current) {
        if (webRecognitionRef.current) {
          webRecognitionRef.current.stop();
        }
        setRecording(false);
        return;
      }

      const SpeechRecognition = getWebSpeechRecognition();
      if (!SpeechRecognition) return; // Unsupported — button isn't rendered anyway

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-AU';

      let finalTranscript = valueRef.current; // Start with existing text

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript = appendTranscript(finalTranscript, transcript);
          } else {
            interimTranscript += transcript;
          }
        }
        // Show final + interim
        onTextRef.current(
          interimTranscript ? appendTranscript(finalTranscript, interimTranscript) : finalTranscript,
        );
      };

      recognition.onerror = (event: any) => {
        setRecording(false);
        Alert.alert('Voice recognition error', event.error || 'Could not recognise speech');
      };

      recognition.onend = () => {
        if (isRecordingRef.current) {
          // Restart if still recording
          recognition.start();
        }
      };

      webRecognitionRef.current = recognition;
      recognition.start();
      setRecording(true);
      return;
    }

    // Native: Use expo-speech-recognition
    if (!ExpoSpeechRecognitionModule) return; // Unsupported — button isn't rendered anyway

    if (isRecordingRef.current) {
      // Stop recording manually
      try {
        // Compose final text from accumulated + last segment BEFORE stopping,
        // so a late 'end' event can't reset the field.
        onTextRef.current(finalizeDictation(segmentRef.current, valueRef.current));
        // Flip the flag FIRST so the 'end' handler knows this was a manual stop.
        setRecording(false);
        await ExpoSpeechRecognitionModule.stop();
        segmentRef.current = emptyDictationState();
      } catch (error) {
        setRecording(false);
        Alert.alert('Error', 'Failed to stop voice recording');
      }
      return;
    }

    // Start recording — append to whatever is already in the field
    try {
      // First check if we already have permission
      const currentStatus = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      let result = currentStatus;

      // Only request if not already granted
      if (!currentStatus.granted) {
        setIsRequestingPermission(true);

        // Add a timeout to prevent infinite loading
        const permissionPromise = ExpoSpeechRecognitionModule.requestPermissionsAsync();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Permission request timed out')), 10000)
        );

        try {
          result = await Promise.race([permissionPromise, timeoutPromise]) as any;
        } catch (timeoutError) {
          setIsRequestingPermission(false);
          Alert.alert(
            'Permission Request Failed',
            Platform.OS === 'ios'
              ? 'The permission dialog did not appear. Please go to Settings > QuoteMate > Microphone and enable it, then try again.'
              : 'The permission dialog did not appear. Please check:\n\n1. Go to Settings > Apps > QuoteMate > Permissions\n2. Enable Microphone permission\n3. Try again'
          );
          return;
        }

        setIsRequestingPermission(false);

        if (!result.granted) {
          Alert.alert('Permission Required', 'Microphone permission is required for voice recording');
          return;
        }
      }

      // Check if speech recognition is available
      await ExpoSpeechRecognitionModule.getStateAsync();

      // Seed the segment state with the field's existing text
      segmentRef.current = { accumulated: valueRef.current, lastSegment: '' };

      await ExpoSpeechRecognitionModule.start(NATIVE_START_OPTIONS);
      setRecording(true);
    } catch (error: any) {
      // Ensure we always reset the loading state
      setIsRequestingPermission(false);
      setRecording(false);
      Alert.alert(
        'Error Starting Recording',
        `Failed to start voice recording: ${error?.message || 'Unknown error'}\n\nPlease check:\n1. Microphone permission is granted\n2. Speech recognition is available on your device\n3. Internet connection (for cloud recognition)`
      );
    }
  };

  // Graceful absence: no speech support on this platform → render nothing.
  // Module presence and the window API are static, so this never flips
  // mid-session (hooks above always run in the same order).
  const supported = Platform.OS === 'web' ? !!getWebSpeechRecognition() : !!ExpoSpeechRecognitionModule;
  if (!supported) return null;

  if (variant === 'hero') {
    return (
      <View style={styles.heroContainer}>
        <TouchableOpacity
          onPress={() => { handleToggle(); }}
          disabled={disabled || isRequestingPermission}
          style={[styles.heroButton, isRecording && styles.heroButtonActive]}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={isRecording ? 'Stop dictating' : 'Dictate into this field'}
        >
          <MaterialCommunityIcons
            name={isRecording ? 'stop' : 'microphone'}
            size={36}
            color="#FFFFFF"
          />
        </TouchableOpacity>

        <Text style={[styles.heroLabel, isRecording && styles.heroLabelActive]}>
          {isRequestingPermission
            ? 'Requesting microphone permission…'
            : isRecording
              ? 'Tap to stop recording'
              : label}
        </Text>
        {hint ? <Text style={styles.heroHint}>{hint}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <TouchableOpacity
        onPress={() => { handleToggle(); }}
        disabled={disabled || isRequestingPermission}
        style={[styles.micButton, isRecording && styles.micButtonActive]}
        activeOpacity={0.8}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={isRecording ? 'Stop dictating' : 'Dictate into this field'}
      >
        <MaterialCommunityIcons
          name={isRecording ? 'stop' : 'microphone'}
          size={20}
          color="#FFFFFF"
        />
      </TouchableOpacity>

      <Text style={[styles.hintText, isRecording && styles.hintTextActive]}>
        {isRequestingPermission
          ? 'Requesting microphone permission…'
          : isRecording
            ? 'Listening — tap to stop'
            : hint}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonActive: {
    backgroundColor: colors.error,
  },
  hintText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  hintTextActive: {
    color: colors.success,
    fontWeight: '600',
  },
  // Hero variant — mirrors the record button on NewQuote/JobDetailsScreen
  // (88px circle, white 36px glyph, label centred underneath) so voice input
  // looks the same wherever it appears. The pulse/ripple animation on that
  // screen is deliberately not copied: it belongs to a voice-FIRST flow
  // where the mic is the main event, and here it is one way in among typed
  // fields.
  heroContainer: {
    alignItems: 'center',
    marginVertical: 16,
  },
  heroButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  heroButtonActive: {
    backgroundColor: colors.success,
    shadowColor: colors.success,
    shadowOpacity: 0.6,
    elevation: 16,
  },
  heroLabel: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
    color: colors.onSurface,
  },
  heroLabelActive: {
    color: colors.success,
  },
  heroHint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },
});
