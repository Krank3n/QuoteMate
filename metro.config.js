const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Watchman is broken on this machine — its daemon hangs on spawn (the OS killed
// the old daemon with SIGTERM and the 2025.10.06 build won't come back cleanly
// on Darwin 25.x), which left Metro stuck at "Waiting for Watchman
// `watch-project`" forever. Metro falls back to its built-in Node file watcher
// when this is off, so dev/HMR still work. Remove this line once `watchman
// version` responds again (e.g. after `brew reinstall watchman`).
config.resolver.useWatchman = false;

// Zustand's .mjs files use `import.meta.env` which Metro doesn't transform
// for web, causing "Cannot use 'import.meta' outside a module" at runtime.
// Force zustand to resolve to its .js files (which use process.env instead).
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName.startsWith('zustand')) {
    // Rewrite zustand imports to use the default (non-mjs) export
    const zustandRoot = path.dirname(require.resolve('zustand/package.json'));
    const pkg = require('zustand/package.json');

    // Map subpath imports to their CJS/default .js files
    const subpathMap = {
      'zustand': path.join(zustandRoot, 'index.js'),
      'zustand/vanilla': path.join(zustandRoot, 'vanilla.js'),
      'zustand/middleware': path.join(zustandRoot, 'middleware.js'),
      'zustand/shallow': path.join(zustandRoot, 'shallow.js'),
      'zustand/traditional': path.join(zustandRoot, 'traditional.js'),
      'zustand/context': path.join(zustandRoot, 'context.js'),
    };

    if (subpathMap[moduleName]) {
      return { type: 'sourceFile', filePath: subpathMap[moduleName] };
    }
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
