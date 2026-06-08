const { withDangerousMod, createRunOncePlugin } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Xcode 26's Clang enforces consteval more strictly than fmt 11.0.2 (bundled
// with RN 0.79) handles. Without this, all pods that consume fmt headers
// (RCT-Folly, glog, hermes, etc.) fail to compile with:
//   call to consteval function 'fmt::basic_format_string<...>' is not a constant expression
// fmt's base.h unconditionally redefines FMT_USE_CONSTEVAL based on compiler
// checks, so a -DFMT_USE_CONSTEVAL=0 from build settings is overridden. We
// patch the header source after pod install to force FMT_USE_CONSTEVAL=0.
const MARKER = "# QUOTEMATE_FMT_CONSTEVAL_FIX";
const INJECTION = `
    ${MARKER}
    fmt_base = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      content = File.read(fmt_base)
      patched = content.gsub('#  define FMT_USE_CONSTEVAL 1', '#  define FMT_USE_CONSTEVAL 0')
      File.write(fmt_base, patched) if patched != content
    end
`;

function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      let podfile = fs.readFileSync(podfilePath, "utf-8");
      if (podfile.includes(MARKER)) return config;

      const anchor = /react_native_post_install\([\s\S]*?\)\n/;
      const match = podfile.match(anchor);
      if (!match) {
        throw new Error(
          "withFmtConstevalFix: could not find react_native_post_install in Podfile"
        );
      }
      const insertAt = match.index + match[0].length;
      podfile = podfile.slice(0, insertAt) + INJECTION + podfile.slice(insertAt);
      fs.writeFileSync(podfilePath, podfile);
      return config;
    },
  ]);
}

module.exports = createRunOncePlugin(
  withFmtConstevalFix,
  "withFmtConstevalFix",
  "1.0.0"
);
