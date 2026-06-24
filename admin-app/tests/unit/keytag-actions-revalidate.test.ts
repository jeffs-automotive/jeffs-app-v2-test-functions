/**
 * Regression guard for the 2026-06-24 board-release "continually loads" spin.
 *
 * The success path of releaseKeytagAction / assignKeytagAction must NOT call
 * revalidatePath('/keytags'): on the force-dynamic six-tab /keytags page that
 * re-rendered every tab inside the Server Action response, keeping
 * useActionState's isPending true long after the orchestrator already applied
 * the change. The board now updates optimistically (BoardClient.onResolved) and
 * reconverges via the 15s poller, so the action must carry only its return
 * value. If anyone re-adds revalidatePath here, this fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ email: "chris@jeffsautomotive.com" }),
}));
// wrapAdminAction wraps inner in Sentry.withServerActionInstrumentation — make it a passthrough.
vi.mock("@sentry/nextjs", () => ({
  withServerActionInstrumentation: (_name: string, _opts: unknown, cb: () => unknown) => cb(),
  setTag: vi.fn(),
}));
vi.mock("@/lib/orchestrator/client", () => ({
  callKeytagTool: vi.fn(),
  OrchestratorClientError: class OrchestratorClientError extends Error {},
}));

import { revalidatePath } from "next/cache";
import { callKeytagTool } from "@/lib/orchestrator/client";
import { releaseKeytagAction } from "@/actions/keytag/release-keytag";
import { assignKeytagAction } from "@/actions/keytag/assign-keytag";

const mockTool = vi.mocked(callKeytagTool);

describe("keytag actions — no page-wide revalidate on success (spin fix)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("releaseKeytagAction success returns success WITHOUT revalidatePath", async () => {
    mockTool.mockResolvedValue({
      ok: true,
      released_tag: { color: "red", number: 75, label: "R75" },
      message: "Released.",
    } as never);

    const fd = new FormData();
    fd.set("ro_number", "153380");
    const res = await releaseKeytagAction({ kind: "idle" }, fd);

    expect(res.kind).toBe("success");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("assignKeytagAction success returns success WITHOUT revalidatePath", async () => {
    mockTool.mockResolvedValue({
      ok: true,
      tag: { color: "red", number: 77, label: "R77" },
      tekmetric_patched: true,
    } as never);

    const fd = new FormData();
    fd.set("ro_number", "153380");
    const res = await assignKeytagAction({ kind: "idle" }, fd);

    expect(res.kind).toBe("success");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
