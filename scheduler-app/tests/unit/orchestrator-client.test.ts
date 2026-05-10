import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  consultOrchestrator,
  OrchestratorError,
} from "@/lib/scheduler/orchestrator-client";

describe("consultOrchestrator", () => {
  const originalEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.ORCHESTRATOR_URL =
      "https://test-project.supabase.co/functions/v1/orchestrator-direct";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key";
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fetchSpy.mockRestore();
  });

  it("POSTs to ORCHESTRATOR_URL with Bearer + apikey headers + JSON body", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          directive: "show_phone_entry",
          flags: { customer_status: "not_found" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const out = await consultOrchestrator({
      session_id: "sess-1",
      context: "Customer wants oil change",
      hints: { phone_e164: "+16105550123" },
    });

    expect(out).toEqual({
      directive: "show_phone_entry",
      flags: { customer_status: "not_found" },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(
      "https://test-project.supabase.co/functions/v1/orchestrator-direct",
    );
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sb_secret_test_key");
    expect(headers.apikey).toBe("sb_secret_test_key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      session_id: "sess-1",
      context: "Customer wants oil change",
      hints: { phone_e164: "+16105550123" },
    });
  });

  it("throws OrchestratorError on non-2xx response with status set", async () => {
    fetchSpy.mockResolvedValue(
      new Response("internal server error", { status: 500 }),
    );

    await expect(
      consultOrchestrator({ session_id: "x", context: "y" }),
    ).rejects.toMatchObject({
      name: "OrchestratorError",
      status: 500,
    });
  });

  it("throws OrchestratorError on missing ORCHESTRATOR_URL env", async () => {
    delete process.env.ORCHESTRATOR_URL;

    await expect(
      consultOrchestrator({ session_id: "x", context: "y" }),
    ).rejects.toThrow(/ORCHESTRATOR_URL/);
  });

  it("throws OrchestratorError on missing SUPABASE_SECRET_KEY env", async () => {
    delete process.env.SUPABASE_SECRET_KEY;

    await expect(
      consultOrchestrator({ session_id: "x", context: "y" }),
    ).rejects.toThrow(/SUPABASE_SECRET_KEY/);
  });

  it("throws OrchestratorError on network failure (fetch rejects)", async () => {
    fetchSpy.mockRejectedValue(new Error("connection refused"));

    await expect(
      consultOrchestrator({ session_id: "x", context: "y" }),
    ).rejects.toMatchObject({
      name: "OrchestratorError",
      message: expect.stringMatching(/Network error/),
    });
  });

  it("throws OrchestratorError when response body is not JSON", async () => {
    fetchSpy.mockResolvedValue(
      new Response("<html>oops</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    await expect(
      consultOrchestrator({ session_id: "x", context: "y" }),
    ).rejects.toThrow(/non-JSON body/);
  });

  it("throws OrchestratorError when response is JSON but missing `directive`", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: "no directive" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      consultOrchestrator({ session_id: "x", context: "y" }),
    ).rejects.toThrow(/missing required `directive`/);
  });

  it("OrchestratorError is an instance of Error + has correct name", () => {
    const e = new OrchestratorError("test", 502);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("OrchestratorError");
    expect(e.status).toBe(502);
  });

  it("does not include hints in body when not provided", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ directive: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await consultOrchestrator({ session_id: "s", context: "c" });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ session_id: "s", context: "c" });
    expect(body.hints).toBeUndefined();
  });
});
