// Contract tests for document-intake-agent (the scan agent's gateway, plan D5).
//
// Coverage (cross-verify acceptance gates):
//   - fail-closed auth: AGENT_TOKEN unset → 500; wrong bearer → 401; non-POST → 405
//   - op=config returns ONLY active profiles + stamps agent_state
//   - op=request_upload: server-minted path (PC never authors shop/profile),
//     pending row inserted, signed URL returned; declared-type/size/sha gates
//   - retry semantics: an owned persisted path is reused; a path outside the
//     profile's own prefix is rejected (path_not_owned); an already-uploaded
//     object short-circuits to already_uploaded=true
//   - op=confirm: object-missing → 409 (agent retries upload); present →
//     pending→ready transition + heartbeat stamp; idempotent repeat
//   - op=heartbeat upserts agent_state
//
// Run: deno test --allow-all --no-check supabase/functions/document-intake-agent/index.test.ts

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createMockSupabaseClient, setEnv, unsetEnv } from "../_shared/test-helpers.ts";

const FAKE_AGENT_TOKEN = "agent_token_test_0123456789abcdef";
setEnv("AGENT_TOKEN", FAKE_AGENT_TOKEN);

const { handler, _setSupabaseClientForTesting, mintObjectPath } = await import("./index.ts");

const PROFILE_ROW = { key: "inspection_docs", shop_id: 7476, label: "State Inspection", bucket: "vehicle-docs", active: true };
const SHA = "a".repeat(64);

interface StorageStubState {
  existingBasenames: string[];
  signCalls: string[];
}

function makeSb(opts: { profile?: unknown; profiles?: unknown[]; storage?: StorageStubState } = {}) {
  const sb = createMockSupabaseClient();
  const storageState: StorageStubState = opts.storage ?? { existingBasenames: [], signCalls: [] };
  sb.onTable("document_intake_profiles", (call) => {
    const isMaybeSingle = call.chain.some((c) => c.method === "maybeSingle");
    if (isMaybeSingle) return { data: opts.profile ?? null, error: null };
    return { data: opts.profiles ?? [], error: null };
  });
  // deno-lint-ignore no-explicit-any
  (sb as any).storage = {
    from: (_bucket: string) => ({
      createSignedUploadUrl: (path: string) => {
        storageState.signCalls.push(path);
        return Promise.resolve({ data: { signedUrl: `https://signed.example/${path}`, token: "tok" }, error: null });
      },
      list: (_dir: string, listOpts?: { search?: string }) => {
        const found = storageState.existingBasenames
          .filter((n) => !listOpts?.search || n === listOpts.search)
          .map((n) => ({ name: n }));
        return Promise.resolve({ data: found, error: null });
      },
    }),
  };
  _setSupabaseClientForTesting(sb);
  return { sb, storageState };
}

