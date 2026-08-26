// Loads the ElevenLabs React Native shim, on demand.
//
// @elevenlabs/react-native is a ~2KB side-effect module: it calls LiveKit's
// registerGlobals() at import time and registers the WebRTC setup strategy that
// @elevenlabs/client's Conversation.startSession() looks for. We never use the
// React hooks it re-exports — the imperative Conversation class comes straight
// from @elevenlabs/client — but without this import having run, startSession
// has no strategy and fails on device.
//
// DYNAMIC on purpose. A static top-level import would run registerGlobals() at
// app boot for every user, monkey-patching RTCPeerConnection and
// navigator.mediaDevices on a device that mostly also runs expo-camera and
// expo-speech-recognition. Around 95% of sessions never open voice; they should
// not pay for it, and neither should the blast radius extend to them.
//
// Also note the shim only supports WebRTC: it throws outright on
// connectionType 'websocket' or a signedUrl, because the WebSocket transport
// needs AudioContext/AudioWorkletNode, which React Native does not have.

let ready: Promise<void> | null = null;

export function ensureElevenLabsRuntime(): Promise<void> {
  if (!ready) {
    ready = import('@elevenlabs/react-native')
      .then(() => undefined)
      .catch((err) => {
        // Let the next attempt retry rather than caching a rejected promise
        // forever — a transient bundle-load failure shouldn't kill voice for
        // the rest of the app's life.
        ready = null;
        throw err;
      });
  }
  return ready;
}
