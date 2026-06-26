import { NextResponse } from "next/server";

/**
 * E2E-ONLY deterministic mock of the `orchestrator-mcp` edge function.
 *
 * Active ONLY when `KEYTAG_E2E_MOCK=1` (set by playwright.config's webServer);
 * returns 404 otherwise, so it's inert in dev/prod. `client.ts buildOrchestratorUrl`
 * redirects here under the same env flag. This lets a real-browser Playwright test
 * drive the SERVER-SIDE Pattern-A force-assign flow without touching real
 * Tekmetric/keytag data — MSW-in-instrumentation does NOT reliably intercept
 * Next's server-side fetch, so we use a real local route instead.
 *
 * (Folder is `e2e-mock`, NOT `_e2e`/`__e2e` — leading-underscore folders are
 * Next "private folders" excluded from routing, which 404s the route.)
 *
 * Returns the JSON-RPC envelope `callOrchestratorRpc` expects:
 *   { jsonrpc, id, result: { content: [{ type:"text", text: <JSON string> }] } }
 */
export const dynamic = "force-dynamic";

function rpc(id: unknown, toolResult: unknown) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(toolResult) }] },
  });
}

export async function POST(req: Request) {
  if (process.env.KEYTAG_E2E_MOCK !== "1") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    params?: { name?: string; arguments?: Record<string, unknown> };
  };
  const id = body.id ?? null;
  const name = body.params?.name;
  const args = body.params?.arguments ?? {};

  switch (name) {
    case "listWipKeyTags":
    case "listManualReviews":
      // Simulate real orchestrator latency on the board reads. This is essential
      // to reproducing B1: an INSTANT mock resolves loadBoardState before the Live
      // <Suspense> boundary commits its fallback, so the form never unmounts and
      // the bug hides. A real network round-trip is slow enough that the fallback
      // renders (unmounting AssignKeytagForm). 1.2s makes the repro deterministic.
      await new Promise((r) => setTimeout(r, 1200));
      return rpc(id, { ok: true, results: [] });
    case "getKeytagDashboard":
      return rpc(id, {
        ok: true,
        generated_at: new Date().toISOString(),
        counts: { in_use: 0, available: 180, stale: 0, total: 180 },
        stale: [],
        ros_without_tags: [],
        grid: [],
      });
    case "assignKeytagToRo": {
      const roNumber = Number(args.ro_number ?? 999999);
      const color = (args.color as string) === "yellow" ? "yellow" : "red";
      const tagNumber = Number(args.tag_number ?? 17);
      const label = `${color === "red" ? "Red" : "Yellow"} ${tagNumber}`;
      const wire = `${color === "red" ? "R" : "Y"}${tagNumber}`;
      if (args.confirmation_token) {
        // Second call (token present) — apply the assign.
        return rpc(id, {
          ok: true,
          ro_number: roNumber,
          ro_id: roNumber,
          tag: { color, number: tagNumber, label, wire },
          tekmetric_patched: true,
          ro_url: "https://shop.tekmetric.test/ro",
          auto_assigned: false,
        });
      }
      // First call — issue a confirmation token (Pattern A step 1).
      return rpc(id, {
        ok: false,
        needs_confirmation: true,
        confirmation: {
          token_id: crypto.randomUUID(),
          expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
          action_kind: "force_assign",
          scope_summary: `Force-assign ${label} to RO #${roNumber} (overrides round-robin selection).`,
        },
        message: "Confirm to apply the force-assign.",
      });
    }
    default:
      return rpc(id, { ok: true, results: [] });
  }
}