function makeRequest(opts: { method?: string; bearer?: string | null; body?: unknown } = {}): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  const bearer = opts.bearer === undefined ? FAKE_AGENT_TOKEN : opts.bearer;
  if (bearer !== null) headers.set("Authorization", `Bearer ${bearer}`);
  return new Request("https://fn.example/document-intake-agent", {
    method: opts.method ?? "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

Deno.test("AGENT_TOKEN unset → 500 fail-closed", async () => {
  unsetEnv("AGENT_TOKEN");
  try {
    makeSb();
    const res = await handler(makeRequest({ body: { op: "config" } }));
    assertEquals(res.status, 500);
  } finally {
    setEnv("AGENT_TOKEN", FAKE_AGENT_TOKEN);
  }
});

Deno.test("wrong bearer → 401; non-POST → 405", async () => {
  makeSb();
  assertEquals((await handler(makeRequest({ bearer: "nope", body: { op: "config" } }))).status, 401);
  assertEquals((await handler(makeRequest({ method: "GET" }))).status, 405);
});

Deno.test("op=config returns active profiles + stamps agent_state", async () => {
  const { sb } = makeSb({ profiles: [PROFILE_ROW] });
  const res = await handler(makeRequest({ body: { op: "config", hostname: "SHOP-PC" } }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.profiles, [{ key: "inspection_docs", label: "State Inspection" }]);
  assert(Array.isArray(body.accepted_mime) && body.accepted_mime.includes("application/pdf"));
  const profileCall = sb.callsForTable("document_intake_profiles")[0];
  assert(profileCall.chain.some((c) => c.method === "eq" && c.args[0] === "active" && c.args[1] === true),
    "config must filter to active profiles only");
  assertEquals(sb.callsForTable("document_intake_agent_state").length, 1, "agent_state stamped");
});

Deno.test("mintObjectPath: opaque, PII-free, profile-scoped", () => {
  const p = mintObjectPath({ shopId: 7476, profileKey: "inspection_docs", mime: "application/pdf", sha256: SHA, now: new Date("2026-07-21T12:00:00Z") });
  assertMatch(p, /^7476\/inspection_docs\/scan\/2026\/07\/\d+_[0-9a-f]{4}_aaaaaaaa\.pdf$/);
  const p2 = mintObjectPath({ shopId: 7476, profileKey: "inspection_docs", mime: "application/pdf", sha256: SHA, now: new Date("2026-07-21T12:00:00Z") });
  assert(p !== p2, "same-ms same-content mints must not collide");
});

Deno.test("request_upload happy path: server-minted path + pending row + signed URL", async () => {
  const { sb, storageState } = makeSb({ profile: PROFILE_ROW });
  const res = await handler(makeRequest({
    body: {
      op: "request_upload", hostname: "SHOP-PC", profile_key: "inspection_docs",
      original_filename: "ins card front.pdf", sha256: SHA, size_bytes: 12345, mime_type: "application/pdf",
    },
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertMatch(body.object_path, /^7476\/inspection_docs\/scan\/\d{4}\/\d{2}\/\d+_[0-9a-f]{4}_aaaaaaaa\.pdf$/);
  assertEquals(body.already_uploaded, false);
  assert(body.signed_url?.startsWith("https://signed.example/"), "signed URL returned");
  assertEquals(storageState.signCalls.length, 1);
  const filesCall = sb.callsForTable("document_intake_files")[0];
  const upsertArg = filesCall.chain.find((c) => c.method === "upsert")?.args[0] as Record<string, unknown>;
  assertEquals(upsertArg.status, "pending");
  assertEquals(upsertArg.source, "scan");
  assertEquals(upsertArg.shop_id, 7476);
  assertEquals(upsertArg.original_filename, "ins card front.pdf");
});

Deno.test("request_upload gates: bad sha / bad mime / oversize / unknown profile", async () => {
  makeSb({ profile: PROFILE_ROW });
  const base = { op: "request_upload", profile_key: "inspection_docs", sha256: SHA, size_bytes: 100, mime_type: "application/pdf" };
  assertEquals((await handler(makeRequest({ body: { ...base, sha256: "short" } }))).status, 400);
  assertEquals((await handler(makeRequest({ body: { ...base, mime_type: "application/zip" } }))).status, 422);
  assertEquals((await handler(makeRequest({ body: { ...base, size_bytes: 41 * 1024 * 1024 } }))).status, 422);
  makeSb({ profile: null });
  assertEquals((await handler(makeRequest({ body: base }))).status, 422);
});

Deno.test("request_upload retry: foreign path rejected; owned+existing short-circuits", async () => {
  const owned = `7476/inspection_docs/scan/2026/07/999_${SHA.slice(0, 8)}.pdf`;
  const base = { op: "request_upload", profile_key: "inspection_docs", sha256: SHA, size_bytes: 100, mime_type: "application/pdf" };

  makeSb({ profile: PROFILE_ROW });
  const foreign = await handler(makeRequest({ body: { ...base, object_path: "9999/other_profile/scan/2026/07/1_x.pdf" } }));
  assertEquals(foreign.status, 422);
  assertEquals((await foreign.json()).error, "path_not_owned");

  const { storageState } = makeSb({ profile: PROFILE_ROW, storage: { existingBasenames: [owned.split("/").pop()!], signCalls: [] } });
  const retry = await handler(makeRequest({ body: { ...base, object_path: owned } }));
  assertEquals(retry.status, 200);
  const body = await retry.json();
  assertEquals(body.already_uploaded, true);
  assertEquals(body.object_path, owned);
  assertEquals(storageState.signCalls.length, 0, "no new signed URL when the object already exists");
});

Deno.test("confirm: missing object → 409; present → pending→ready + heartbeat", async () => {
  const path = "7476/inspection_docs/scan/2026/07/1_aaaaaaaa.pdf";
  {
    makeSb({ profile: PROFILE_ROW });
    const res = await handler(makeRequest({ body: { op: "confirm", object_path: path } }));
    assertEquals(res.status, 409);
  }
  {
    const { sb } = makeSb({ profile: PROFILE_ROW, storage: { existingBasenames: ["1_aaaaaaaa.pdf"], signCalls: [] } });
    sb.onTable("document_intake_files", { data: { id: "row-1" }, error: null });
    const res = await handler(makeRequest({ body: { op: "confirm", hostname: "SHOP-PC", object_path: path, size_bytes: 100 } }));
    assertEquals(res.status, 200);
    const update = sb.callsForTable("document_intake_files")[0];
    const updateArg = update.chain.find((c) => c.method === "update")?.args[0] as Record<string, unknown>;
    assertEquals(updateArg.status, "ready");
    assert(update.chain.some((c) => c.method === "eq" && c.args[0] === "status" && c.args[1] === "pending"),
      "only pending rows transition (idempotent confirm)");
    assertEquals(sb.callsForTable("document_intake_agent_state").length, 1, "last_upload_at stamped");
  }
});

Deno.test("heartbeat upserts agent_state", async () => {
  const { sb } = makeSb({ profile: { shop_id: 7476 } });
  const res = await handler(makeRequest({ body: { op: "heartbeat", hostname: "SHOP-PC", agent_version: "1.0.0" } }));
  assertEquals(res.status, 200);
  const call = sb.callsForTable("document_intake_agent_state")[0];
  const arg = call.chain.find((c) => c.method === "upsert")?.args[0] as Record<string, unknown>;
  assertEquals(arg.hostname, "SHOP-PC");
  assertEquals(arg.agent_version, "1.0.0");
  assert(typeof arg.last_heartbeat_at === "string");
});
