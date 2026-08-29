// Mic permission, split out from mic.ts so both voice transports share one
// implementation.
//
// The Gemini path needs this because react-native-audio-record constructs its
// recorder eagerly: without a granted permission, AudioRecord is built in an
// uninitialised state and the later startRecording() throws on the native
// modules thread, where a JS try/catch cannot reach it — the app dies outright.
//
// The ElevenLabs path needs it for a different reason: @livekit/react-native
// does NOT request runtime permissions of its own. Skip this and it fails on
// Android with an error that looks nothing like "no mic permission".
//
// Either way, asking first turns a hard failure into a message the tradie can
// act on. When mic.ts is retired with the Gemini transport, this survives it.

import { Platform } from 'react-native';
import { Audio } from 'expo-av';

/** The mic couldn't be opened, with a line worth showing the tradie. */
export class MicUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MicUnavailableError';
  }
}

/** Request mic access, throwing a tradie-readable error on refusal. */
export async function ensureMicPermission(): Promise<void> {
  const { granted, canAskAgain } = await Audio.requestPermissionsAsync();
  if (!granted) {
    throw new MicUnavailableError(
      canAskAgain
        ? 'Mic access is needed for voice — tap the mic again and allow it.'
        : 'Mic access is off. Switch it on for QuoteMate in your phone settings to talk to Mate.',
    );
  }
}

/**
 * Whether mic permission is already granted, WITHOUT prompting. Gates the
 * silent auto-start on tab focus: we only re-open the mic for a tradie who has
 * already said yes, never to spring a fresh prompt on them. Web always returns
 * false — there the getUserMedia prompt IS the capture call.
 */
export async function micPermissionGranted(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await Audio.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}
