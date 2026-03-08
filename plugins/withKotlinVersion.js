const { withGradleProperties, createRunOncePlugin } = require("@expo/config-plugins");
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Config plugin to pin the Kotlin Gradle Plugin version in android/build.gradle.
 * The default prebuild generates `classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')`
 * without a version, which causes the compiler to resolve to an older version that
 * can't read metadata 2.2.0 from openiap-google and billing-ktx dependencies.
 */
function withKotlinVersion(config, kotlinVersion = "2.2.0") {
  return withDangerousMod(config, [
    "android",
    (config) => {
      const buildGradlePath = path.join(
        config.modRequest.platformProjectRoot,
        "build.gradle"
      );
      let buildGradle = fs.readFileSync(buildGradlePath, "utf-8");

      // Pin the Kotlin Gradle Plugin version
      buildGradle = buildGradle.replace(
        "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')",
        `classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:${kotlinVersion}')`
      );

      fs.writeFileSync(buildGradlePath, buildGradle);
      return config;
    },
  ]);
}

module.exports = createRunOncePlugin(withKotlinVersion, "withKotlinVersion", "1.0.0");
