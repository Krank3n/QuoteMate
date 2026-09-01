const { withGradleProperties, createRunOncePlugin } = require("@expo/config-plugins");

/**
 * Raise the Gradle JVM heap so D8 can merge the dex archives.
 *
 * Expo's prebuild template writes `org.gradle.jvmargs=-Xmx2048m
 * -XX:MaxMetaspaceSize=512m`. Adding @livekit/react-native-webrtc (the
 * transport under @elevenlabs/react-native) pushes :app:mergeExtDexDebug past
 * that ceiling and the build dies with:
 *
 *     ERROR: D8: java.lang.OutOfMemoryError: Java heap space
 *     com.android.builder.dexing.DexArchiveMergerException
 *
 * That failure reads like a library incompatibility and isn't one — it's purely
 * the toolchain running out of room. android/ is gitignored and regenerated on
 * every prebuild, so editing gradle.properties by hand fixes it only on the
 * machine that did the editing; it has to be a plugin to survive CI and EAS.
 */
const DEFAULT_JVM_ARGS = "-Xmx6144m -XX:MaxMetaspaceSize=1024m";

/**
 * Pure transform over the parsed gradle.properties item list, so the
 * replace-vs-append behaviour is testable without running a prebuild.
 * Mirrors the exported-helper pattern in withSquareSDK.js.
 */
function setJvmArgs(properties, jvmArgs = DEFAULT_JVM_ARGS) {
  const next = properties.map((item) =>
    item.type === "property" && item.key === "org.gradle.jvmargs"
      ? { ...item, value: jvmArgs }
      : item
  );
  const found = next.some(
    (item) => item.type === "property" && item.key === "org.gradle.jvmargs"
  );
  if (!found) {
    next.push({ type: "property", key: "org.gradle.jvmargs", value: jvmArgs });
  }
  return next;
}

function withGradleJvmArgs(config, jvmArgs = DEFAULT_JVM_ARGS) {
  return withGradleProperties(config, (config) => {
    config.modResults = setJvmArgs(config.modResults, jvmArgs);
    return config;
  });
}

module.exports = createRunOncePlugin(
  withGradleJvmArgs,
  "withGradleJvmArgs",
  "1.0.0"
);
module.exports.setJvmArgs = setJvmArgs;
module.exports.DEFAULT_JVM_ARGS = DEFAULT_JVM_ARGS;
