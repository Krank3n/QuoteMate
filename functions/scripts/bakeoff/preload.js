/**
 * Lets the bake-off import the REAL client pipeline (src/services/materialsPipeline)
 * from a Node script. The pipeline is written for the Expo/React-Native graph, so
 * a handful of modules don't exist under plain Node — `@env` (babel-plugin-dotenv),
 * the Expo native modules, and the Firebase *client* SDK.
 *
 * Every stub here is inert: the bake-off only calls the pure decision functions
 * (applyReconcileResult and friends). If a stubbed module is ever actually
 * invoked it throws loudly rather than silently returning a wrong answer, so a
 * future refactor that moves real logic behind one of these can't quietly
 * corrupt a measurement run.
 *
 * Usage: node -r ./scripts/bakeoff/preload.js -r ts-node/register script.ts
 */

const Module = require('module');

function boom(name) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === '__esModule') return true;
        if (prop === 'default') return boom(name);
        if (typeof prop === 'symbol') return undefined;
        return () => {
          throw new Error(
            `[bakeoff preload] The harness called ${name}.${String(prop)}() — that is a runtime/native ` +
              `dependency the replay must never reach. Arm A is meant to use pure decision logic only.`,
          );
        };
      },
    },
  );
}

const STUBS = {
  // babel-plugin-dotenv-import virtual module.
  '@env': {
    FIREBASE_API_KEY: '',
    FIREBASE_AUTH_DOMAIN: '',
    FIREBASE_PROJECT_ID: 'hansendev',
    FIREBASE_STORAGE_BUCKET: '',
    FIREBASE_MESSAGING_SENDER_ID: '',
    FIREBASE_APP_ID: '',
    API_BASE_URL: '',
    BUNNINGS_SCRAPER_URL: process.env.BUNNINGS_SCRAPER_URL || '',
    BUNNINGS_SCRAPER_API_KEY: process.env.BUNNINGS_SCRAPER_API_KEY || '',
  },
  // llmService reads Platform.OS only, to decide whether to touch expo-file-system.
  // 'web' is the branch that stays pure, which is exactly what the replay wants.
  'react-native': { Platform: { OS: 'web', select: (o) => o.web ?? o.default } },
  'expo-modules-core': boom('expo-modules-core'),
  'expo-keep-awake': { activateKeepAwakeAsync: async () => {}, deactivateKeepAwake: async () => {} },
  'expo-constants': { default: { expoConfig: { extra: {} } } },
  'expo-file-system': boom('expo-file-system'),
  'expo-secure-store': boom('expo-secure-store'),
  '@react-native-async-storage/async-storage': {
    default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
  },
};

// The Firebase *client* SDK is the only thing that drags the React Native /
// Flow-typed graph into materialsPipeline, and none of the pure decision
// functions the bake-off calls touch it — the pipeline imports it for the
// httpsCallable paths only. Stubbing it by path suffix is what makes the REAL
// applyReconcileResult importable, so arm A runs production's actual logic
// instead of a reimplementation that would drift from it.
// materialsPipeline transitively reaches the Zustand store, which reaches
// analytics/store-review/xero and from there most of the Expo native surface.
// None of it is on the pricing decision path, so every native package is
// stubbed generically rather than one at a time — a boom stub means any
// accidental call fails loudly instead of returning a plausible wrong value.
const PATH_STUBS = [
  { match: /(^|\/)(src\/)?config\/firebase$/, value: boom('config/firebase') },
  { match: /^@?expo(-|\/|$)/, value: boom('expo-native') },
  { match: /^@react-native(-|\/)/, value: boom('react-native-native') },
  { match: /^react-native-/, value: boom('react-native-pkg') },
  { match: /^firebase(\/|$)/, value: boom('firebase-client-sdk') },
  { match: /^@sentry\//, value: boom('sentry') },
];

function stubFor(request) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  const hit = PATH_STUBS.find((s) => s.match.test(request));
  return hit ? hit.value : undefined;
}

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (stubFor(request) !== undefined) return `\0bakeoff-stub:${request}`;
  return origResolve.call(this, request, ...rest);
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  const stub = stubFor(request);
  if (stub !== undefined) return stub;
  return origLoad.call(this, request, ...rest);
};
