// Minimal config/firebase stub for vitest.
//
// The real module initialises the React Native Firebase SDK (auth persistence,
// AsyncStorage, etc.) at import time, which can't run under vitest. The pure
// helpers exercised by unit tests (resolveJobRequirements, scoreCustomerCandidates)
// never touch auth/db, so inert placeholders are enough to satisfy the import
// graph. Any test that actually needs Firestore should mock these explicitly.

export const auth: { currentUser: { uid: string } | null } = {
  currentUser: { uid: 'test-uid' },
};

export const db = {} as unknown;
