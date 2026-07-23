// Deno-native unit tests for the edit-labor-lines capability.
//
//   deno test --allow-env supabase/functions/_shared/tekbridge/capabilities/edit-labor-lines.test.ts
//
// Routes the mocked fetch: GET …/estimate returns a job; POST …/job echoes the
// posted body back as `data` so we can assert what was sent (edits applied,
// parts/fees preserved).

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1";
import { editLaborLines } from "./edit-labor-lines.ts";
import { clearBotJwtCache } from "../session.ts";

const realFetch = globalThis.fetch;

function b64url(o: unknown): string {
  return btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const FRESH_JWT = `${b64url({ alg: "HS256" })}.${b64url({ exp: 9_999_999_999, shopId: "7476" })}.sig`;

// deno-lint-ignore no-explicit-any
function makeSb(): any {
  return {
    rpc: (name: string, params: { p_name?: string }) =>
      Promise.resolve(name === "tekmetric_get_secret" && params?.p_name === "tekbridge_session_jwt" ? { data: FRESH_JWT, error: null } : { data: null, error: null }),
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
  };
}

function fixtureJob() {
  return {
    id: 1222499211, repairOrderId: 345502292, name: "PA INSPECTION", selected: true, status: "Approved",
    labor: [
      { id: 970375421, name: "State Inspection Sticker#: ", hours: 0, rate: 0, total: 0 },
      { id: 970375422, name: "EMISSIONS INSPECTION", hours: 0.3, rate: 13607, total: 4082 },
      { id: 970375423, name: "Emission Sticker#: ", hours: 0, rate: 5166, total: 0 },
    ],
    parts: [{ id: 1097851890, name: "State Inspection Sticker" }],
    fees: [{ id: 153735985, name: "State Communication Fee" }],
    discounts: [],
  };
}

// deno-lint-ignore no-explicit-any
function stub(job: any): { postedBody: () => any; restore: () => void } {
  // deno-lint-ignore no-explicit-any
  let posted: any = null;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.endsWith("/estimate") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ jobs: job ? [job] : [] }), { status: 200 }));
    }
    if (url.endsWith("/job") && method === "POST") {
      posted = JSON.parse(init!.body as string);
      return Promise.resolve(new Response(JSON.stringify({ type: "SUCCESS", data: posted }), { status: 200 }));
    }
    return Promise.resolve(new Response("unrouted", { status: 500 }));
  }) as typeof fetch;
  return { postedBody: () => posted, restore: () => { globalThis.fetch = realFetch; } };
}

Deno.test("editLaborLines: replace, append, set-rate — preserves parts/fees", async () => {
  clearBotJwtCache();
  const s = stub(fixtureJob());
  try {
    const r = await editLaborLines(makeSb(), 7476, {
      repairOrderId: 345502292,
      jobId: 1222499211,
      edits: [
        { laborId: 970375421, name: "SUMMARY LINE 1\nLINE 2" }, // replace (multi-line)
        { laborId: 970375423, appendName: "EM8888888" }, // append
        { laborId: 970375422, name: "EMISSIONS INSPECTION (exempt)", rateCents: 0 }, // rename + exempt
      ],
    });
    assertEquals(r.ok, true);
    assertEquals(r.jobId, 1222499211);

    const byId = (id: number) => r.edited.find((e) => e.laborId === id)!;
    assertEquals(byId(970375421).name, "SUMMARY LINE 1\nLINE 2");
    assertEquals(byId(970375423).name, "Emission Sticker#: EM8888888");
    assertEquals(byId(970375422).name, "EMISSIONS INSPECTION (exempt)");
    assertEquals(byId(970375422).rate, 0);

    // the reposted body preserved the untouched line + parts + fees
    const posted = s.postedBody();
    assertEquals(posted.labor.find((l: { id: number }) => l.id === 970375420 || l.id === 970375422).id !== undefined, true);
    assertEquals(posted.parts.length, 1);
    assertEquals(posted.fees.length, 1);
    assertEquals(posted.labor.length, 3);
  } finally {
    s.restore();
    clearBotJwtCache();
  }
});

Deno.test("editLaborLines: throws (no write) when the job isn't found", async () => {
  clearBotJwtCache();
  const s = stub(null); // no jobs on the estimate
  try {
    await assertRejects(
      () => editLaborLines(makeSb(), 7476, { repairOrderId: 1, jobId: 999, edits: [{ laborId: 1, name: "x" }] }),
      Error,
      "job 999 not found",
    );
    assertEquals(s.postedBody(), null, "must not POST when the job is missing");
  } finally {
    s.restore();
    clearBotJwtCache();
  }
});

Deno.test("editLaborLines: throws (no write) when a labor id isn't found", async () => {
  clearBotJwtCache();
  const s = stub(fixtureJob());
  try {
    await assertRejects(
      () => editLaborLines(makeSb(), 7476, { repairOrderId: 345502292, jobId: 1222499211, edits: [{ laborId: 111111, name: "x" }] }),
      Error,
      "labor line 111111 not found",
    );
    assertEquals(s.postedBody(), null, "must not POST when a labor id is wrong");
  } finally {
    s.restore();
    clearBotJwtCache();
  }
});
