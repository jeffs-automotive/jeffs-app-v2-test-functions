// Test helpers for Edge Function unit tests.
//
// The two webhook receivers (`tekmetric-webhook`, `keytag-tekmetric-webhook`)
// hold their Supabase client as a module-level `let sb` that tests swap via
// the exported `_setSupabaseClientForTesting(client)` seam. This module
// provides a builder that returns a chainable mock matching the subset of
// supabase-js APIs the receivers actually use:
//
//   - sb.from(table).upsert(row, opts).select("...").maybeSingle()
//   - sb.from(table).select("...").eq("col", v).maybeSingle()
//   - sb.from(table).select("...").or("...").neq(...).order(...).limit(...)
//   - sb.from(table).update(row).eq("col", v)
//   - sb.from(table).select("...").in(...).is(...).filter(...).limit(...).maybeSingle()
//   - sb.rpc("name", args)
//
// The mock records EVERY call so tests can assert against the call log
// instead of trying to over-stub specific chain shapes. Each `.from()` is
// configured per-table via `onTable(name, behavior)`, each `.rpc()` via
// `onRpc(name, behavior)`.
//
// Behaviors return one of:
//   { data, error?, count? }                                    — terminal result for a chain
//   (call) => { data, error?, count? }                          — dynamic result
//
// Anything not explicitly configured returns `{ data: null, error: null }`.

// deno-lint-ignore-file no-explicit-any

export type SupabaseTerminalResult = {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
};

export type SupabaseBehavior =
  | SupabaseTerminalResult
  | ((call: RecordedCall) => SupabaseTerminalResult);

export interface RecordedCall {
  /** "from" or "rpc" */
  kind: "from" | "rpc";
  /** Table name for `from`, function name for `rpc` */
  name: string;
  /** Method chain after `from()` (e.g., ["upsert", "select", "maybeSingle"]) */
  chain: Array<{ method: string; args: unknown[] }>;
  /** For rpc calls: the args object passed to .rpc(name, args) */
  rpcArgs?: unknown;
}

export interface MockSupabaseClient {
  /** All recorded from() chains AND rpc() invocations, in call order */
  calls: RecordedCall[];
  /** Configure per-table behavior */
  onTable: (name: string, behavior: SupabaseBehavior) => void;
  /** Configure per-RPC behavior */
  onRpc: (name: string, behavior: SupabaseBehavior) => void;
  /** Convenience getter: filter calls down to a specific table */
  callsForTable: (name: string) => RecordedCall[];
  /** Convenience getter: filter rpc calls by function name */
  callsForRpc: (name: string) => RecordedCall[];
  /** The supabase-js-compatible API surface */
  from: (table: string) => any;
  rpc: (name: string, args?: unknown) => Promise<SupabaseTerminalResult>;
}

/**
 * Construct a mock Supabase client. Configure terminal behavior per-table
 * and per-RPC via `onTable` / `onRpc`. Anything unconfigured returns
 * `{ data: null, error: null }`.
 *
 * Example:
 *   const sb = createMockSupabaseClient();
 *   sb.onTable("tekmetric_webhook_events", { data: { id: "row-123" }, error: null });
 *   sb.onRpc("assign_next_keytag", { data: [{ tag_color: "red", tag_number: 7 }], error: null });
 */
export function createMockSupabaseClient(): MockSupabaseClient {
  const calls: RecordedCall[] = [];
  const tableBehaviors = new Map<string, SupabaseBehavior>();
  const rpcBehaviors = new Map<string, SupabaseBehavior>();

  function resolveBehavior(
    map: Map<string, SupabaseBehavior>,
    name: string,
    call: RecordedCall,
  ): SupabaseTerminalResult {
    const beh = map.get(name);
    if (!beh) return { data: null, error: null };
    if (typeof beh === "function") return beh(call);
    return beh;
  }

  function buildChain(call: RecordedCall, terminal: () => SupabaseTerminalResult): any {
    const chainProxy: any = {};
    const allMethods = [
      "select",
      "insert",
      "upsert",
      "update",
      "delete",
      "eq",
      "neq",
      "not",
      "in",
      "is",
      "or",
      "filter",
      "order",
      "limit",
      "range",
      "lt",
      "lte",
      "gt",
      "gte",
      "single",
      "maybeSingle",
    ];
    // Terminal methods that should resolve to a promise.
    const terminalMethods = new Set(["single", "maybeSingle"]);
    for (const m of allMethods) {
      chainProxy[m] = (...args: unknown[]) => {
        call.chain.push({ method: m, args });
        if (terminalMethods.has(m)) {
          return Promise.resolve(terminal());
        }
        return chainProxy;
      };
    }
    // Make the chain itself thenable so chains that don't end in
    // single/maybeSingle (e.g., `await sb.from(...).update(...).eq(...)`)
    // still resolve to a terminal result.
    chainProxy.then = (
      resolve: (v: SupabaseTerminalResult) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      try {
        return Promise.resolve(terminal()).then(resolve, reject);
      } catch (e) {
        if (reject) return reject(e);
        throw e;
      }
    };
    return chainProxy;
  }

  const client: MockSupabaseClient = {
    calls,
    onTable: (name, behavior) => tableBehaviors.set(name, behavior),
    onRpc: (name, behavior) => rpcBehaviors.set(name, behavior),
    callsForTable: (name) =>
      calls.filter((c) => c.kind === "from" && c.name === name),
    callsForRpc: (name) =>
      calls.filter((c) => c.kind === "rpc" && c.name === name),
    from: (table: string) => {
      const call: RecordedCall = { kind: "from", name: table, chain: [] };
      calls.push(call);
      return buildChain(call, () => resolveBehavior(tableBehaviors, table, call));
    },
    rpc: (name: string, args?: unknown) => {
      const call: RecordedCall = { kind: "rpc", name, chain: [], rpcArgs: args };
      calls.push(call);
      return Promise.resolve(resolveBehavior(rpcBehaviors, name, call));
    },
  };

  return client;
}

// ─── fetch stub helpers ─────────────────────────────────────────────────────
//
// The keytag receiver hits Tekmetric via `fetch()` in two places:
//   1. patchKeytagToTekmetric (PATCH /repair-orders/:id?shop=...)
//   2. getRepairOrderById     (GET  /repair-orders/:id?shop=...)
//
// Tests use `withMockedFetch(impl, fn)` to scope a fetch replacement to
// one test body. Restores the original fetch on exit (success or throw).

export interface RecordedFetchCall {
  url: string;
  init: RequestInit | undefined;
}

export interface MockedFetchScope {
  calls: RecordedFetchCall[];
}

export async function withMockedFetch(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
  fn: (scope: MockedFetchScope) => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  const scope: MockedFetchScope = { calls: [] };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : (input as Request).url;
    scope.calls.push({ url, init });
    return impl(url, init);
  }) as typeof fetch;
  try {
    await fn(scope);
  } finally {
    globalThis.fetch = original;
  }
}

/**
 * Build a fetch impl that returns a JSON response with the given body and
 * status code. The mocked `Response` is thin — it implements `.ok`, `.status`,
 * `.text()`, and `.json()`, which is everything `tekmetric-client.ts` and
 * the receivers use.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Env helpers ────────────────────────────────────────────────────────────
//
// The receivers read env vars at handler-call time (not module-init time)
// via the `_readWebhookToken()` test seam. Tests use these helpers to set
// up + tear down env values safely.

export function setEnv(name: string, value: string): void {
  Deno.env.set(name, value);
}

export function unsetEnv(name: string): void {
  try {
    Deno.env.delete(name);
  } catch {
    // Some Deno versions throw on delete of unset; ignore.
  }
}
