// Minimal @env stub for vitest.
//
// The real @env module is a react-native-dotenv babel transform that only
// exists inside the Metro build. Modules on the store import graph
// (llmService) pull env keys from it at import time; tests never call the
// APIs that use them, so undefined placeholders satisfy the graph.

export const ANTHROPIC_API_KEY = undefined;
export const GEMINI_API_KEY = undefined;
