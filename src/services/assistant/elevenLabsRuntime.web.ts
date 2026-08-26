// Web needs no shim: browsers ship WebRTC, and @elevenlabs/client's `browser`
// export condition already resolves to an implementation that uses it. The
// React Native side-effect module must never enter the web bundle — it imports
// @livekit/react-native, which has no browser build.
export function ensureElevenLabsRuntime(): Promise<void> {
  return Promise.resolve();
}
