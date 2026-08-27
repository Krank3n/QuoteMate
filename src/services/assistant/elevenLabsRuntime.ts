// Loads the ElevenLabs React Native shim, on demand.
//
// @elevenlabs/react-native is a ~2KB side-effect module: it calls LiveKit's
// registerGlobals() at import time and registers the WebRTC setup strategy that
// Conversation.startSession() looks for. We never use the React hooks it
// re-exports — the imperative Conversation class comes straight from
// @elevenlabs/client — but without this import having run, startSession has no
// strategy and fails on device.
//
// No platform-split files needed: the package's own export conditions do it.
// The "react-native" condition resolves to a build that imports
// @livekit/react-native; the "browser" condition resolves to one that contains
// no LiveKit reference at all (verified). So the web bundle stays clean even
// though this module is reachable from it.
//
// DYNAMIC, and skipped outright on web. A static import would run
// registerGlobals() at app boot for every user, monkey-patching
// RTCPeerConnection and navigator.mediaDevices on a device that also runs
// expo-camera and expo-speech-recognition. Around 95% of sessions never open
// voice; they shouldn't pay for it, and the blast radius shouldn't reach them.

import { Platform } from 'react-native';

let ready: Promise<void> | null = null;

export function ensureElevenLabsRuntime(): Promise<void> {
  // Browsers ship WebRTC; there is no shim to install.
  if (Platform.OS === 'web') return Promise.resolve();
  if (!ready) {
    ready = import('@elevenlabs/react-native')
      .then(() => undefined)
      .catch((err) => {
        // Don't cache a rejected promise — a transient bundle-load failure
        // shouldn't kill voice for the rest of the app's life.
        ready = null;
        throw err;
      });
  }
  return ready;
}
