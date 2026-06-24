// Test stub for the `server-only` marker package. In the app it throws if a
// server module is pulled into a client bundle; under Vitest (node) it's a
// no-op so we can unit-test server-only modules (e.g. lib/keytag/load-board-state).
export {};
