const { createRunOncePlugin, withProjectBuildGradle } = require("@expo/config-plugins");

const MARKER = "// bouncycastle-dedup (withBouncyCastleDedup plugin)";
const BLOCK = `
${MARKER}
// Square's mobile-payments-sdk pulls the legacy org.bouncycastle:bcprov-jdk15on
// artifact while other dependencies pull the renamed bcprov-jdk15to18 line.
// Both contain the same classes, so :app:checkReleaseDuplicateClasses fails
// ("Duplicate class org.bouncycastle...."). Substitute the legacy artifact for
// the modern one — the 15to18 line is the same library renamed, API-compatible.
allprojects {
  configurations.all {
    resolutionStrategy.dependencySubstitution {
      substitute(module('org.bouncycastle:bcprov-jdk15on'))
        .using(module('org.bouncycastle:bcprov-jdk15to18:1.78.1'))
        .because('duplicate classes between legacy and renamed BouncyCastle artifact lines break dexing')
    }
  }
}
`;

/**
 * Config plugin appending a BouncyCastle dependency substitution to
 * android/build.gradle. Fixes the Android production build failure
 * (EAS builds 91/147/148, July 2026) caused by duplicate BouncyCastle
 * classes on the runtime classpath.
 */
function withBouncyCastleDedup(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += BLOCK;
    }
    return cfg;
  });
}

module.exports = createRunOncePlugin(withBouncyCastleDedup, "withBouncyCastleDedup", "1.0.0");
