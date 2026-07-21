// Contract tests for document-intake-email (Graph mailbox intake, plan D7/D8/D9).
//
// Coverage (cross-verify acceptance gates):
//   - validation handshake echoes the token as text/plain
//   - notifications: unknown subscription rejected; clientState mismatch
//     rejected; valid → durable pending event + 202; duplicate delivery is a
//     no-op (dedup); store failure → 500 so Graph redelivers
//   - lifecycle events recorded on the subscription row, no event created
//   - cron mode: bearer-gated; bootstrap creates subscriptions with ≤2.5-day
//     expiration + stores the clientState HASH (never plaintext)
//   - sniffMime: magic bytes decide (pdf/jpeg/png/heic; garbage → null)
//   - processEvent: inline + oversize + off-type skipped with reasons;
//     partial failure → event retryable, uploaded attachment NOT re-fetched
//     on the retry (exactly-once), failed one re-attempted; success path
//     writes a rich `ready` files row via upsert on object_path
//
// Run: deno test --allow-all --no-check supabase/functions/document-intake-email/index.test.ts

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createMockSupabaseClient, setEnv } from "../_shared/test-helpers.ts";

const FAKE_SECRET = "sb_secret_test_docintake_0123456789";
setEnv("SUPABASE_SECRET_KEY", FAKE_SECRET);
setEnv("SUPABASE_URL", "https://test-project.supabase.co");

const { handler, _setSupabaseClientForTesting, _setGraphClientForTesting } = await import("./index.ts");
const { sniffMime, mintEmailObjectPath, processEvent } = await import("./process.ts");
const { sha256HexString } = await import("./cron.ts");

const SUB_ID = "sub-abc-123";
const CLIENT_STATE = "cs-plaintext-value-0001";
const CLIENT_STATE_HASH = await sha256HexString(CLIENT_STATE);
const MAILBOX = "inspection@jeffsautomotive.com";

function makeSb() {
  const sb = createMockSupabaseClient();
  // deno-lint-ignore no-explicit-any
  const sbAny = sb as any;
  const uploads: Array<{ path: string; size: number; contentType: string }> = [];
  sbAny.storage = {
    from: (_b: string) => ({
      upload: (path: string, bytes: Uint8Array, opts: { contentType: string }) => {
        uploads.push({ path, size: bytes.length, contentType: opts.contentType });
        return Promise.resolve({ data: { path }, error: null });
      },
    }),
  };
  sbAny.schema = (_s: string) => ({ from: (t: string) => sbAny.from(`storage.${t}`) });
  _setSupabaseClientForTesting(sb);
  return { sb, uploads };
}

