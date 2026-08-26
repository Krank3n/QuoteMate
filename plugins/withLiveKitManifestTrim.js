const { withAndroidManifest, createRunOncePlugin } = require("@expo/config-plugins");

/**
 * Strip the screen-share surface that @livekit/react-native-webrtc merges in.
 *
 * QuoteMate uses LiveKit for one thing: audio to the ElevenLabs agent. The
 * library's manifest nevertheless contributes a MediaProjectionService (the
 * Android screen-capture service) and the FOREGROUND_SERVICE permission that
 * goes with it. Setting enableScreenShareService:false on
 * @livekit/react-native-expo-plugin does NOT remove them — that flag only
 * writes a meta-data key that the runtime reads; the service is merged from the
 * webrtc library manifest regardless. Verified in the merged manifest.
 *
 * Shipping a mediaProjection foreground service we never start is a Play policy
 * conversation we have no answer to ("why does a quoting app capture the
 * screen?"), and screen-recording permissions read badly to users comparing
 * app listings. tools:node="remove" drops both at merge time.
 *
 * Bluetooth and WAKE_LOCK are deliberately NOT trimmed: tradies take calls on
 * bluetooth headsets in the ute, and the wake lock is what stops a voice
 * session dying when the screen dims.
 */
const SCREEN_SHARE_SERVICE = "com.oney.WebRTCModule.MediaProjectionService";
const SCREEN_SHARE_PERMISSION = "android.permission.FOREGROUND_SERVICE";

/**
 * Pure transform over the parsed manifest object, so the merge-removal markers
 * can be asserted without running a prebuild. Same exported-helper shape as
 * withSquareSDK's injectSquareMainApplication.
 */
function trimScreenShare(androidManifest) {
  const manifest = androidManifest.manifest;

  // The `tools:` namespace has to be declared or the merger ignores the marker.
  manifest.$ = manifest.$ || {};
  manifest.$["xmlns:tools"] = manifest.$["xmlns:tools"] || "http://schemas.android.com/tools";

  // Permission: replace any existing entry with a remove marker, or add one.
  manifest["uses-permission"] = manifest["uses-permission"] || [];
  manifest["uses-permission"] = manifest["uses-permission"].filter(
    (p) => p?.$?.["android:name"] !== SCREEN_SHARE_PERMISSION
  );
  manifest["uses-permission"].push({
    $: { "android:name": SCREEN_SHARE_PERMISSION, "tools:node": "remove" },
  });

  // Service: same, inside <application>.
  const application = (manifest.application || [])[0];
  if (application) {
    application.service = (application.service || []).filter(
      (s) => s?.$?.["android:name"] !== SCREEN_SHARE_SERVICE
    );
    application.service.push({
      $: { "android:name": SCREEN_SHARE_SERVICE, "tools:node": "remove" },
    });
  }

  return androidManifest;
}

function withLiveKitManifestTrim(config) {
  return withAndroidManifest(config, (config) => {
    config.modResults = trimScreenShare(config.modResults);
    return config;
  });
}

module.exports = createRunOncePlugin(
  withLiveKitManifestTrim,
  "withLiveKitManifestTrim",
  "1.0.0"
);
module.exports.trimScreenShare = trimScreenShare;
module.exports.SCREEN_SHARE_SERVICE = SCREEN_SHARE_SERVICE;
module.exports.SCREEN_SHARE_PERMISSION = SCREEN_SHARE_PERMISSION;