function makeRequest(opts: { method?: string; bearer?: string | null; body?: unknown; query?: string } = {}): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opts.bearer) headers.set("Authorization", `Bearer ${opts.bearer}`);
  return new Request(`https://fn.example/document-intake-email${opts.query ?? ""}`, {
    method: opts.method ?? "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

function notification(overrides: Record<string, unknown> = {}) {
  return {
    value: [{
      subscriptionId: SUB_ID,
      clientState: CLIENT_STATE,
      resourceData: { id: "msg-immutable-1" },
      ...overrides,
    }],
  };
}

// ─── Handshake + routing ────────────────────────────────────────────────

Deno.test("validation handshake echoes token as text/plain", async () => {
  makeSb();
  const res = await handler(makeRequest({ method: "GET", query: "?validationToken=tok%20123" }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/plain");
  assertEquals(await res.text(), "tok 123");
});

Deno.test("non-POST without token → 405; junk body → 400", async () => {
  makeSb();
  assertEquals((await handler(makeRequest({ method: "GET" }))).status, 405);
  const bad = new Request("https://fn.example/x", { method: "POST", body: "not json" });
  assertEquals((await handler(bad)).status, 400);
});

// ─── Notifications ──────────────────────────────────────────────────────

Deno.test("unknown subscription → rejected, no event stored", async () => {
  const { sb } = makeSb();
  sb.onTable("graph_mail_subscriptions", { data: null, error: null });
  const res = await handler(makeRequest({ body: notification() }));
  assertEquals(res.status, 202);
  const body = await res.json();
  assertEquals(body.accepted, 0);
  assertEquals(body.rejected, 1);
  assertEquals(sb.callsForTable("graph_mail_events").length, 0);
});

Deno.test("clientState mismatch → rejected", async () => {
  const { sb } = makeSb();
  sb.onTable("graph_mail_subscriptions", { data: { mailbox: MAILBOX, client_state_hash: CLIENT_STATE_HASH }, error: null });
  const res = await handler(makeRequest({ body: notification({ clientState: "wrong" }) }));
  const body = await res.json();
  assertEquals(body.accepted, 0);
  assertEquals(body.rejected, 1);
});

Deno.test("valid notification → durable pending event, 202; duplicate → no-op", async () => {
  const { sb } = makeSb();
  sb.onTable("graph_mail_subscriptions", { data: { mailbox: MAILBOX, client_state_hash: CLIENT_STATE_HASH }, error: null });
  let firstDelivery = true;
  sb.onTable("graph_mail_events", () => {
    // ignoreDuplicates upsert: first delivery returns the row, duplicate returns null
    const data = firstDelivery
      ? { id: "ev-1", mailbox: MAILBOX, graph_message_id: "msg-immutable-1", status: "pending", attempts: 0 }
      : null;
    firstDelivery = false;
    return { data, error: null };
  });
  const res1 = await handler(makeRequest({ body: notification() }));
  assertEquals(res1.status, 202);
  assertEquals((await res1.json()).accepted, 1);
  const upsertArg = sb.callsForTable("graph_mail_events")[0].chain.find((c) => c.method === "upsert")?.args[0] as Record<string, unknown>;
  assertEquals(upsertArg.status, "pending");
  assertEquals(upsertArg.mailbox, MAILBOX);
  assertEquals(upsertArg.graph_message_id, "msg-immutable-1");
  // The plaintext clientState is a live forgery token — it must NEVER be
  // persisted (pattern+security review): only its hash exists, on the
  // subscription row.
  const rawNotification = upsertArg.raw_notification as Record<string, unknown>;
  assertEquals("clientState" in rawNotification, false, "clientState redacted from raw_notification");
  assertEquals(rawNotification.subscriptionId, SUB_ID, "the rest of the notification is preserved");

  const res2 = await handler(makeRequest({ body: notification() }));
  assertEquals((await res2.json()).accepted, 0, "duplicate delivery accepted nothing (dedup)");
});

Deno.test("event store failure → 500 so Graph redelivers", async () => {
  const { sb } = makeSb();
  sb.onTable("graph_mail_subscriptions", { data: { mailbox: MAILBOX, client_state_hash: CLIENT_STATE_HASH }, error: null });
  sb.onTable("graph_mail_events", { data: null, error: { message: "db down" } });
  const res = await handler(makeRequest({ body: notification() }));
  assertEquals(res.status, 500);
});

Deno.test("lifecycle event → recorded on subscription, no event row", async () => {
  const { sb } = makeSb();
  sb.onTable("graph_mail_subscriptions", { data: { mailbox: MAILBOX, client_state_hash: CLIENT_STATE_HASH }, error: null });
  const res = await handler(makeRequest({ body: notification({ lifecycleEvent: "reauthorizationRequired", resourceData: null }) }));
  assertEquals(res.status, 202);
  const updates = sb.callsForTable("graph_mail_subscriptions").filter((c) => c.chain.some((x) => x.method === "update"));
  assertEquals(updates.length, 1, "lifecycle_state recorded");
  assertEquals(sb.callsForTable("graph_mail_events").length, 0);
});

// ─── Cron mode ──────────────────────────────────────────────────────────

Deno.test("cron mode without bearer → 401", async () => {
  makeSb();
  const res = await handler(makeRequest({ body: { mode: "cron" } }));
  assertEquals(res.status, 401);
});

Deno.test("bootstrap creates subscriptions: ≤2.5-day expiration, hash stored (never plaintext)", async () => {
  const { sb } = makeSb();
  sb.onTable("document_intake_mailboxes", {
    data: [{ address: MAILBOX, profile_key: "inspection_docs", document_intake_profiles: { shop_id: 7476 } }],
    error: null,
  });
  sb.onTable("graph_mail_subscriptions", (call) => {
    const isMaybeSingle = call.chain.some((c) => c.method === "maybeSingle");
    return { data: isMaybeSingle ? null : [], error: null };
  });
  sb.onTable("graph_mail_events", { data: [], error: null });
  sb.onTable("document_intake_files", { data: [], error: null });
  sb.onTable("storage.objects", { data: [], error: null });
  sb.onTable("document_intake_agent_state", { data: [], error: null });
  sb.onRpc("document_intake_claim_cron_lease", { data: true, error: null });
  sb.onRpc("document_intake_release_cron_lease", { data: true, error: null });

  const created: Array<Record<string, unknown>> = [];
  _setGraphClientForTesting({
    createSubscription: (args: Record<string, unknown>) => {
      created.push(args);
      return Promise.resolve({ id: SUB_ID, resource: "r", expirationDateTime: args.expirationDateTime });
    },
    deleteSubscription: () => Promise.resolve(),
    renewSubscription: () => Promise.reject(new Error("should not renew on bootstrap")),
    listMessagesSince: () => Promise.resolve([]),
  });
  try {
    const res = await handler(makeRequest({ bearer: FAKE_SECRET, body: { mode: "bootstrap" } }));
    assertEquals(res.status, 200);
    const report = (await res.json()).report;
    assertEquals(report.locked, true);
    assertEquals(report.recreated, 1);
    assertEquals(report.step_errors, [], "no cron step may error in the wiring test");
    assertEquals(report.reclaimed_processing, 0, "reclaim step ran (fix B2)");

    assertEquals(created.length, 1);
    const expMs = new Date(created[0].expirationDateTime as string).getTime() - Date.now();
    assert(expMs <= 2.5 * 86_400_000 + 60_000, "expiration ≤ 2.5 days (valid under BOTH lifetime figures)");
    assert(expMs > 2.4 * 86_400_000, "expiration close to the 2.5-day target");

    const subUpserts = sb.callsForTable("graph_mail_subscriptions")
      .map((c) => c.chain.find((x) => x.method === "upsert")?.args[0] as Record<string, unknown> | undefined)
      .filter((a): a is Record<string, unknown> => a !== undefined);
    assertEquals(subUpserts.length, 1);
    const storedHash = subUpserts[0].client_state_hash as string;
    assertMatch(storedHash, /^[0-9a-f]{64}$/);
    assert(storedHash !== created[0].clientState, "plaintext clientState is never stored");
    assertEquals(storedHash, await sha256HexString(created[0].clientState as string));
    assertEquals(subUpserts[0].shop_id, 7476, "tenant captured on the subscription row (fix S1)");
  } finally {
    _setGraphClientForTesting(null);
  }
});

Deno.test("reclaimStaleProcessing: stranded claims return to retryable (fix B2)", async () => {
  const { reclaimStaleProcessing } = await import("./cron.ts");
  const { sb } = makeSb();
  sb.onTable("graph_mail_events", { data: [{ id: "stuck-1" }, { id: "stuck-2" }], error: null });
  // deno-lint-ignore no-explicit-any
  const n = await reclaimStaleProcessing(sb as any);
  assertEquals(n, 2);
  const call = sb.callsForTable("graph_mail_events")[0];
  const updateArg = call.chain.find((c) => c.method === "update")?.args[0] as Record<string, unknown>;
  assertEquals(updateArg.status, "retryable");
  assert(call.chain.some((c) => c.method === "eq" && c.args[0] === "status" && c.args[1] === "processing"),
    "only processing rows are reclaimed");
  assert(call.chain.some((c) => c.method === "lt" && c.args[0] === "updated_at"),
    "only STALE processing rows are reclaimed");
});

// ─── Magic bytes (D9) ───────────────────────────────────────────────────

Deno.test("sniffMime: magic bytes decide, declarations don't", () => {
  assertEquals(sniffMime(new TextEncoder().encode("%PDF-1.7 xyz")), "application/pdf");
  assertEquals(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
  assertEquals(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  const heic = new Uint8Array(16);
  heic.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70], 0);
  heic.set(new TextEncoder().encode("heic"), 8);
  assertEquals(sniffMime(heic), "image/heic");
  assertEquals(sniffMime(new TextEncoder().encode("MZ this is an exe pretending")), null);
});

Deno.test("mintEmailObjectPath: routed + unrouted shapes", () => {
  const routed = mintEmailObjectPath({ shopId: 7476, profileKey: "inspection_docs", mime: "image/jpeg", sha256: "b".repeat(64), now: new Date("2026-07-21T12:00:00Z") });
  assertMatch(routed, /^7476\/inspection_docs\/email\/2026\/07\/\d+_[0-9a-f]{4}_bbbbbbbb\.jpg$/);
  const unrouted = mintEmailObjectPath({ shopId: 7476, profileKey: null, mime: "application/pdf", sha256: "c".repeat(64) });
  assertMatch(unrouted, /^7476\/unrouted\/email\/\d{4}\/\d{2}\/\d+_[0-9a-f]{4}_cccccccc\.pdf$/);
  const again = mintEmailObjectPath({ shopId: 7476, profileKey: "inspection_docs", mime: "image/jpeg", sha256: "b".repeat(64), now: new Date("2026-07-21T12:00:00Z") });
  assert(routed !== again, "same-ms same-content mints must not collide");
});

// ─── processEvent: skip rules + exactly-once partial retry ──────────────

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7 fake body for tests");

function graphStubForProcessing(state: { failPdf2: boolean; bytesFetched: string[] }) {
  return {
    getMessageMeta: () => Promise.resolve({
      id: "msg-immutable-1", internetMessageId: "<x@y>", subject: "insurance card",
      from: "customer@example.com", receivedDateTime: "2026-07-21T12:00:00Z", hasAttachments: true,
    }),
    listAttachments: () => Promise.resolve([
      { id: "att-inline", name: "logo.png", contentType: "image/png", size: 100, isInline: true, odataType: "#microsoft.graph.fileAttachment" },
      { id: "att-pdf-1", name: "card1.pdf", contentType: "application/pdf", size: PDF_BYTES.length, isInline: false, odataType: "#microsoft.graph.fileAttachment" },
      { id: "att-pdf-2", name: "card2.pdf", contentType: "application/pdf", size: PDF_BYTES.length, isInline: false, odataType: "#microsoft.graph.fileAttachment" },
    ]),
    getAttachmentBytes: (_mb: string, _msg: string, attId: string) => {
      state.bytesFetched.push(attId);
      if (attId === "att-pdf-2" && state.failPdf2) return Promise.reject(new Error("transient 429"));
      return Promise.resolve(PDF_BYTES);
    },
  };
}

Deno.test("processEvent: inline skipped; partial failure retries EXACTLY the failed attachment", async () => {
  const { sb, uploads } = makeSb();
  const state = { failPdf2: true, bytesFetched: [] as string[] };

  // Mutable attachment-row store the mock serves + updates.
  const attRows = new Map<string, { id: string; graph_attachment_id: string; status: string; object_path: string | null }>();
  let nextId = 1;
  sb.onTable("graph_mail_attachments", (call) => {
    const upsert = call.chain.find((c) => c.method === "upsert");
    if (upsert) {
      const row = upsert.args[0] as { graph_attachment_id: string };
      if (!attRows.has(row.graph_attachment_id)) {
        attRows.set(row.graph_attachment_id, {
          id: `ar-${nextId++}`, graph_attachment_id: row.graph_attachment_id, status: "pending", object_path: null,
        });
      }
      return { data: null, error: null };
    }
    const update = call.chain.find((c) => c.method === "update");
    if (update) {
      const patch = update.args[0] as { status?: string; object_path?: string };
      const eqId = call.chain.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1];
      const eqStatus = call.chain.find((c) => c.method === "eq" && c.args[0] === "status")?.args[1];
      const eqEvent = call.chain.find((c) => c.method === "eq" && c.args[0] === "event_id");
      for (const row of attRows.values()) {
        const idMatch = eqId === undefined || row.id === eqId;
        const statusMatch = eqStatus === undefined || row.status === eqStatus;
        if ((eqEvent || eqId !== undefined) && idMatch && statusMatch) {
          if (patch.status) row.status = patch.status;
          if (patch.object_path) row.object_path = patch.object_path;
        }
      }
      return { data: null, error: null };
    }
    return { data: [...attRows.values()], error: null };
  });
  sb.onTable("graph_mail_events", { data: { id: "ev-1" }, error: null });
  sb.onTable("document_intake_mailboxes", {
    data: { profile_key: "inspection_docs", document_intake_profiles: { shop_id: 7476, active: true } },
    error: null,
  });
  sb.onTable("document_intake_files", { data: null, error: null });

  const event = { id: "ev-1", mailbox: MAILBOX, graph_message_id: "msg-immutable-1", status: "pending", attempts: 0 };
  // deno-lint-ignore no-explicit-any
  const result1 = await processEvent(sb as any, graphStubForProcessing(state) as any, event);
  assertEquals(result1, "retryable", "one failed attachment → event retryable");
  assertEquals(attRows.get("att-inline")?.status, "skipped");
  assertEquals(attRows.get("att-pdf-1")?.status, "uploaded");
  assertEquals(attRows.get("att-pdf-2")?.status, "pending", "failed attachment reset for retry");
  assertEquals(uploads.length, 1, "only the good attachment uploaded");
  const filesUpsert = sb.callsForTable("document_intake_files")
    .map((c) => c.chain.find((x) => x.method === "upsert")?.args[0] as Record<string, unknown> | undefined)
    .filter((a): a is Record<string, unknown> => a !== undefined)[0];
  assertEquals(filesUpsert.status, "ready");
  assertEquals(filesUpsert.source, "email");
  assertEquals(filesUpsert.email_from, "customer@example.com");
  assertMatch(filesUpsert.object_path as string, /^7476\/inspection_docs\/email\//);

  // Retry round: the transient failure is gone.
  state.failPdf2 = false;
  state.bytesFetched.length = 0;
  const result2 = await processEvent(sb as any, graphStubForProcessing(state) as any, { ...event, status: "retryable", attempts: 1 });
  assertEquals(result2, "completed");
  assertEquals(attRows.get("att-pdf-2")?.status, "uploaded");
  assertEquals(state.bytesFetched, ["att-pdf-2"], "the already-uploaded attachment was NOT re-fetched (exactly-once)");
});
